/*
 * yt-extractor.js — stream / playlist resolver for YT Music (KaiOS)
 *
 * 2026 rewrite. Everything that depended on services that no longer exist
 * (vid.puffyan.us, web-sms-kaios.herokuapp.com, onecompiler.com,
 * malaysiaapi-arma7x.koyeb.app, noembed.com "player_response") was removed.
 *
 * Strategy:
 *   1. Invidious REST API (/api/v1/videos, /api/v1/playlists, /api/v1/search)
 *      on a user-selectable instance, with automatic fail-over to other known
 *      API-enabled instances.
 *   2. Invidious `/latest_version?id=..&itag=..&local=true` as a last-resort
 *      audio URL (302 → ready-to-play stream, no JSON parsing involved).
 *   3. YouTube HTML/InnerTube scraping as fallback for search + playlists
 *      (no PO-token needed for those; only playback needs it, which is why
 *      playback stays on Invidious).
 */

var XHR_TIMEOUT = 15000;

// Public https instances listed on https://api.invidious.io (checked 2026-09-20).
// Only invidious.f5.si advertises `api: true`; the others currently answer the
// JSON API with an error/HTML and are kept as cheap fail-over candidates in case
// their operators re-enable it. The runtime health check (utils.js
// getAvailableInvidiousInstance) and withInstanceFailover() skip dead ones.
var DEFAULT_INVIDIOUS_INSTANCES = [
  'invidious.f5.si',
  'inv.nadeko.net',
  'yt.chocolatemoo53.com',
  'invidious.nerdvpn.de',
  'invidious.tiekoetter.com'
];

var STORAGE_KEY_INSTANCE = '_INVIDIOUS_INSTANCE_';
var STORAGE_KEY_PROXY = 'INVIDIOUS';

function normalizeInstanceHost(value) {
  if (value == null) return '';
  var v = String(value).trim();
  if (v.length === 0) return '';
  v = v.replace(/^https?:\/\//i, '');
  v = v.replace(/\/+$/, '');
  v = v.split('/')[0];
  if (v.length === 0 || v.indexOf('.') === -1 || /\s/.test(v)) return '';
  return v.toLowerCase();
}

function safeStorageGet(key) {
  try { return window.localStorage.getItem(key); } catch (e) { return null; }
}

function safeStorageSet(key, value) {
  try { window.localStorage.setItem(key, value); } catch (e) {}
}

function parseBool(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'boolean') return value;
  try { return JSON.parse(value) ? true : false; } catch (e) { return fallback; }
}

// Restore the user's instance (bug: it was saved by the menu but never read back).
window['_INVIDIOUS_INSTANCE_'] = normalizeInstanceHost(safeStorageGet(STORAGE_KEY_INSTANCE)) || DEFAULT_INVIDIOUS_INSTANCES[0];
// Proxy streams through the instance. Direct googlevideo URLs are IP-locked to
// the Invidious server, so proxied is the only mode that reliably plays.
window['INVIDIOUS'] = parseBool(safeStorageGet(STORAGE_KEY_PROXY), true);

// Returns the normalised host that is now active, or '' when `host` is unusable.
function setInvidiousInstance(host) {
  host = normalizeInstanceHost(host);
  if (!host) return '';
  window['_INVIDIOUS_INSTANCE_'] = host;
  window['_INVIDIOUS_ACTIVE_'] = host;
  safeStorageSet(STORAGE_KEY_INSTANCE, host);
  return host;
}

function setInvidiousProxy(enabled) {
  window['INVIDIOUS'] = enabled ? true : false;
  safeStorageSet(STORAGE_KEY_PROXY, JSON.stringify(window['INVIDIOUS']));
  return window['INVIDIOUS'];
}

