(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function trim(s) { return (s || '').replace(/^\s+|\s+$/g, ''); }
  function hasClass(el, name) { return (' ' + el.className + ' ').indexOf(' ' + name + ' ') >= 0; }
  function addClass(el, name) { if (!hasClass(el, name)) el.className = trim(el.className + ' ' + name); }
  function removeClass(el, name) { el.className = trim((' ' + el.className + ' ').replace(' ' + name + ' ', ' ')); }

  var cfg = window.APP_CONFIG || {};
  var qualities = [240, 360, 480, 720];
  var audioFormats = ['m4a', 'mp3', 'opus'];
  var autoModes = ['ask', 'video', 'audio'];
  var pollModes = ['eco', 'normal', 'fast'];
  var pollMs = { eco: 3000, normal: 1500, fast: 900 };

  var settings = {
    apiBase: trim(localStorage.getItem('kaiosApiBase') || cfg.apiBase || '').replace(/\/+$/, ''),
    token: localStorage.getItem('kaiosToken') || cfg.token || '',
    defaultQuality: parseInt(localStorage.getItem('defaultQuality') || cfg.defaultQuality || '360', 10),
    audioFormat: localStorage.getItem('audioFormat') || cfg.audioFormat || 'm4a',
    autoMode: localStorage.getItem('autoMode') || cfg.autoMode || 'ask',
    autoInfo: localStorage.getItem('autoInfo') || cfg.autoInfo || 'off',
    pollMode: localStorage.getItem('pollMode') || cfg.pollMode || 'normal'
  };

  if (qualities.indexOf(settings.defaultQuality) < 0) settings.defaultQuality = 360;
  if (audioFormats.indexOf(settings.audioFormat) < 0) settings.audioFormat = 'm4a';
  if (autoModes.indexOf(settings.autoMode) < 0) settings.autoMode = 'ask';
  if (pollModes.indexOf(settings.pollMode) < 0) settings.pollMode = 'normal';

  var shared = { url: '', title: '' };
  var pendingActivity = null;
  var activeJobId = '';
  var lastDownloadUrl = '';

  var sharedTitle = $('sharedTitle');
  var sharedUrl = $('sharedUrl');
  var msg = $('message');
  var details = $('details');
  var bar = document.querySelector('#bar span');
  var settingsBtn = $('settingsBtn');
  var settingsPanel = $('settingsPanel');
  var apiBaseInput = $('apiBase');
  var tokenInput = $('token');
  var defaultQualityBtn = $('defaultQuality');
  var audioFormatBtn = $('audioFormat');
  var autoActionBtn = $('autoAction');
  var autoInfoBtn = $('autoInfo');
  var pollModeBtn = $('pollMode');
  var serverCheckBtn = $('serverCheck');
  var searchQueryInput = $('searchQuery');
  var searchVideoBtn = $('searchVideo');
  var searchChannelBtn = $('searchChannel');
  var nextResultBtn = $('nextResult');
  var useResultBtn = $('useResult');
  var searchStatus = $('searchStatus');
  var lastBtn = $('lastBtn');
  var clearBtn = $('clearBtn');
  var searchItems = [];
  var searchIndex = 0;

  function api(path) { return settings.apiBase + path; }

  function saveSettings() {
    settings.apiBase = trim(apiBaseInput.value).replace(/\/+$/, '');
    settings.token = tokenInput.value || '';
    localStorage.setItem('kaiosApiBase', settings.apiBase);
    localStorage.setItem('kaiosToken', settings.token);
    localStorage.setItem('defaultQuality', String(settings.defaultQuality));
    localStorage.setItem('audioFormat', settings.audioFormat);
    localStorage.setItem('autoMode', settings.autoMode);
    localStorage.setItem('autoInfo', settings.autoInfo);
    localStorage.setItem('pollMode', settings.pollMode);
  }

  function autoLabel(mode) {
    if (mode === 'video') return 'Share: Auto ' + settings.defaultQuality + 'p';
    if (mode === 'audio') return 'Share: Auto Audio';
    return 'Share: Ask';
  }

  function pollLabel(mode) {
    if (mode === 'eco') return 'Poll: Eco';
    if (mode === 'fast') return 'Poll: Fast';
    return 'Poll: Normal';
  }

  function updateSettingsUI() {
    apiBaseInput.value = settings.apiBase;
    tokenInput.value = settings.token;
    defaultQualityBtn.textContent = 'Default: ' + settings.defaultQuality + 'p';
    audioFormatBtn.textContent = 'Audio: ' + settings.audioFormat;
    autoActionBtn.textContent = autoLabel(settings.autoMode);
    autoInfoBtn.textContent = 'Auto Info: ' + (settings.autoInfo === 'on' ? 'On' : 'Off');
    pollModeBtn.textContent = pollLabel(settings.pollMode);
    ['q240', 'q360', 'q480', 'q720'].forEach(function (id) { removeClass($(id), 'primary'); });
    addClass($('q' + settings.defaultQuality), 'primary');
    $('rightSoftkey').textContent = settings.defaultQuality + 'p';
  }

  function cycle(list, current) {
    var i = list.indexOf(current);
    return list[(i + 1) % list.length];
  }

  function setMessage(text, obj) {
    msg.textContent = text;
    details.textContent = obj ? JSON.stringify(obj, null, 2) : '';
  }

  function setProgress(pct) {
    pct = Math.max(0, Math.min(100, pct || 0));
    bar.style.width = pct + '%';
  }

  function firstUrl(text) {
    var m = String(text || '').match(/https?:\/\/[^\s<>"']+/i);
    return m ? m[0].replace(/[\.,\)\];]+$/, '') : '';
  }

  function extractUrl(data, source) {
    data = data || {};
    source = source || {};
    if (typeof data === 'string') return firstUrl(data);
    if (data.url) return firstUrl(data.url) || data.url;
    if (data.urls && data.urls.length) return firstUrl(data.urls[0]) || data.urls[0];
    if (data.text) return firstUrl(data.text);
    if (data.body) return firstUrl(data.body);
    if (data.href) return firstUrl(data.href) || data.href;
    if (data.blobs && data.blobs.length && typeof data.blobs[0] === 'string') return firstUrl(data.blobs[0]);
    if (source.url) return firstUrl(source.url) || source.url;
    return '';
  }

  function titleFrom(data, source) {
    data = data || {};
    source = source || {};
    return trim(data.title || data.name || data.subject || source.title || source.name || '');
  }

  function authQuery() { return settings.token ? ('?token=' + encodeURIComponent(settings.token)) : ''; }

  function saveLast(url, title) {
    if (!url) return;
    localStorage.setItem('lastSharedUrl', url);
    localStorage.setItem('lastSharedTitle', title || '');
  }

  function setShared(url, title, fromShare) {
    shared.url = trim(url || '');
    shared.title = trim(title || '');
    if (shared.url) {
      saveLast(shared.url, shared.title);
      sharedTitle.textContent = shared.title || 'ভিডিও লিংক প্রস্তুত';
      sharedUrl.textContent = shared.url;
      setMessage('Default ' + settings.defaultQuality + 'p। quality বেছে নিন অথবা Auto mode ব্যবহার করুন।');
      setProgress(0);
      if (fromShare) runAutoOnShare();
    } else {
      sharedTitle.textContent = 'লিংকের অপেক্ষায়…';
      sharedUrl.textContent = 'KaiOS Browser থেকে Options → Share → Premium Downloader নির্বাচন করুন।';
      setMessage('Browser share থেকে URL আসেনি।');
    }
  }

  function runAutoOnShare() {
    if (settings.autoMode === 'video') {
      setTimeout(function () { start('video', settings.defaultQuality); }, 250);
    } else if (settings.autoMode === 'audio') {
      setTimeout(function () { start('audio', 0); }, 250);
    } else if (settings.autoInfo === 'on') {
      setTimeout(info, 250);
    }
  }

  function request(method, path, body, cb) {
    saveSettings();
    var xhr = new XMLHttpRequest();
    xhr.open(method, api(path), true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    if (settings.token) xhr.setRequestHeader('Authorization', 'Bearer ' + settings.token);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var data = {};
      try { data = JSON.parse(xhr.responseText); } catch (e) {}
      cb(xhr.status, data);
    };
    xhr.onerror = function () { cb(0, { ok: false, error: 'নেটওয়ার্ক সমস্যা' }); };
    xhr.send(body ? JSON.stringify(body) : null);
  }

  function requireUrl() {
    if (shared.url) return true;
    setShared('', '');
    return false;
  }

  function info() {
    if (!requireUrl()) return;
    setProgress(0);
    setMessage('মেটাডাটা আনা হচ্ছে...');
    request('POST', '/api/resolve', { url: shared.url }, function (status, data) {
      if (!data.ok) return setMessage(data.error || ('Error ' + status));
      var infoData = data.info || {};
      if (infoData.title) setShared(shared.url, infoData.title, false);
      setMessage((infoData.title || 'ভিডিও') + ' — প্রস্তুত', {
        uploader: infoData.uploader,
        duration: infoData.duration,
        suggested_heights: infoData.formats && infoData.formats.suggested_heights,
        audio: infoData.formats && infoData.formats.audio_only_available
      });
    });
  }

  function start(mode, height) {
    if (!requireUrl()) return;
    if (activeJobId) return setMessage('একটি job চলছে। শেষ হলে নতুন job শুরু করুন।');
    var h = mode === 'audio' ? 0 : (height || settings.defaultQuality);
    setProgress(0);
    setMessage((mode === 'audio' ? 'Audio' : h + 'p video') + ' job তৈরি হচ্ছে...');
    request('POST', '/api/jobs', {
      url: shared.url,
      mode: mode,
      max_height: h,
      audio_format: settings.audioFormat
    }, function (status, data) {
      if (!data.ok) return setMessage(data.error || ('Error ' + status));
      activeJobId = data.job.id;
      poll(data.job.id);
    });
  }

  function finishActivity(ok, message) {
    if (!pendingActivity) return;
    try {
      if (ok && pendingActivity.postResult) pendingActivity.postResult({ ok: true, message: message || 'done' });
      if (!ok && pendingActivity.postError) pendingActivity.postError(message || 'failed');
    } catch (e) {}
    pendingActivity = null;
  }

  function poll(id) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', api('/api/jobs/' + id), true);
    if (settings.token) xhr.setRequestHeader('Authorization', 'Bearer ' + settings.token);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var data = {};
      try { data = JSON.parse(xhr.responseText); } catch (e) {}
      if (!data.ok) {
        activeJobId = '';
        finishActivity(false, data.error || 'status failed');
        return setMessage(data.error || 'স্ট্যাটাস পাওয়া যায়নি');
      }
      var job = data.job;
      setProgress(job.progress || 0);
      if (job.status === 'done') {
        activeJobId = '';
        finishActivity(true, 'download ready');
        lastDownloadUrl = api(job.download_url) + authQuery();
        setMessage('ডাউনলোড প্রস্তুত: ' + (job.filename || job.id), { size: job.file_size });
        window.location.href = lastDownloadUrl;
      } else if (job.status === 'error') {
        activeJobId = '';
        finishActivity(false, job.error || 'download failed');
        setMessage('ব্যর্থ: ' + (job.error || 'অজানা সমস্যা'));
      } else {
        setMessage((job.status === 'queued' ? 'কিউতে আছে' : 'ডাউনলোড হচ্ছে') + ' — ' + (job.progress || 0) + '%');
        setTimeout(function () { poll(id); }, pollMs[settings.pollMode] || 1500);
      }
    };
    xhr.send(null);
  }

  function serverCheck() {
    setMessage('সার্ভার চেক হচ্ছে...');
    request('GET', '/status', null, function (status, data) {
      if (!data.ok) return setMessage(data.error || ('Server error ' + status));
      setMessage('সার্ভার OK', {
        yt_dlp: data.yt_dlp_found,
        ffmpeg: data.ffmpeg_found,
        jobs: data.jobs,
        auth: data.auth_enabled,
        api_manifest: data.api_manifest_version,
        innertube: data.innertube && data.innertube.client_version
      });
    });
  }

  function renderSearchResult() {
    if (!searchItems.length) {
      searchStatus.textContent = 'Result নেই।';
      return;
    }
    var item = searchItems[searchIndex % searchItems.length];
    var label = (searchIndex + 1) + '/' + searchItems.length + ' ' + item.type + ': ' + (item.title || item.channel || item.id || 'untitled');
    searchStatus.textContent = label;
    setMessage('Search result ready — Use Result চাপুন।', item);
  }

  function searchYt(type) {
    var q = trim(searchQueryInput.value);
    if (!q) return setMessage('Search keyword লিখুন।');
    searchItems = [];
    searchIndex = 0;
    searchStatus.textContent = 'Searching...';
    setMessage('InnerTube search চলছে...');
    request('POST', '/api/yt/search', { query: q, type: type, limit: 8 }, function (status, data) {
      if (!data.ok) {
        searchStatus.textContent = 'Search failed';
        return setMessage(data.error || ('Search error ' + status));
      }
      searchItems = (data.results && data.results.items) || [];
      renderSearchResult();
    });
  }

  function nextResult() {
    if (!searchItems.length) return setMessage('আগে search করুন।');
    searchIndex = (searchIndex + 1) % searchItems.length;
    renderSearchResult();
  }

  function useResult() {
    if (!searchItems.length) return setMessage('আগে search করুন।');
    var item = searchItems[searchIndex % searchItems.length];
    if (item.type === 'video') {
      setShared(item.url, item.title, false);
      return;
    }
    if (item.type === 'channel') {
      setMessage('Channel videos আনা হচ্ছে...');
      request('POST', '/api/yt/channel', { channel_id: item.channel_id, limit: 6 }, function (status, data) {
        if (!data.ok) return setMessage(data.error || ('Channel error ' + status));
        var videos = data.results && data.results.videos || [];
        if (videos.length) {
          setShared(videos[0].url, videos[0].title, false);
          setMessage('Channel থেকে latest video select হয়েছে।', { channel: data.results.channel, video: videos[0] });
        } else {
          setMessage('Channel পাওয়া গেছে, কিন্তু video list পাওয়া যায়নি।', data.results);
        }
      });
    }
  }

  function openLast() {
    var url = localStorage.getItem('lastSharedUrl') || '';
    var title = localStorage.getItem('lastSharedTitle') || '';
    if (url) setShared(url, title, false);
    else setMessage('Last link নেই।');
  }

  function clearLocal() {
    localStorage.removeItem('lastSharedUrl');
    localStorage.removeItem('lastSharedTitle');
    lastDownloadUrl = '';
    activeJobId = '';
    setShared('', '');
    setProgress(0);
    setMessage('Local history পরিষ্কার। Settings রাখা হয়েছে।');
  }

  function toggleSettings() {
    if (hasClass(settingsPanel, 'hidden')) {
      removeClass(settingsPanel, 'hidden');
      updateSettingsUI();
      defaultQualityBtn.focus();
    } else {
      saveSettings();
      addClass(settingsPanel, 'hidden');
      settingsBtn.focus();
    }
  }

  function cycleQuality() {
    settings.defaultQuality = cycle(qualities, settings.defaultQuality);
    saveSettings();
    updateSettingsUI();
  }

  function cycleAudio() {
    settings.audioFormat = cycle(audioFormats, settings.audioFormat);
    saveSettings();
    updateSettingsUI();
  }

  function cycleAuto() {
    settings.autoMode = cycle(autoModes, settings.autoMode);
    saveSettings();
    updateSettingsUI();
  }

  function cycleAutoInfo() {
    settings.autoInfo = settings.autoInfo === 'on' ? 'off' : 'on';
    saveSettings();
    updateSettingsUI();
  }

  function cyclePoll() {
    settings.pollMode = cycle(pollModes, settings.pollMode);
    saveSettings();
    updateSettingsUI();
  }

  function handleActivity(activity) {
    pendingActivity = activity || null;
    var source = (activity && activity.source) || {};
    var data = source.data || source;
    var url = extractUrl(data, source);
    var title = titleFrom(data, source);
    if (url || !data || !data.blobs || !data.blobs.length || typeof FileReader === 'undefined') {
      setShared(url, title, true);
      return;
    }
    try {
      var reader = new FileReader();
      reader.onload = function () { setShared(firstUrl(reader.result), title, true); };
      reader.onerror = function () { setShared('', title, false); };
      reader.readAsText(data.blobs[0]);
    } catch (e) {
      setShared('', title, false);
    }
  }

  function readLaunchUrl() {
    var q = window.location.search || '';
    if (!q) return;
    var params = {};
    q.replace(/^\?/, '').split('&').forEach(function (part) {
      var p = part.split('=');
      if (!p[0]) return;
      params[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || '').replace(/\+/g, ' '));
    });
    var url = extractUrl(params.url || params.text || params.u || '');
    if (url) setShared(url, params.title || '', false);
  }

  function registerKaiOS25ActivityHandlers() {
    if (!navigator.mozSetMessageHandler) return;
    try { navigator.mozSetMessageHandler('activity', handleActivity); } catch (e) {}
    // Some vendor builds dispatch by activity name; harmless fallback.
    try { navigator.mozSetMessageHandler('share', handleActivity); } catch (e2) {}
    try { navigator.mozSetMessageHandler('view', handleActivity); } catch (e3) {}
  }

  function focusables() {
    var ids = ['infoBtn', 'q240', 'q360', 'q480', 'q720', 'audio', 'settingsBtn'];
    if (!hasClass(settingsPanel, 'hidden')) {
      ids = ids.concat([
        'defaultQuality', 'audioFormat', 'autoAction', 'autoInfo', 'pollMode', 'serverCheck',
        'apiBase', 'token', 'searchQuery', 'searchVideo', 'searchChannel', 'nextResult', 'useResult',
        'lastBtn', 'clearBtn'
      ]);
    }
    var out = [];
    ids.forEach(function (id) { var el = $(id); if (el) out.push(el); });
    return out;
  }

  function focusMove(delta) {
    var list = focusables();
    var current = document.activeElement;
    var idx = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i] === current) { idx = i; break; }
    }
    idx = (idx + delta + list.length) % list.length;
    list[idx].focus();
  }

  $('infoBtn').onclick = info;
  $('q240').onclick = function () { start('video', 240); };
  $('q360').onclick = function () { start('video', 360); };
  $('q480').onclick = function () { start('video', 480); };
  $('q720').onclick = function () { start('video', 720); };
  $('audio').onclick = function () { start('audio', 0); };
  settingsBtn.onclick = toggleSettings;
  defaultQualityBtn.onclick = cycleQuality;
  audioFormatBtn.onclick = cycleAudio;
  autoActionBtn.onclick = cycleAuto;
  autoInfoBtn.onclick = cycleAutoInfo;
  pollModeBtn.onclick = cyclePoll;
  serverCheckBtn.onclick = serverCheck;
  searchVideoBtn.onclick = function () { searchYt('video'); };
  searchChannelBtn.onclick = function () { searchYt('channel'); };
  nextResultBtn.onclick = nextResult;
  useResultBtn.onclick = useResult;
  lastBtn.onclick = openLast;
  clearBtn.onclick = clearLocal;

  updateSettingsUI();
  registerKaiOS25ActivityHandlers();
  readLaunchUrl();
  if (!shared.url) setShared(localStorage.getItem('lastSharedUrl') || '', localStorage.getItem('lastSharedTitle') || '', false);
  setTimeout(function () { $('q' + settings.defaultQuality).focus(); }, 200);

  document.addEventListener('keydown', function (e) {
    var key = e.key || e.keyCode;
    if (key === 'ArrowDown' || key === 40 || key === 'ArrowRight' || key === 39) { focusMove(1); e.preventDefault(); }
    if (key === 'ArrowUp' || key === 38 || key === 'ArrowLeft' || key === 37) { focusMove(-1); e.preventDefault(); }
    if (key === 'SoftLeft' || key === 112) info();
    if (key === 'SoftRight' || key === 113) start('video', settings.defaultQuality);
    if (key === '1') info();
    if (key === '2') start('video', 240);
    if (key === '3') start('video', 360);
    if (key === '4') start('audio', 0);
    if (key === '5') start('video', 480);
    if (key === '7') start('video', 720);
    if (key === '8') start('video', settings.defaultQuality);
    if (key === '9') cycleAuto();
    if (key === '0') toggleSettings();
  });
}());
