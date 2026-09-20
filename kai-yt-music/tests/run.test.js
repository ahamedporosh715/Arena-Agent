'use strict';
// Offline unit tests for the pure/promise helpers of kai-yt-music.
// Run with:  node --test tests/   (Node >= 18)
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, plain } = require('./helpers.js');
const deepEqual = (actual, expected, message) => assert.deepEqual(plain(actual), plain(expected), message);

/* ------------------------------------------------------------------------ */
/* fixtures                                                                 */
/* ------------------------------------------------------------------------ */

const VIDEO_OK = {
  videoId: 'dQw4w9WgXcQ',
  title: 'Never Gonna Give You Up',
  lengthSeconds: 212,
  liveNow: false,
  adaptiveFormats: [
    { itag: '140', type: 'audio/mp4; codecs="mp4a.40.2"', bitrate: '130000', url: 'https://inst/videoplayback?itag=140&expire=9999999999', container: 'm4a', audioQuality: 'AUDIO_QUALITY_MEDIUM' },
    { itag: '251', type: 'audio/webm; codecs="opus"', bitrate: '160000', url: 'https://inst/videoplayback?itag=251&expire=9999999999', container: 'webm', audioQuality: 'AUDIO_QUALITY_MEDIUM' },
    { itag: '137', type: 'video/mp4; codecs="avc1.640028"', bitrate: '4000000', url: 'https://inst/videoplayback?itag=137', container: 'mp4', width: 1920, height: 1080 },
  ],
  formatStreams: [
    { itag: '18', type: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"', bitrate: '600000', url: 'https://inst/videoplayback?itag=18', container: 'mp4' },
  ],
};

const VIDEO_MUXED_ONLY = {
  videoId: 'abc123defgh',
  title: 'muxed only',
  lengthSeconds: 10,
  liveNow: false,
  adaptiveFormats: [
    { itag: '137', type: 'video/mp4; codecs="avc1.640028"', bitrate: '4000000', url: 'https://inst/vp?itag=137', container: 'mp4' },
  ],
  formatStreams: [
    { itag: '18', type: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"', bitrate: '600000', url: 'https://inst/vp?itag=18', container: 'mp4' },
  ],
};

function playlistPage(page) {
  const per = 3;
  const total = 5;
  const videos = [];
  for (let i = (page - 1) * per; i < Math.min(total, page * per); i++) {
    videos.push({ videoId: 'vid' + String(i).padStart(8, '0'), title: 'Track ' + i, author: 'Artist', lengthSeconds: 100 + i, index: i });
  }
  return { title: 'My Mix', playlistId: 'PLxxxxxxxxxxxxxxxxxxxxxxxx', videoCount: total, videos };
}

function ytInitialDataSearchHtml() {
  const data = {
    estimatedResults: '12345',
    contents: {
      twoColumnSearchResultsRenderer: {
        primaryContents: {
          sectionListRenderer: {
            contents: [
              {
                itemSectionRenderer: {
                  contents: [
                    {
                      videoRenderer: {
                        videoId: 'video000001',
                        title: { runs: [{ text: 'First ' }, { text: 'Song' }] },
                        lengthText: { simpleText: '3:45' },
                        ownerText: { runs: [{ text: 'Channel A', navigationEndpoint: { commandMetadata: { webCommandMetadata: { url: '/@channelA' } } } }] },
                        viewCountText: { simpleText: '1,000 views' },
                        publishedTimeText: { simpleText: '2 years ago' },
                        thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/video000001/hq720.jpg' }] },
                        navigationEndpoint: { commandMetadata: { webCommandMetadata: { url: '/watch?v=video000001' } } },
                      },
                    },
                    {
                      videoRenderer: {
                        videoId: 'live0000001',
                        title: { runs: [{ text: 'Live radio' }] },
                        badges: [{ metadataBadgeRenderer: { style: 'BADGE_STYLE_TYPE_LIVE_NOW' } }],
                        viewCountText: { runs: [{ text: '12 watching' }] },
                      },
                    },
                    { channelRenderer: { channelId: 'UC1', title: { simpleText: 'Some channel' } } },
                    {
                      shelfRenderer: {
                        content: {
                          verticalListRenderer: {
                            items: [
                              {
                                videoRenderer: {
                                  videoId: 'shelf000001',
                                  title: { runs: [{ text: 'Shelf song' }] },
                                  lengthText: { simpleText: '1:02:03' },
                                },
                              },
                            ],
                          },
                        },
                      },
                    },
                  ],
                },
              },
              { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'CONT_TOKEN_1' } } } },
            ],
          },
        },
      },
    },
  };
  return `<!DOCTYPE html><html><head><script>ytcfg.set({"INNERTUBE_API_KEY":"AIzaFAKEKEY","INNERTUBE_CLIENT_VERSION":"2.20250901.01.00","VISITOR_DATA":"CgtGQUtF"});</script></head>` +
    `<body><script nonce="x">var ytInitialData = ${JSON.stringify(data)};</script><script>var other = {"a":"b"};</script></body></html>`;
}