function getInstanceCandidates() {
  var list = [window['_INVIDIOUS_INSTANCE_']];
  var extra = [];
  try {
    extra = JSON.parse(safeStorageGet('_INVIDIOUS_AVAILABLE_') || '[]');
  } catch (e) { extra = []; }
  [].concat(extra, DEFAULT_INVIDIOUS_INSTANCES).forEach(function(h) {
    h = normalizeInstanceHost(h);
    if (h && list.indexOf(h) === -1) list.push(h);
  });
  return list;
}

const XHR_HEADER = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9'
};

var xhr = function(method, url, data, query, headers, options) {
  data = data || {};
  query = query || {};
  headers = headers || {};
  options = options || {};
  return new Promise((resolve, reject) => {
    var _url;
    try {
      _url = new URL(url);
    } catch (e) {
      reject({ raw: null, response: 'Invalid URL: ' + url });
      return;
    }
    for (var y in query) {
      if (query[y] != null) _url.searchParams.set(y, query[y]);
    }
    var xhttp;
    try {
      xhttp = new XMLHttpRequest({ mozSystem: true });
    } catch (e) {
      xhttp = new XMLHttpRequest();
    }
    var settled = false;
    function finish(fn, payload) {
      if (settled) return;
      settled = true;
      fn(payload);
    }
    function parseBody() {
      var body = xhttp.responseText;
      if (options.responseType && options.responseType !== 'text') {
        return xhttp.response;
      }
      try {
        return JSON.parse(body);
      } catch (e) {
        return body;
      }
    }
    xhttp.onload = function() {
      var status = xhttp.status;
      var payload = { raw: xhttp, response: parseBody(), status: status };
      if (status >= 200 && status <= 299) {
        finish(resolve, payload);
      } else {
        finish(reject, payload);
      }
    };
    xhttp.onerror = function() {
      finish(reject, { raw: xhttp, response: 'Network Error', status: 0 });
    };
    xhttp.ontimeout = function() {
      console.error('Timeout: ' + _url.toString());
      finish(reject, { raw: xhttp, response: 'Timeout', status: 0 });
    };
    xhttp.onabort = function() {
      finish(reject, { raw: xhttp, response: 'Aborted', status: 0 });
    };
    try {
      xhttp.open(method, _url.toString(), true);
      xhttp.timeout = options.timeout || XHR_TIMEOUT;
      if (options.responseType) xhttp.responseType = options.responseType;
      for (var x in headers) {
        try { xhttp.setRequestHeader(x, headers[x]); } catch (e) {}
      }
      if (typeof data === 'string') {
        xhttp.send(data);
      } else if (data && Object.keys(data).length > 0) {
        try { xhttp.setRequestHeader('Content-Type', 'application/json'); } catch (e) {}
        xhttp.send(JSON.stringify(data));
      } else {
        xhttp.send();
      }
    } catch (e) {
      finish(reject, { raw: xhttp, response: e.toString(), status: 0 });
    }
  });
}

function parse_str(str) {
  if (typeof str !== 'string') return {};
  return str.split('&').reduce(function(params, param) {
    if (param.length === 0) return params;
    var idx = param.indexOf('=');
    var key = idx === -1 ? param : param.substring(0, idx);
    var value = idx === -1 ? '' : param.substring(idx + 1);
    try {
      params[decodeURIComponent(key.replace(/\+/g, ' '))] = decodeURIComponent(value.replace(/\+/g, ' '));
    } catch (e) {
      params[key] = value;
    }
    return params;
  }, {});
}

function errorToString(err) {
  if (err == null) return 'Unknown Error';
  if (typeof err === 'string') return err;
  if (err.response != null) {
    if (typeof err.response === 'string') {
      var r = err.response.trim();
      if (r.length > 0 && r.charAt(0) !== '<') return r.substring(0, 120);
    } else if (typeof err.response === 'object' && err.response.error) {
      return String(err.response.error).substring(0, 160);
    }
    if (err.status) return 'HTTP ' + err.status;
    return 'Network Error';
  }
  if (err.message) return err.message;
  return err.toString();
}

/* -------------------------------------------------------------------------- */
/* Invidious                                                                  */
/* -------------------------------------------------------------------------- */

function invidiousURL(host, path, query) {
  var u = new URL('https://' + host + path);
  if (query) {
    for (var k in query) {
      if (query[k] != null) u.searchParams.set(k, query[k]);
    }
  }
  return u.toString();
}

function invidiousGet(host, path, query, timeout) {
  return xhr('GET', invidiousURL(host, path, query), {}, {}, { 'Accept': 'application/json' }, { timeout: timeout || XHR_TIMEOUT })
  .then((res) => {
    if (typeof res.response !== 'object' || res.response === null) {
      return Promise.reject({ raw: res.raw, response: 'Invalid JSON from ' + host, status: res.status });
    }
    if (res.response.error) {
      return Promise.reject({ raw: res.raw, response: res.response, status: res.status });
    }
    return res.response;
  });
}

// Try `fn(host)` on every candidate instance until one succeeds.
function withInstanceFailover(fn) {
  var candidates = getInstanceCandidates();
  var lastError = 'No Invidious instance available';
  var i = 0;
  function attempt() {
    if (i >= candidates.length) {
      return Promise.reject(lastError);
    }
    var host = candidates[i++];
    return Promise.resolve()
    .then(() => fn(host))
    .then((result) => {
      window['_INVIDIOUS_ACTIVE_'] = host;
      return result;
    })
    .catch((err) => {
      lastError = errorToString(err);
      console.warn('Invidious', host, 'failed:', lastError);
      return attempt();
    });
  }
  return attempt();
}

function fallbackV2(id, local) {
  if (local == null) local = window['INVIDIOUS'];
  return withInstanceFailover((host) => {
    return invidiousGet(host, '/api/v1/videos/' + encodeURIComponent(id), {
      local: local ? 'true' : 'false',
      fields: 'videoId,title,lengthSeconds,liveNow,adaptiveFormats,formatStreams,error'
    })
    .then((video) => {
      if (video.liveNow) return Promise.reject('Live streams are not supported');
      var adaptive = Array.isArray(video.adaptiveFormats) ? video.adaptiveFormats : [];
      var muxed = Array.isArray(video.formatStreams) ? video.formatStreams : [];
      if (adaptive.length === 0 && muxed.length === 0) {
        return Promise.reject('No playable formats from ' + host);
      }
      video.instance = host;
      video.local = local ? true : false;
      return video;
    });
  });
}

function execute(id) {
  return fallbackV2(id);
}

// Last-resort stream URL (Invidious resolves the final googlevideo URL and
// 302-redirects; <audio> follows redirects natively).
// itag 140 = m4a/AAC 128k (best KaiOS compatibility), 251 = webm/opus 160k.
function getLatestVersionURL(id, itag, host) {
  host = host || window['_INVIDIOUS_ACTIVE_'] || window['_INVIDIOUS_INSTANCE_'];
  return invidiousURL(host, '/latest_version', {
    id: id,
    itag: itag || 140,
    local: 'true'
  });
}