function ytContinuationResponse() {
  return {
    estimatedResults: '12345',
    onResponseReceivedCommands: [
      {
        appendContinuationItemsAction: {
          continuationItems: [
            {
              itemSectionRenderer: {
                contents: [
                  { videoRenderer: { videoId: 'page2000001', title: { runs: [{ text: 'Page two' }] }, lengthText: { simpleText: '0:59' } } },
                ],
              },
            },
            { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'CONT_TOKEN_2' } } } },
          ],
        },
      },
    ],
  };
}

function ytPlaylistHtml() {
  const data = {
    metadata: { playlistMetadataRenderer: { title: 'Scraped List' } },
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              content: {
                sectionListRenderer: {
                  contents: [
                    {
                      itemSectionRenderer: {
                        contents: [
                          {
                            playlistVideoListRenderer: {
                              contents: [
                                { playlistVideoRenderer: { videoId: 'ytpl0000001', title: { runs: [{ text: 'One' }] }, index: { simpleText: '1' }, lengthSeconds: '61', shortBylineText: { runs: [{ text: 'Auth' }] } } },
                                { playlistVideoRenderer: { videoId: 'ytpl0000002', title: { runs: [{ text: 'Two' }] }, index: { simpleText: '2' }, lengthSeconds: '62', isPlayable: false } },
                                { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'PL_CONT' } } } },
                              ],
                            },
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    },
  };
  return `<html><script>var ytInitialData = ${JSON.stringify(data)};</script></html>`;
}

function ytPlaylistContinuation() {
  return {
    onResponseReceivedActions: [
      {
        appendContinuationItemsAction: {
          continuationItems: [
            { playlistVideoRenderer: { videoId: 'ytpl0000003', title: { runs: [{ text: 'Three' }] }, index: { simpleText: '3' }, lengthSeconds: '63' } },
          ],
        },
      },
    ],
  };
}

const INSTANCES_JSON = [
  ['inv.nadeko.net', { region: 'CL', type: 'https', api: false, uri: 'https://inv.nadeko.net', monitor: { uptime: 99.1, down: false } }],
  ['invidious.f5.si', { region: 'JP', type: 'https', api: true, cors: true, uri: 'https://invidious.f5.si', monitor: { uptime: 82.3, down: false } }],
  ['yt.example.onion', { region: 'XX', type: 'onion', api: null, uri: 'http://yt.example.onion', monitor: null }],
  ['down.example.org', { region: 'DE', type: 'https', api: true, uri: 'https://down.example.org', monitor: { uptime: 10, down: true } }],
  ['unknown.example.org', { region: 'US', type: 'https', api: null, uri: 'https://unknown.example.org', monitor: null }],
];

/* ------------------------------------------------------------------------ */
/* utils.js                                                                 */
/* ------------------------------------------------------------------------ */

test('convertTime formats seconds and tolerates bad input', () => {
  const ctx = loadApp();
  assert.equal(ctx.convertTime(0), '00:00');
  assert.equal(ctx.convertTime(59), '00:59');
  assert.equal(ctx.convertTime(61), '01:01');
  assert.equal(ctx.convertTime(3725), '01:02:05');
  assert.equal(ctx.convertTime('125'), '02:05');
  assert.equal(ctx.convertTime(NaN), '00:00');
  assert.equal(ctx.convertTime(undefined), '00:00');
  assert.equal(ctx.convertTime(Infinity), '00:00');
});

test('readableFileSize handles units and invalid values', () => {
  const ctx = loadApp();
  assert.equal(ctx.readableFileSize(0, true), '0 Byte');
  assert.equal(ctx.readableFileSize(1023, false), '1023 Byte');
  assert.equal(ctx.readableFileSize(1024, false), '1.0KiB');
  assert.equal(ctx.readableFileSize(1000, true), '1.0KB');
  assert.equal(ctx.readableFileSize(123456, true, 2), '123.46KB');
  assert.equal(ctx.readableFileSize(1536, false), '1.5KiB');
  assert.equal(ctx.readableFileSize('2048'), '2.0KiB', 'numeric strings are accepted');
  assert.equal(ctx.readableFileSize('nope'), '0 Byte');
  assert.equal(ctx.readableFileSize(NaN), '0 Byte');
  assert.equal(ctx.readableFileSize(undefined), '0 Byte');
});

test('getURLParam extracts values from googlevideo style URLs', () => {
  const ctx = loadApp();
  const url = 'https://r1.googlevideo.com/videoplayback?expire=1700000000&ei=abc&itag=140&mime=audio%2Fmp4';
  deepEqual(ctx.getURLParam('expire', url), ['1700000000']);
  deepEqual(ctx.getURLParam('itag', url), ['140']);
  deepEqual(ctx.getURLParam('missing', url), []);
});

test('MIME map knows the audio containers used by Invidious', () => {
  const ctx = loadApp();
  const MIME = ctx.$eval('MIME');
  assert.equal(MIME['audio/mp4'], 'm4a');
  assert.equal(MIME['audio/webm'], 'webm');
  assert.equal(MIME['audio/mpeg'], 'mp3');
});

/* ------------------------------------------------------------------------ */
/* yt-extractor.js — pure helpers                                           */
/* ------------------------------------------------------------------------ */

test('parse_str decodes every "+" and url-encoded pairs', () => {
  const ctx = loadApp();
  deepEqual(ctx.parse_str('a=1+2+3&b=x%20y&c'), { a: '1 2 3', b: 'x y', c: '' });
  deepEqual(ctx.parse_str(''), {});
  deepEqual(ctx.parse_str(null), {});
});

test('extractPlaylistId accepts ids, playlist URLs, watch URLs and Invidious URLs', () => {
  const ctx = loadApp();
  const id = 'PLLsua0MU5Y8LkBQmQWsjYPiLraLx7MXzl';
  assert.equal(ctx.extractPlaylistId(id), id);
  assert.equal(ctx.extractPlaylistId('  ' + id + '\n'), id);
  assert.equal(ctx.extractPlaylistId('https://www.youtube.com/playlist?list=' + id), id);
  assert.equal(ctx.extractPlaylistId('https://youtube.com/watch?v=dQw4w9WgXcQ&list=' + id + '&index=2'), id);
  assert.equal(ctx.extractPlaylistId('https://music.youtube.com/playlist?list=' + id + '&si=abc'), id);
  assert.equal(ctx.extractPlaylistId('https://invidious.f5.si/playlist?list=' + id), id);
  assert.equal(ctx.extractPlaylistId('https://example.com/playlist/' + id), id);
  assert.equal(ctx.extractPlaylistId('not a playlist'), '');
  assert.equal(ctx.extractPlaylistId(''), '');
  assert.equal(ctx.extractPlaylistId(null), '');
});

test('normalizeInstanceHost strips scheme, path and whitespace', () => {
  const ctx = loadApp();
  assert.equal(ctx.normalizeInstanceHost('https://invidious.f5.si/'), 'invidious.f5.si');
  assert.equal(ctx.normalizeInstanceHost('  INVIDIOUS.f5.si/api/v1 '), 'invidious.f5.si');
  assert.equal(ctx.normalizeInstanceHost('http://yt.example.org:8443'), 'yt.example.org:8443');
  assert.equal(ctx.normalizeInstanceHost(''), '');
  assert.equal(ctx.normalizeInstanceHost(null), '');
  assert.equal(ctx.normalizeInstanceHost('not a host!'), '');
});

test('setInvidiousInstance / setInvidiousProxy persist to localStorage', () => {
  const ctx = loadApp();
  assert.equal(ctx.setInvidiousInstance('https://yewtu.be/'), 'yewtu.be');
  assert.equal(ctx._INVIDIOUS_INSTANCE_, 'yewtu.be');
  assert.equal(ctx.localStorage.getItem('_INVIDIOUS_INSTANCE_'), 'yewtu.be');
  assert.equal(ctx.setInvidiousInstance('garbage!!'), '', 'invalid host is rejected');
  assert.equal(ctx._INVIDIOUS_INSTANCE_, 'yewtu.be', 'invalid host does not clobber the current one');
  assert.equal(ctx.setInvidiousProxy(false), false);
  assert.equal(ctx.localStorage.getItem('INVIDIOUS'), 'false');
  assert.equal(ctx.INVIDIOUS, false);
});

test('boot restores the stored instance and defaults proxy mode to true', () => {
  const stored = loadApp({ localStorage: { _INVIDIOUS_INSTANCE_: 'https://custom.example.org', INVIDIOUS: 'false' } });
  assert.equal(stored._INVIDIOUS_INSTANCE_, 'custom.example.org');
  assert.equal(stored.INVIDIOUS, false);
  const fresh = loadApp();
  assert.equal(fresh.INVIDIOUS, true);
  assert.equal(fresh._INVIDIOUS_INSTANCE_, fresh.DEFAULT_INVIDIOUS_INSTANCES[0]);
});

test('getInstanceCandidates puts the selected instance first and dedupes', () => {
  const ctx = loadApp({ localStorage: { _INVIDIOUS_INSTANCE_: 'b.example', _INVIDIOUS_AVAILABLE_: JSON.stringify(['a.example', 'b.example', 'invidious.f5.si']) } });
  const list = ctx.getInstanceCandidates();
  assert.equal(list[0], 'b.example');
  assert.equal(new Set(list).size, list.length, 'no duplicates');
  assert.ok(list.includes('a.example'));
  assert.ok(list.includes('invidious.f5.si'));
});

test('findJsonObjectEnd / extractInitialData honour strings, escapes and nesting', () => {
  const ctx = loadApp();
  const obj = { a: '}{"', b: { c: [1, 2, { d: 'x\\"y' }] }, e: 'back\\\\slash' };
  const html = `<script>var ytInitialData = ${JSON.stringify(obj)};</script><script>window["ytInitialPlayerResponse"] = {"x":1};</script>`;
  deepEqual(ctx.extractInitialData(html, 'ytInitialData'), obj);
  deepEqual(ctx.extractInitialData(html, 'ytInitialPlayerResponse'), { x: 1 });
  assert.equal(ctx.extractInitialData(html, 'nothingHere'), null);
  assert.equal(ctx.extractInitialData('var ytInitialData = {"unterminated": ', 'ytInitialData'), null);
  assert.equal(ctx.extractInitialData(12345, 'ytInitialData'), null);
  assert.equal(ctx.findJsonObjectEnd('{"a":{"b":"}"}}', 0), 14);
  assert.equal(ctx.findJsonObjectEnd('nope', 0), -1);
});

test('extractInnertubeConfig reads key, client version and visitor data', () => {
  const ctx = loadApp();
  const cfg = ctx.extractInnertubeConfig(ytInitialDataSearchHtml());
  assert.equal(cfg.apiKey, 'AIzaFAKEKEY');
  assert.equal(cfg.clientVersion, '2.20250901.01.00');
  assert.equal(cfg.visitorData, 'CgtGQUtF');
  deepEqual(ctx.extractInnertubeConfig(null), { apiKey: null, clientVersion: null, visitorData: null });
});

test('pickAudioFormat prefers the requested mime and falls back to any audio', () => {
  const ctx = loadApp();
  const links = [
    { mimeType: 'audio/mp4', bitrate: '130000', url: 'u140' },
    { mimeType: 'audio/webm', bitrate: 160000, url: 'u251' },
    { mimeType: 'audio/webm', bitrate: 70000, url: 'u250' },
    { mimeType: 'video/mp4', bitrate: 4000000, url: 'u137' },
  ];
  assert.equal(ctx.pickAudioFormat(links, 'audio').url, 'u251');
  assert.equal(ctx.pickAudioFormat(links, 'audio/mp4').url, 'u140');
  assert.equal(ctx.pickAudioFormat(links, 'audio/mp4').bitrate, 130, 'bitrate normalised to kbps');
  assert.equal(ctx.pickAudioFormat(links, 'audio/ogg').url, 'u251', 'unknown preference falls back to best audio');
  assert.equal(ctx.pickAudioFormat([{ mimeType: 'video/mp4', url: 'v' }], 'audio'), null);
  assert.equal(ctx.pickAudioFormat([], 'audio'), null);
  assert.equal(ctx.pickAudioFormat(null, 'audio'), null);
});

test('normalizeBitrate converts bps to kbps and tolerates junk', () => {
  const ctx = loadApp();
  assert.equal(ctx.normalizeBitrate('130000'), 130);
  assert.equal(ctx.normalizeBitrate(128), 128);
  assert.equal(ctx.normalizeBitrate('abc'), 0);
  assert.equal(ctx.normalizeBitrate(undefined), 0);
});

test('dedupeVideos keeps first occurrence by videoId', () => {
  const ctx = loadApp();
  const out = ctx.dedupeVideos([{ videoId: 'a', t: 1 }, { videoId: 'b' }, { videoId: 'a', t: 2 }, null, {}]);
  deepEqual(out.map((v) => v.videoId), ['a', 'b']);
  assert.equal(out[0].t, 1);
});

test('errorToString produces short human readable messages', () => {
  const ctx = loadApp();
  assert.equal(ctx.errorToString('plain'), 'plain');
  assert.equal(ctx.errorToString({ response: { error: 'Error while communicating with Invidious companion' } }), 'Error while communicating with Invidious companion');
  assert.equal(ctx.errorToString({ response: '<html>bad gateway</html>', status: 502 }), 'HTTP 502');
  assert.equal(ctx.errorToString({ response: 'Timeout', status: 0 }), 'Timeout');
  assert.equal(ctx.errorToString(new Error('boom')), 'boom');
  assert.equal(ctx.errorToString(null), 'Unknown Error');
});

test('getLatestVersionURL builds a proxied redirect URL on the active instance', () => {
  const ctx = loadApp();
  const u = new URL(ctx.getLatestVersionURL('dQw4w9WgXcQ', 140, 'inv.example'));
  assert.equal(u.host, 'inv.example');
  assert.equal(u.pathname, '/latest_version');
  assert.equal(u.searchParams.get('id'), 'dQw4w9WgXcQ');
  assert.equal(u.searchParams.get('itag'), '140');
  assert.equal(u.searchParams.get('local'), 'true');
  assert.ok(ctx.getLatestVersionURL('x').indexOf(ctx._INVIDIOUS_INSTANCE_) > -1, 'defaults to the stored instance');
});

/* ------------------------------------------------------------------------ */
/* xhr()                                                                    */
/* ------------------------------------------------------------------------ */

test('xhr resolves parsed JSON, appends query params and sends JSON bodies', async () => {
  const ctx = loadApp({
    routes: (method, url, body, headers) => {
      if (method === 'POST') {
        assert.equal(headers['Content-Type'], 'application/json');
        deepEqual(JSON.parse(body), { hello: 'world' });
        return { status: 200, responseText: '{"ok":true}' };
      }
      return { status: 200, responseText: '{"echo":"' + url + '"}' };
    },
  });
  const res = await ctx.xhr('GET', 'https://example.org/api', {}, { a: 1, b: null, c: 'x y' }, { 'Accept': 'application/json' }, { timeout: 5 });
  assert.equal(res.status, 200);
  assert.equal(res.response.echo, 'https://example.org/api?a=1&c=x+y');
  const post = await ctx.xhr('POST', 'https://example.org/api', { hello: 'world' });
  assert.equal(post.response.ok, true);
  assert.equal(ctx.__xhrCalls[0].timeout, 5, 'timeout is applied to the request');
});

test('xhr rejects on non-2xx, network error, timeout and invalid URL', async () => {
  const ctx = loadApp({
    routes: (method, url) => {
      if (url.includes('/404')) return { status: 404, responseText: 'nope' };
      if (url.includes('/timeout')) return { error: 'timeout' };
      return { error: 'network' };
    },
  });
  await assert.rejects(ctx.xhr('GET', 'https://example.org/404'), (e) => e.status === 404 && e.response === 'nope');
  await assert.rejects(ctx.xhr('GET', 'https://example.org/timeout'), (e) => e.response === 'Timeout');
  await assert.rejects(ctx.xhr('GET', 'https://example.org/net'), (e) => e.response === 'Network Error');
  await assert.rejects(ctx.xhr('GET', 'not a url'), (e) => /Invalid URL/.test(e.response));
});

/* ------------------------------------------------------------------------ */
/* getVideoLinks / failover                                                 */
/* ------------------------------------------------------------------------ */

test('getVideoLinks maps Invidious formats and fails over past a broken instance', async () => {
  const ctx = loadApp({
    localStorage: { _INVIDIOUS_INSTANCE_: 'broken.example', _INVIDIOUS_AVAILABLE_: JSON.stringify(['broken.example', 'good.example']) },
    routes: (method, url) => {
      const u = new URL(url);
      assert.equal(u.searchParams.get('local'), 'true', 'proxy mode requests local=true');
      if (u.host === 'broken.example') return { status: 200, responseText: JSON.stringify({ error: 'Error while communicating with Invidious companion: x' }) };
      if (u.host === 'good.example') return { status: 200, responseText: JSON.stringify(VIDEO_OK) };
      return { error: 'network' };
    },
  });
  const links = await ctx.getVideoLinks('dQw4w9WgXcQ');
  assert.equal(ctx._INVIDIOUS_ACTIVE_, 'good.example');
  assert.equal(links.length, 3, 'muxed streams are not added when audio-only formats exist');
  const m4a = links.find((l) => l.itag === '140');
  assert.equal(m4a.mimeType, 'audio/mp4');
  assert.equal(m4a.codecs, 'mp4a.40.2');
  assert.equal(m4a.bitrate, 130000);
  assert.equal(m4a.local, true);
  assert.equal(m4a.instance, 'good.example');
  assert.equal(m4a.signatureCipher, null);
  const best = ctx.pickAudioFormat(links, 'audio');
  assert.equal(best.itag, '251');
  assert.equal(best.bitrate, 160);
  const calls = ctx.__xhrCalls.map((c) => new URL(c.url).host);
  deepEqual(calls, ['broken.example', 'good.example']);
});

test('getVideoLinks exposes a muxed mp4 as audio/mp4 when no audio-only stream exists', async () => {
  const ctx = loadApp({
    localStorage: { INVIDIOUS: 'false' },
    routes: (method, url) => {
      assert.equal(new URL(url).searchParams.get('local'), 'false');
      return { status: 200, responseText: JSON.stringify(VIDEO_MUXED_ONLY) };
    },
  });
  const links = await ctx.getVideoLinks('abc123defgh');
  const audio = links.filter((l) => l.mimeType.indexOf('audio') === 0);
  assert.equal(audio.length, 1);
  assert.equal(audio[0].itag, '18');
  assert.equal(audio[0].muxed, true);
  assert.equal(audio[0].local, false);
});

test('getVideoLinks rejects live streams and reports the last error when every instance fails', async () => {
  const live = loadApp({ routes: () => ({ status: 200, responseText: JSON.stringify(Object.assign({}, VIDEO_OK, { liveNow: true })) }) });
  await assert.rejects(live.getVideoLinks('dQw4w9WgXcQ'), /Live streams are not supported/);
  const dead = loadApp({ routes: () => ({ status: 502, responseText: '<html>bad gateway</html>' }) });
  await assert.rejects(dead.getVideoLinks('dQw4w9WgXcQ'), /HTTP 502/);
});

/* ------------------------------------------------------------------------ */
/* getPlaylistVideos                                                        */
/* ------------------------------------------------------------------------ */

test('getPlaylistVideos paginates the Invidious playlist API and returns title + videos', async () => {
  const ctx = loadApp({
    routes: (method, url) => {
      const u = new URL(url);
      if (u.pathname.startsWith('/api/v1/playlists/')) {
        return { status: 200, responseText: JSON.stringify(playlistPage(parseInt(u.searchParams.get('page'), 10))) };
      }
      return { error: 'network' };
    },
  });
  const result = await ctx.getPlaylistVideos('https://www.youtube.com/playlist?list=PLxxxxxxxxxxxxxxxxxxxxxxxx');
  assert.equal(result.id, 'PLxxxxxxxxxxxxxxxxxxxxxxxx');
  assert.equal(result.title, 'My Mix');
  assert.equal(result.videos.length, 5);
  deepEqual(result.videos.map((v) => v.index), [0, 1, 2, 3, 4]);
  assert.equal(result.videos[0].id, result.videos[0].videoId, 'id alias kept for the UI');
  assert.equal(ctx.__xhrCalls.length, 2, 'stops once videoCount is reached');
});

test('getPlaylistVideos fails over when an instance returns an empty list for a non-empty playlist', async () => {
  const ctx = loadApp({
    localStorage: { _INVIDIOUS_AVAILABLE_: JSON.stringify(['empty.example', 'ok.example']) },
    routes: (method, url) => {
      const u = new URL(url);
      if (u.host === 'empty.example') return { status: 200, responseText: JSON.stringify({ title: 'X', videoCount: 5, videos: [] }) };
      if (u.host === 'ok.example') return { status: 200, responseText: JSON.stringify(playlistPage(parseInt(u.searchParams.get('page'), 10))) };
      return { error: 'network' };
    },
  });
  const result = await ctx.getPlaylistVideos('PLxxxxxxxxxxxxxxxxxxxxxxxx');
  assert.equal(result.source, 'ok.example');
  assert.equal(result.videos.length, 5);
});

test('getPlaylistVideos falls back to the YouTube page + InnerTube continuation', async () => {
  const ctx = loadApp({
    routes: (method, url, body) => {
      const u = new URL(url);
      if (u.host !== 'www.youtube.com') return { status: 200, responseText: JSON.stringify({ error: 'companion down' }) };
      if (u.pathname === '/playlist') {
        assert.equal(u.searchParams.get('list'), 'PLyyyyyyyyyyyyyyyyyyyyyyyy');
        return { status: 200, responseText: ytPlaylistHtml() };
      }
      if (u.pathname === '/youtubei/v1/browse') {
        assert.equal(JSON.parse(body).continuation, 'PL_CONT');
        return { status: 200, responseText: JSON.stringify(ytPlaylistContinuation()) };
      }
      return { status: 404 };
    },
  });
  const result = await ctx.getPlaylistVideos('PLyyyyyyyyyyyyyyyyyyyyyyyy');
  assert.equal(result.source, 'youtube');
  assert.equal(result.title, 'Scraped List');
  deepEqual(result.videos.map((v) => v.videoId), ['ytpl0000001', 'ytpl0000003'], 'unplayable entries are skipped');
  assert.equal(result.videos[0].author, 'Auth');
  assert.equal(result.videos[1].lengthSeconds, 63);
});

test('getPlaylistVideos rejects invalid ids, empty playlists and total failure', async () => {
  const invalid = loadApp();
  await assert.rejects(invalid.getPlaylistVideos('???'), /Invalid playlist ID/);
  const empty = loadApp({ routes: () => ({ status: 200, responseText: JSON.stringify({ title: 'E', videoCount: 0, videos: [] }) }) });
  await assert.rejects(empty.getPlaylistVideos('PLzzzzzzzzzzzzzzzzzzzzzzzz'), /^Empty$/);
  const dead = loadApp({ routes: () => ({ error: 'network' }) });
  await assert.rejects(dead.getPlaylistVideos('PLzzzzzzzzzzzzzzzzzzzzzzzz'), /Network Error/);
});

/* ------------------------------------------------------------------------ */
/* searchVideo                                                              */
/* ------------------------------------------------------------------------ */

test('searchVideo parses ytInitialData, filters live items and returns a continuation', async () => {
  const ctx = loadApp({
    routes: (method, url) => {
      const u = new URL(url);
      if (u.pathname === '/results') {
        assert.equal(u.searchParams.get('search_query'), 'lofi beats');
        return { status: 200, responseText: ytInitialDataSearchHtml() };
      }
      return { status: 404 };
    },
  });
  const json = await ctx.searchVideo('lofi beats');
  assert.equal(json.estimatedResults, '12345');
  const videos = json.results.filter((r) => r.video).map((r) => r.video);
  deepEqual(videos.map((v) => v.id), ['video000001', 'shelf000001']);
  assert.equal(videos[0].title, 'First Song');
  assert.equal(videos[0].duration, '3:45');
  assert.equal(videos[0].views, '1,000 views');
  assert.equal(json.results.filter((r) => r.video).length, 2);
  assert.equal(json.results[0].uploader.username, 'Channel A');
  assert.equal(json.results[0].uploader.url, 'https://www.youtube.com/@channelA');
  assert.equal(json.nextPageToken, 'CONT_TOKEN_1');
  deepEqual(json.continuation, { type: 'youtube', token: 'CONT_TOKEN_1', key: 'AIzaFAKEKEY', clientVersion: '2.20250901.01.00', visitorData: 'CgtGQUtF', q: 'lofi beats' });
  assert.equal(json.key, 'AIzaFAKEKEY');
});

test('searchVideo follows a continuation with a POST to /youtubei/v1/search (new + legacy signatures)', async () => {
  const ctx = loadApp({
    routes: (method, url, body, headers) => {
      const u = new URL(url);
      if (u.pathname === '/youtubei/v1/search') {
        assert.equal(method, 'POST');
        assert.equal(u.searchParams.get('key'), 'AIzaFAKEKEY');
        const form = JSON.parse(body);
        assert.equal(form.continuation, 'CONT_TOKEN_1');
        assert.equal(form.context.client.clientName, 'WEB');
        assert.match(form.context.client.clientVersion, /^2\.\d{8}\.\d{2}\.\d{2}$/, 'client version taken from page or fallback');
        return { status: 200, responseText: JSON.stringify(ytContinuationResponse()) };
      }
      return { status: 404 };
    },
  });
  const cont = { type: 'youtube', token: 'CONT_TOKEN_1', key: 'AIzaFAKEKEY', clientVersion: '2.20250901.01.00', visitorData: 'CgtGQUtF', q: 'lofi beats' };
  const page2 = await ctx.searchVideo('lofi beats', cont);
  deepEqual(page2.results.map((r) => r.video.id), ['page2000001']);
  assert.equal(page2.continuation.token, 'CONT_TOKEN_2');
  assert.equal(page2.continuation.q, 'lofi beats');
  const first = JSON.parse(ctx.__xhrCalls[0].body);
  assert.equal(first.context.client.clientVersion, '2.20250901.01.00', 'page config is forwarded');
  assert.equal(first.context.client.visitorData, 'CgtGQUtF');

  const legacy = await ctx.searchVideo('', 'AIzaFAKEKEY', 'CONT_TOKEN_1');
  deepEqual(legacy.results.map((r) => r.video.id), ['page2000001']);
});

test('searchVideo falls back to the Invidious search API when YouTube is unusable', async () => {
  const ctx = loadApp({
    routes: (method, url) => {
      const u = new URL(url);
      if (u.host === 'www.youtube.com') return { status: 200, responseText: '<html>consent wall</html>' };
      if (u.pathname === '/api/v1/search') {
        assert.equal(u.searchParams.get('q'), 'lofi');
        assert.equal(u.searchParams.get('type'), 'video');
        return {
          status: 200,
          responseText: JSON.stringify([
            { type: 'video', videoId: 'inv00000001', title: 'Inv one', author: 'A', authorUrl: '/channel/UC1', lengthSeconds: 3723, viewCountText: '5 views', publishedText: '1 day ago', liveNow: false },
            { type: 'video', videoId: 'inv00000002', title: 'Live', author: 'B', lengthSeconds: 0, liveNow: true },
            { type: 'channel', authorId: 'UC2' },
          ]),
        };
      }
      return { status: 404 };
    },
  });
  const json = await ctx.searchVideo('lofi');
  assert.equal(json.parser, 'invidious');
  deepEqual(json.results.map((r) => r.video.id), ['inv00000001']);
  assert.equal(json.results[0].video.duration, '1:02:03');
  assert.equal(json.results[0].uploader.url, 'https://www.youtube.com/channel/UC1');
  deepEqual(json.continuation, { type: 'invidious', q: 'lofi', page: 2 });

  const page2 = await ctx.searchVideo('lofi', json.continuation);
  assert.equal(page2.parser, 'invidious');
  const last = ctx.__xhrCalls[ctx.__xhrCalls.length - 1];
  assert.equal(new URL(last.url).searchParams.get('page'), '2');
});

test('searchVideo rejects with a readable message when both sources fail', async () => {
  const ctx = loadApp({ routes: () => ({ error: 'network' }) });
  await assert.rejects(ctx.searchVideo('anything'), (e) => typeof e === 'string' && e.length > 0);
});

test('formatSeconds renders mm:ss and h:mm:ss', () => {
  const ctx = loadApp();
  assert.equal(ctx.formatSeconds(59), '0:59');
  assert.equal(ctx.formatSeconds(61), '1:01');
  assert.equal(ctx.formatSeconds(3723), '1:02:03');
  assert.equal(ctx.formatSeconds('abc'), '');
  assert.equal(ctx.formatSeconds(-1), '');
});

/* ------------------------------------------------------------------------ */
/* instance discovery (utils.js)                                            */
/* ------------------------------------------------------------------------ */

test('getInstance filters api.invidious.io by https + api enabled + not down, healthiest first', async () => {
  const ctx = loadApp({ routes: () => ({ status: 200, responseText: JSON.stringify(INSTANCES_JSON) }) });
  const list = await ctx.getInstance();
  deepEqual(list.map((i) => i.uri), ['invidious.f5.si', 'unknown.example.org']);
  assert.equal(list[0].uptime, 82);
  assert.equal(list[0].region, 'JP');
});

test('getAvailableInvidiousInstance probes /api/v1/stats and persists the healthy list', async () => {
  const ctx = loadApp({
    localStorage: { _INVIDIOUS_INSTANCE_: 'unknown.example.org' },
    routes: (method, url) => {
      const u = new URL(url);
      if (u.host === 'api.invidious.io') return { status: 200, responseText: JSON.stringify(INSTANCES_JSON) };
      if (u.pathname === '/api/v1/stats') {
        if (u.host === 'invidious.f5.si') return { status: 200, responseText: JSON.stringify({ version: '2.0', software: { name: 'invidious' } }) };
        if (u.host === 'unknown.example.org') return { status: 200, responseText: JSON.stringify({ version: '2.0' }) };
        return { status: 200, responseText: '<html>no api</html>' };
      }
      return { error: 'network' };
    },
  });
  const result = await ctx.getAvailableInvidiousInstance();
  assert.equal(result[0].uri, 'unknown.example.org', 'currently selected instance first');
  assert.ok(result.some((r) => r.uri === 'invidious.f5.si'));
  assert.ok(!result.some((r) => r.uri === 'inv.nadeko.net'), 'api:false instances never offered');
  const persisted = JSON.parse(ctx.localStorage.getItem('_INVIDIOUS_AVAILABLE_'));
  assert.ok(Array.isArray(persisted) && persisted.includes('invidious.f5.si'));
});

test('getAvailableInvidiousInstance still works when api.invidious.io is unreachable', async () => {
  const ctx = loadApp({
    routes: (method, url) => {
      const u = new URL(url);
      if (u.host === 'api.invidious.io') return { error: 'network' };
      if (u.pathname === '/api/v1/stats') return { status: 200, responseText: '{"version":"2.0"}' };
      return { error: 'network' };
    },
  });
  const result = await ctx.getAvailableInvidiousInstance();
  assert.ok(result.length >= 1);
  assert.ok(result.some((r) => r.uri === ctx.DEFAULT_INVIDIOUS_INSTANCES[0]));
});

test('checkDomainAvailability calls back immediately for an empty list (no TDZ crash)', (t, done) => {
  const ctx = loadApp();
  ctx.checkDomainAvailability([], (result) => {
    deepEqual(result, []);
    done();
  });
});

/* ------------------------------------------------------------------------ */
/* datastorage.js                                                           */
/* ------------------------------------------------------------------------ */

test('DataStorage degrades gracefully without device storage APIs', async () => {
  const ctx = loadApp();
  const DataStorage = ctx.$eval('DataStorage');
  assert.equal(DataStorage.isAvailable(), false);
  const ds = new DataStorage(() => {}, () => {}, false);
  assert.equal(ds.available, false);
  assert.equal(ds.trailingSlash, '');
  await assert.rejects(ds.getFile('ytm/cache/a.m4a'), /Storage not available/);
  await assert.rejects(ds.addFile(['ytm'], 'a.m4a', {}), /Storage not available/);
  await assert.rejects(ds.deleteFile(['ytm'], 'a.m4a', true), /Storage not available/);
  await assert.rejects(ds.newFolder(['ytm'], 'cache'), /Unable to create folder/);
});

test('DataStorage enumerates every card and wires newFolder callbacks to the request', async () => {
  function fakeStorage(storageName, files) {
    return {
      storageName,
      enumerate() {
        const cursor = { onsuccess: null, onerror: null, done: false, result: null };
        let i = 0;
        const step = () => setImmediate(() => {
          if (i < files.length) {
            cursor.result = files[i++];
            cursor.done = false;
          } else {
            cursor.result = null;
            cursor.done = true;
          }
          cursor.onsuccess && cursor.onsuccess({ target: cursor });
        });
        cursor.continue = step;
        step();
        return cursor;
      },
      // DOMRequest look-alike: result is exposed both on the request and on evt.target
      addNamed(blob, name) {
        const req = { onsuccess: null, onerror: null, result: null };
        setImmediate(() => { req.result = name; req.onsuccess && req.onsuccess({ target: req }); });
        return req;
      },
      get(name) {
        const req = { onsuccess: null, onerror: null, result: null };
        setImmediate(() => { req.result = { name, type: 'audio/mp4', size: 1, lastModified: 0 }; req.onsuccess && req.onsuccess({ target: req }); });
        return req;
      },
      delete(name) {
        const req = { onsuccess: null, onerror: null };
        setImmediate(() => req.onsuccess && req.onsuccess({}));
        return req;
      },
      addEventListener() {},
    };
  }
  const sdcard = fakeStorage('sdcard', [{ name: '/sdcard/ytm/cache/a.m4a' }, { name: null }, { name: '/sdcard/ytm/cache/b.webm' }]);
  const sdcard1 = fakeStorage('sdcard1', [{ name: '/sdcard1/music/c.mp3' }]);
  const navigator = {
    userAgent: 'KaiOS-test',
    getDeviceStorages: () => [sdcard, sdcard1],
    getDeviceStorage: () => sdcard,
  };
  const ctx = loadApp({ navigator });
  const DataStorage = ctx.$eval('DataStorage');
  assert.equal(DataStorage.isAvailable(), true);
  const ds = new DataStorage(() => {}, () => {}, false);
  assert.equal(ds.trailingSlash, '/');

  const files = await new Promise((resolve) => ds.__getAllFiles__(resolve));
  deepEqual(files.map((f) => f.name), ['/sdcard/ytm/cache/a.m4a', '/sdcard/ytm/cache/b.webm', '/sdcard1/music/c.mp3'], 'null-name entries skipped, second card visited');

  const created = await ds.newFolder(['sdcard', 'ytm'], 'cache');
  assert.ok(created !== undefined);

  const saved = await ds.addFile(['sdcard', 'ytm', 'cache'], 'x.m4a', {});
  assert.equal(saved.name, '/sdcard/ytm/cache/x.m4a');

  const file = await ds.getFile('sdcard/ytm/cache/x.m4a');
  assert.equal(file.name, '/sdcard/ytm/cache/x.m4a');
});