function formatFromInvidious(id, f, source) {
  var url = f.url || null;
  var mimeType = (f.type || '').split(';')[0].trim();
  if (!mimeType && f.container) {
    mimeType = (source.muxed ? 'video/' : 'audio/') + f.container;
  }
  var bitrate = parseInt(f.bitrate, 10);
  if (isNaN(bitrate)) bitrate = 0;
  return {
    id: id,
    itag: String(f.itag || ''),
    mimeType: mimeType,
    codecs: ((f.type || '').split(';')[1] || '').replace(/codecs=|"/g, '').trim(),
    bitrate: bitrate,
    url: url,
    signatureCipher: null,
    player: null,
    width: f.width || 0,
    height: f.height || 0,
    audioQuality: f.audioQuality || null,
    container: f.container || null,
    muxed: source.muxed ? true : false,
    instance: source.instance || null,
    local: source.local ? true : false
  };
}

function getVideoLinks(id) {
  return execute(id)
  .then((result) => {
    var formats = [];
    (result.adaptiveFormats || []).forEach((f) => {
      if (!f || !f.url) return;
      formats.push(formatFromInvidious(id, f, { instance: result.instance, local: result.local }));
    });
    // Muxed progressive streams (itag 18 = mp4 360p + AAC) are a usable audio
    // fallback when the instance returns no audio-only adaptive formats.
    var hasAudio = formats.some((f) => f.mimeType.indexOf('audio') === 0);
    if (!hasAudio) {
      (result.formatStreams || []).forEach((f) => {
        if (!f || !f.url) return;
        var fmt = formatFromInvidious(id, f, { instance: result.instance, local: result.local, muxed: true });
        if (fmt.mimeType.indexOf('video/mp4') === 0) {
          fmt.mimeType = 'audio/mp4';
          fmt.codecs = 'mp4a (muxed video)';
          formats.push(fmt);
        }
      });
    }
    if (formats.length === 0) {
      return Promise.reject('No playable formats');
    }
    return formats;
  });
}

// Pick the best audio format for a mime preference ('audio', 'audio/mp4',
// 'audio/webm'). Falls back to any audio when the preferred mime is missing.
function pickAudioFormat(links, preferredMime) {
  preferredMime = preferredMime || 'audio';
  var audio = (links || []).filter((l) => l && l.url && typeof l.mimeType === 'string' && l.mimeType.indexOf('audio') === 0);
  if (audio.length === 0) return null;
  var preferred = audio.filter((l) => l.mimeType.indexOf(preferredMime) > -1);
  var pool = preferred.length > 0 ? preferred : audio;
  var best = null;
  pool.forEach((l) => {
    var kbps = normalizeBitrate(l.bitrate);
    if (best === null || kbps >= best._kbps) {
      l._kbps = kbps;
      best = l;
    }
  });
  if (best) {
    best.bitrate = best._kbps;
    delete best._kbps;
  }
  return best;
}

function normalizeBitrate(bitrate) {
  var b = parseInt(bitrate, 10);
  if (isNaN(b)) return 0;
  if (b > 999) b = Math.round(b / 1000);
  return b;
}

/* -------------------------------------------------------------------------- */
/* Playlists                                                                  */
/* -------------------------------------------------------------------------- */

// Accepts a bare playlist id, a youtube.com/playlist?list=… URL, a watch URL
// with &list=…, a music.youtube.com URL or an Invidious URL. Returns '' if
// nothing usable was found.
function extractPlaylistId(input) {
  if (input == null) return '';
  var s = String(input).trim();
  if (s.length === 0) return '';
  var m = s.match(/[?&#]list=([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  m = s.match(/\/playlist\/([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{13,}$/.test(s)) return s;
  return '';
}

function normalizePlaylistVideo(v) {
  if (!v || !v.videoId) return null;
  var length = parseInt(v.lengthSeconds, 10);
  return {
    videoId: v.videoId,
    id: v.videoId,
    title: v.title || v.videoId,
    author: v.author || '',
    lengthSeconds: isNaN(length) ? 0 : length,
    index: typeof v.index === 'number' ? v.index : 0
  };
}

function dedupeVideos(videos) {
  var seen = {};
  var out = [];
  videos.forEach((v) => {
    if (!v || !v.videoId || seen[v.videoId]) return;
    seen[v.videoId] = true;
    out.push(v);
  });
  return out;
}

function getInvidiousPlaylist(id, host) {
  var MAX_PAGES = 30; // 100 videos/page → 3000 tracks
  var videos = [];
  var title = null;
  var videoCount = null;
  function fetchPage(page) {
    return invidiousGet(host, '/api/v1/playlists/' + encodeURIComponent(id), {
      page: page,
      fields: 'title,playlistId,videoCount,videos(videoId,title,author,lengthSeconds,index),error'
    })
    .then((pl) => {
      if (title === null) title = pl.title || id;
      if (videoCount === null && typeof pl.videoCount === 'number') videoCount = pl.videoCount;
      var batch = (pl.videos || []).map(normalizePlaylistVideo).filter((v) => v !== null);
      var before = videos.length;
      videos = dedupeVideos(videos.concat(batch));
      var gotNew = videos.length > before;
      var complete = videoCount !== null && videos.length >= videoCount;
      if (batch.length === 0 || !gotNew || complete || page >= MAX_PAGES) {
        // Some instances answer with an empty `videos` array (backend broken)
        // although the playlist is not empty → let the failover try elsewhere.
        if (videos.length === 0 && videoCount !== 0) {
          return Promise.reject('No videos returned by ' + host);
        }
        return { id: id, title: title, videos: videos, source: host };
      }
      return fetchPage(page + 1);
    });
  }
  return fetchPage(1);
}

// Fallback: scrape https://www.youtube.com/playlist?list=… (ytInitialData) and
// follow InnerTube /browse continuations. No PO token is needed for browse.
function getYouTubePlaylist(id) {
  var MAX_PAGES = 30;
  return xhr('GET', 'https://www.youtube.com/playlist', {}, { list: id, hl: 'en', app: 'desktop' }, XHR_HEADER, { timeout: 20000 })
  .then((res) => {
    var html = typeof res.response === 'string' ? res.response : '';
    var data = extractInitialData(html, 'ytInitialData');
    if (!data) return Promise.reject('Playlist page not parsable');
    var cfg = extractInnertubeConfig(html);
    var title = id;
    try {
      title = data.metadata.playlistMetadataRenderer.title || id;
    } catch (e) {
      try { title = data.header.playlistHeaderRenderer.title.simpleText || id; } catch (e2) {}
    }
    var contents = findPlaylistContents(data);
    if (!contents) return Promise.reject('Playlist not found or private');
    var videos = [];
    var token = collectPlaylistItems(contents, videos);
    var page = 1;
    function next() {
      if (!token || page >= MAX_PAGES) {
        return { id: id, title: title, videos: dedupeVideos(videos), source: 'youtube' };
      }
      page++;
      return innertubeBrowseContinuation(token, cfg)
      .then((items) => {
        token = collectPlaylistItems(items, videos);
        return next();
      })
      .catch(() => {
        return { id: id, title: title, videos: dedupeVideos(videos), source: 'youtube' };
      });
    }
    return next();
  });
}

function findPlaylistContents(data) {
  try {
    var tabs = data.contents.twoColumnBrowseResultsRenderer.tabs;
    for (var i = 0; i < tabs.length; i++) {
      var tab = tabs[i].tabRenderer;
      if (!tab || !tab.content) continue;
      var sections = tab.content.sectionListRenderer.contents;
      for (var j = 0; j < sections.length; j++) {
        var items = sections[j].itemSectionRenderer && sections[j].itemSectionRenderer.contents;
        if (!items) continue;
        for (var k = 0; k < items.length; k++) {
          if (items[k].playlistVideoListRenderer) {
            return items[k].playlistVideoListRenderer.contents;
          }
        }
      }
    }
  } catch (e) {}
  return null;
}

function collectPlaylistItems(items, videos) {
  var token = null;
  (items || []).forEach((item) => {
    if (item.playlistVideoRenderer) {
      var r = item.playlistVideoRenderer;
      if (!r.videoId || r.isPlayable === false) return;
      var t = '';
      try { t = r.title.runs.map((x) => x.text).join(''); } catch (e) { t = (r.title && r.title.simpleText) || r.videoId; }
      var author = '';
      try { author = r.shortBylineText.runs[0].text; } catch (e) {}
      var idx = 0;
      try { idx = parseInt(r.index.simpleText, 10) - 1; } catch (e) {}
      videos.push({
        videoId: r.videoId,
        id: r.videoId,
        title: t,
        author: author,
        lengthSeconds: parseInt(r.lengthSeconds, 10) || 0,
        index: isNaN(idx) ? videos.length : idx
      });
    } else if (item.continuationItemRenderer) {
      try {
        token = item.continuationItemRenderer.continuationEndpoint.continuationCommand.token;
      } catch (e) {}
    }
  });
  return token;
}

function innertubeBrowseContinuation(token, cfg) {
  var form = {
    context: {
      client: {
        clientName: 'WEB',
        clientVersion: (cfg && cfg.clientVersion) || INNERTUBE_FALLBACK_CLIENT_VERSION,
        hl: 'en',
        gl: 'US'
      }
    },
    continuation: token
  };
  var query = { prettyPrint: 'false' };
  if (cfg && cfg.apiKey) query.key = cfg.apiKey;
  return xhr('POST', 'https://www.youtube.com/youtubei/v1/browse', form, query, XHR_HEADER, { timeout: 20000 })
  .then((res) => {
    var data = res.response;
    if (typeof data !== 'object' || data === null) return Promise.reject('Bad continuation response');
    var actions = data.onResponseReceivedActions || data.onResponseReceivedCommands || [];
    for (var i = 0; i < actions.length; i++) {
      var a = actions[i].appendContinuationItemsAction || actions[i].reloadContinuationItemsCommand;
      if (a && a.continuationItems) return a.continuationItems;
    }
    return [];
  });
}

var INNERTUBE_FALLBACK_CLIENT_VERSION = '2.20250312.04.00';

function extractInnertubeConfig(html) {
  var cfg = { apiKey: null, clientVersion: null, visitorData: null };
  if (typeof html !== 'string') return cfg;
  var m = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || html.match(/"innertubeApiKey":"([^"]+)"/);
  if (m) cfg.apiKey = m[1];
  m = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/) || html.match(/"clientVersion":"([^"]+)"/);
  if (m) cfg.clientVersion = m[1];
  m = html.match(/"VISITOR_DATA":"([^"]+)"/);
  if (m) cfg.visitorData = m[1];
  return cfg;
}

// Extract `var ytInitialData = {...};` (or ytInitialPlayerResponse) from HTML,
// robust against changes of what follows the object literal.
function extractInitialData(html, name) {
  if (typeof html !== 'string') return null;
  var re = new RegExp('(?:var\\s+' + name + '|window\\["' + name + '"\\]|' + name + ')\\s*=\\s*');
  var m = re.exec(html);
  if (!m) return null;
  var start = m.index + m[0].length;
  var end = findJsonObjectEnd(html, start);
  if (end === -1) return null;
  try {
    return JSON.parse(html.substring(start, end + 1));
  } catch (e) {
    return null;
  }
}

// Given the index of an opening "{", return the index of the matching "}"
// while honouring string literals and escapes.
function findJsonObjectEnd(str, start) {
  if (str.charAt(start) !== '{') return -1;
  var depth = 0;
  var inString = false;
  for (var i = start; i < str.length; i++) {
    var ch = str.charAt(i);
    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Resolves { id, title, videos: [{videoId, id, title, author, lengthSeconds, index}], source }
function getPlaylistVideos(input) {
  var id = extractPlaylistId(input);
  if (!id) return Promise.reject('Invalid playlist ID');
  return withInstanceFailover((host) => getInvidiousPlaylist(id, host))
  .catch((invErr) => {
    console.warn('Invidious playlist failed, trying YouTube:', errorToString(invErr));
    return getYouTubePlaylist(id).catch((ytErr) => {
      return Promise.reject(errorToString(ytErr) || errorToString(invErr));
    });
  })
  .then((result) => {
    result.videos = dedupeVideos(result.videos || []).sort((a, b) => a.index - b.index);
    if (result.videos.length === 0) return Promise.reject('Empty');
    return result;
  });
}
