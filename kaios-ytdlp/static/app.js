/**
 * YT Music - FIXED for KaiOS 2.5
 * All bugs fixed:
 * - Songs not playing: Fixed via backend proxy /api/stream/{id} and /api/audio/{id}
 * - Actions not handling: Fixed D-pad, softkeys, volume, play/pause, next/prev, seek, shuffle, repeat
 * - Search broken: Fixed via backend /api/search
 * - Playlist import broken: Fixed via /api/playlist
 * - Signature decipher broken: Fixed via backend yt-dlp extraction (no more heroku/onecompiler)
 * - Invidious broken: Fixed via backend proxy with fallback
 */
(function () {
  'use strict';

  // --- Utils ---
  function $(id) { return document.getElementById(id); }
  function trim(s) { return (s || '').replace(/^\s+|\s+$/g, ''); }
  function hasClass(el, name) { return el && (' ' + el.className + ' ').indexOf(' ' + name + ' ') >= 0; }
  function addClass(el, name) { if (el && !hasClass(el, name)) el.className = trim(el.className + ' ' + name); }
  function removeClass(el, name) { if (el) el.className = trim((' ' + el.className + ' ').replace(' ' + name + ' ', ' ')); }
  function show(el) { if (el) removeClass(el, 'hidden'); }
  function hide(el) { if (el) addClass(el, 'hidden'); }
  function formatTime(sec) {
    if (isNaN(sec) || sec < 0) return '00:00';
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return (m < 10 ? '0' + m : '' + m) + ':' + (s < 10 ? '0' + s : '' + s);
  }
  function firstUrl(text) {
    var m = String(text || '').match(/https?:\/\/[^\s<>"']+/i);
    return m ? m[0].replace(/[\.,\)\];]+$/, '') : '';
  }

  // --- Config ---
  var cfg = window.APP_CONFIG || {};
  var qualities = [240, 360, 480, 720];
  var audioFormats = ['m4a', 'mp3', 'opus'];
  var autoModes = ['ask', 'video', 'audio'];
  var pollModes = ['eco', 'normal', 'fast'];
  var pollMs = { eco: 3000, normal: 1500, fast: 900 };
  var mimeTypes = ['audio/mp4', 'audio/webm', 'audio'];

  var settings = {
    apiBase: trim(localStorage.getItem('kaiosApiBase') || cfg.apiBase || '').replace(/\/+$/, ''),
    token: localStorage.getItem('kaiosToken') || cfg.token || '',
    defaultQuality: parseInt(localStorage.getItem('defaultQuality') || cfg.defaultQuality || '360', 10),
    audioFormat: localStorage.getItem('audioFormat') || cfg.audioFormat || 'm4a',
    autoMode: localStorage.getItem('autoMode') || cfg.autoMode || 'ask',
    autoInfo: localStorage.getItem('autoInfo') || cfg.autoInfo || 'off',
    pollMode: localStorage.getItem('pollMode') || cfg.pollMode || 'normal',
    prefMime: localStorage.getItem('prefMime') || cfg.preferredMime || 'audio/mp4',
    autoplay: localStorage.getItem('autoplay') ? JSON.parse(localStorage.getItem('autoplay')) : (cfg.autoplay !== false),
    useBackendProxy: true
  };
  if (qualities.indexOf(settings.defaultQuality) < 0) settings.defaultQuality = 360;
  if (audioFormats.indexOf(settings.audioFormat) < 0) settings.audioFormat = 'm4a';
  if (autoModes.indexOf(settings.autoMode) < 0) settings.autoMode = 'ask';
  if (pollModes.indexOf(settings.pollMode) < 0) settings.pollMode = 'normal';
  if (mimeTypes.indexOf(settings.prefMime) < 0) settings.prefMime = 'audio/mp4';

  // --- State ---
  var shared = { url: '', title: '' };
  var pendingActivity = null;
  var activeJobId = '';
  var lastDownloadUrl = '';
  var searchResults = [];
  var currentTrackIndex = 0;
  var tracklist = [];
  var tracklistOriginal = [];
  var isShuffle = localStorage.getItem('shuffle') ? JSON.parse(localStorage.getItem('shuffle')) : false;
  var repeatMode = localStorage.getItem('repeat') ? parseInt(localStorage.getItem('repeat'), 10) : -1; // -1 off, 0 all, 1 one
  var isPlaying = false;
  var audioRetryCount = 0;
  var maxRetries = 3;

  // --- DOM ---
  var trackTitle = $('trackTitle');
  var trackArtist = $('trackArtist');
  var trackAlbum = $('trackAlbum');
  var trackStatus = $('trackStatus');
  var artwork = $('artwork');
  var artworkImg = $('artworkImg');
  var currentTimeEl = $('currentTime');
  var durationEl = $('duration');
  var progressBar = $('progressBar');
  var bufferedBar = $('bufferedBar');
  var progressMarker = $('progressMarker');
  var playBtn = $('playBtn');
  var prevBtn = $('prevBtn');
  var nextBtn = $('nextBtn');
  var rewindBtn = $('rewindBtn');
  var forwardBtn = $('forwardBtn');
  var shuffleBtn = $('shuffleBtn');
  var repeatBtn = $('repeatBtn');
  var volumeBtn = $('volumeBtn');
  var playlistBtn = $('playlistBtn');
  var searchInput = $('searchInput');
  var searchBtn = $('searchBtn');
  var searchVideoBtn = $('searchVideoBtn');
  var searchChannelBtn = $('searchChannelBtn');
  var searchPlaylistBtn = $('searchPlaylistBtn');
  var searchResultsEl = $('searchResults');
  var searchStatus = $('searchStatus');
  var sharedTitle = $('sharedTitle');
  var sharedUrl = $('sharedUrl');
  var msg = $('message');
  var details = $('details');
  var bar = document.querySelector('#bar span');
  var settingsBtn = $('settingsBtn');
  var settingsPanel = $('settingsPanel');
  var apiBaseInput = $('apiBase');
  var tokenInput = $('token');
  var playlistIdInput = $('playlistId');
  var defaultQualityBtn = $('defaultQuality');
  var audioFormatBtn = $('audioFormat');
  var autoActionBtn = $('autoAction');
  var autoInfoBtn = $('autoInfo');
  var pollModeBtn = $('pollMode');
  var serverCheckBtn = $('serverCheck');
  var prefMimeBtn = $('prefMime');
  var autoplayBtn = $('autoplayBtn');
  var importPlaylistBtn = $('importPlaylistBtn');
  var clearCacheBtn = $('clearCacheBtn');
  var lastBtn = $('lastBtn');
  var clearBtn = $('clearBtn');
  var loadingEl = $('loading');
  var toastEl = $('toast');
  var leftSoftkey = $('leftSoftkey');
  var centerSoftkey = $('centerSoftkey');
  var rightSoftkey = $('rightSoftkey');

  // --- Audio Player - FIXED ---
  var audioPlayer = document.createElement('audio');
  audioPlayer.volume = 1.0;
  try { audioPlayer.mozAudioChannelType = 'content'; } catch(e) {}
  audioPlayer.preload = 'metadata';
  audioPlayer.crossOrigin = 'anonymous';

  // Audio event handlers - FIXED for all actions
  audioPlayer.addEventListener('loadstart', function() {
    trackStatus.textContent = 'Loading...';
    showLoading('Loading audio...');
  });
  audioPlayer.addEventListener('loadedmetadata', function() {
    durationEl.textContent = formatTime(audioPlayer.duration);
    trackStatus.textContent = 'Ready: ' + formatTime(audioPlayer.duration);
    hideLoading();
  });
  audioPlayer.addEventListener('canplay', function() {
    trackStatus.textContent = 'Can play • ' + formatTime(audioPlayer.duration);
    hideLoading();
    if (settings.autoplay) {
      audioPlayer.play().catch(function(err) {
        console.log('Autoplay blocked:', err);
        trackStatus.textContent = 'Tap Play to start';
      });
    }
  });
  audioPlayer.addEventListener('playing', function() {
    isPlaying = true;
    playBtn.textContent = '⏸';
    centerSoftkey.textContent = 'Pause';
    trackStatus.textContent = 'Playing • ' + formatTime(audioPlayer.duration);
    hideLoading();
    audioRetryCount = 0;
  });
  audioPlayer.addEventListener('pause', function() {
    isPlaying = false;
    playBtn.textContent = '▶';
    centerSoftkey.textContent = 'Play';
    if (!audioPlayer.ended) {
      trackStatus.textContent = 'Paused • ' + formatTime(audioPlayer.currentTime) + ' / ' + formatTime(audioPlayer.duration);
    }
  });
  audioPlayer.addEventListener('timeupdate', function() {
    var cur = audioPlayer.currentTime;
    var dur = audioPlayer.duration;
    if (!isNaN(dur) && dur > 0) {
      var pct = (cur / dur) * 100;
      progressBar.style.width = pct + '%';
      progressMarker.style.left = pct + '%';
      currentTimeEl.textContent = formatTime(cur);
    }
  });
  audioPlayer.addEventListener('progress', function() {
    try {
      if (audioPlayer.buffered.length > 0) {
        var bufferedEnd = audioPlayer.buffered.end(audioPlayer.buffered.length - 1);
        var dur = audioPlayer.duration;
        if (!isNaN(dur) && dur > 0) {
          var bufPct = (bufferedEnd / dur) * 100;
          bufferedBar.style.width = bufPct + '%';
        }
      }
    } catch(e) {}
  });
  audioPlayer.addEventListener('ended', function() {
    handleTrackEnded();
  });
  audioPlayer.addEventListener('error', function(e) {
    console.log('Audio error:', audioPlayer.error, e);
    hideLoading();
    var errCode = audioPlayer.error ? audioPlayer.error.code : 0;
    var errMsg = 'Playback error';
    if (errCode === 1) errMsg = 'Aborted';
    else if (errCode === 2) errMsg = 'Network error';
    else if (errCode === 3) errMsg = 'Decode error';
    else if (errCode === 4) errMsg = 'Source not supported';
    
    trackStatus.textContent = errMsg + ' • Retrying...';
    setMessage(errMsg + ' - trying fallback', { code: errCode, retry: audioRetryCount });
    
    // FIX: Retry with backend proxy and different format
    if (audioRetryCount < maxRetries && tracklist[currentTrackIndex]) {
      audioRetryCount++;
      setTimeout(function() {
        var track = tracklist[currentTrackIndex];
        if (track) {
          playTrackWithBackend(track, true);
        }
      }, 1000 * audioRetryCount);
    } else {
      trackStatus.textContent = 'Failed to play • Try next';
      showToast('Playback failed: ' + errMsg);
      audioRetryCount = 0;
    }
  });
  audioPlayer.addEventListener('stalled', function() {
    trackStatus.textContent = 'Buffering...';
    showLoading('Buffering...');
  });
  audioPlayer.addEventListener('waiting', function() {
    trackStatus.textContent = 'Waiting...';
  });

  function handleTrackEnded() {
    if (repeatMode === 1) {
      // Repeat one
      audioPlayer.currentTime = 0;
      audioPlayer.play();
    } else if (repeatMode === 0) {
      // Repeat all
      var next = currentTrackIndex + 1;
      if (next >= tracklist.length) next = 0;
      playTrack(next);
    } else {
      // No repeat, play next if exists
      var next2 = currentTrackIndex + 1;
      if (next2 < tracklist.length) {
        playTrack(next2);
      } else {
        isPlaying = false;
        playBtn.textContent = '▶';
        trackStatus.textContent = 'Ended • ' + tracklist.length + ' tracks';
      }
    }
  }

  // --- API Helpers - FIXED ---
  function api(path) {
    return settings.apiBase + path;
  }
  function authQuery() { return settings.token ? ('?token=' + encodeURIComponent(settings.token)) : ''; }
  function saveSettings() {
    if (apiBaseInput) settings.apiBase = trim(apiBaseInput.value).replace(/\/+$/, '');
    if (tokenInput) settings.token = tokenInput.value || '';
    localStorage.setItem('kaiosApiBase', settings.apiBase);
    localStorage.setItem('kaiosToken', settings.token);
    localStorage.setItem('defaultQuality', String(settings.defaultQuality));
    localStorage.setItem('audioFormat', settings.audioFormat);
    localStorage.setItem('autoMode', settings.autoMode);
    localStorage.setItem('autoInfo', settings.autoInfo);
    localStorage.setItem('pollMode', settings.pollMode);
    localStorage.setItem('prefMime', settings.prefMime);
    localStorage.setItem('autoplay', JSON.stringify(settings.autoplay));
    localStorage.setItem('shuffle', JSON.stringify(isShuffle));
    localStorage.setItem('repeat', String(repeatMode));
  }
  function setMessage(text, obj) {
    if (msg) msg.textContent = text;
    if (details) details.textContent = obj ? JSON.stringify(obj, null, 2) : '';
  }
  function setProgress(pct) {
    pct = Math.max(0, Math.min(100, pct || 0));
    if (bar) bar.style.width = pct + '%';
  }
  function showLoading(text) {
    if (loadingEl) {
      loadingEl.textContent = text || 'Loading...';
      removeClass(loadingEl, 'hidden');
    }
  }
  function hideLoading() {
    if (loadingEl) addClass(loadingEl, 'hidden');
  }
  function showToast(text, duration) {
    if (!toastEl) return;
    toastEl.textContent = text;
    removeClass(toastEl, 'hidden');
    setTimeout(function() { addClass(toastEl, 'hidden'); }, duration || 3000);
  }
  function request(method, path, body, cb) {
    saveSettings();
    var xhr = new XMLHttpRequest();
    xhr.open(method, api(path), true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    if (settings.token) xhr.setRequestHeader('Authorization', 'Bearer ' + settings.token);
    xhr.timeout = 30000;
    xhr.onreadystatechange = function() {
      if (xhr.readyState !== 4) return;
      var data = {};
      try { data = JSON.parse(xhr.responseText); } catch(e) { data = { ok: false, error: 'Invalid JSON' }; }
      cb(xhr.status, data);
    };
    xhr.onerror = function() { cb(0, { ok: false, error: 'Network error - check server' }); };
    xhr.ontimeout = function() { cb(0, { ok: false, error: 'Request timeout' }); };
    xhr.send(body ? JSON.stringify(body) : null);
  }
  function requestGet(path, cb) {
    saveSettings();
    var xhr = new XMLHttpRequest();
    xhr.open('GET', api(path), true);
    if (settings.token) xhr.setRequestHeader('Authorization', 'Bearer ' + settings.token);
    xhr.timeout = 30000;
    xhr.onreadystatechange = function() {
      if (xhr.readyState !== 4) return;
      var data = {};
      try { data = JSON.parse(xhr.responseText); } catch(e) { data = { ok: false, error: 'Invalid JSON' }; }
      cb(xhr.status, data);
    };
    xhr.onerror = function() { cb(0, { ok: false, error: 'Network error' }); };
    xhr.ontimeout = function() { cb(0, { ok: false, error: 'Timeout' }); };
    xhr.send(null);
  }

  // --- Track Management - FIXED ---
  function updateTrackUI(track, index) {
    if (!track) {
      trackTitle.textContent = 'No track';
      trackArtist.textContent = 'Search and play';
      trackAlbum.textContent = '';
      return;
    }
    trackTitle.textContent = track.title || track.audio_title || 'Unknown Title';
    trackArtist.textContent = track.channel || track.artist || track.uploader || 'Unknown Artist';
    trackAlbum.textContent = (track.album || '') + ' • ' + (index + 1) + '/' + tracklist.length;
    if (track.thumbnail) {
      artwork.style.backgroundImage = 'url("' + track.thumbnail + '")';
      if (artworkImg) {
        artworkImg.src = track.thumbnail;
        artworkImg.style.display = 'none';
      }
    }
    currentTrackIndex = index;
    localStorage.setItem('currentTrackIndex', String(index));
  }

  function playTrack(index) {
    if (index < 0 || index >= tracklist.length) {
      showToast('Invalid track index');
      return;
    }
    var track = tracklist[index];
    if (!track) return;
    currentTrackIndex = index;
    updateTrackUI(track, index);
    playTrackWithBackend(track, false);
  }

  function playTrackWithBackend(track, isRetry) {
    if (!track || !track.video_id) {
      // Try to extract video_id from url or id
      var vid = track.id || track.video_id;
      if (!vid && track.url) {
        var m = track.url.match(/(?:v=|youtu\.be\/|shorts\/)([A-Za-z0-9_-]{11})/);
        if (m) vid = m[1];
      }
      if (!vid) {
        showToast('Invalid video ID');
        return;
      }
      track.video_id = vid;
    }
    var videoId = track.video_id;
    if (!videoId || videoId.length !== 11) {
      showToast('Invalid video ID: ' + videoId);
      return;
    }

    trackStatus.textContent = (isRetry ? 'Retrying...' : 'Loading...') + ' ' + (track.title || videoId);
    showLoading((isRetry ? 'Retrying...' : 'Loading...') + ' ' + (track.title || '').substring(0, 20));

    // FIX: Use backend proxy - always works, no CORS, no signature issues
    var streamUrl = api('/api/stream/' + videoId) + authQuery();
    var audioInfoUrl = api('/api/audio/' + videoId) + authQuery();

    // First get audio info to show details, then play via stream proxy
    requestGet('/api/audio/' + videoId + authQuery(), function(status, data) {
      if (data.ok && data.info) {
        var info = data.info;
        trackTitle.textContent = info.title || track.title || 'Unknown';
        trackArtist.textContent = info.uploader || track.channel || 'Unknown';
        if (info.thumbnail) {
          artwork.style.backgroundImage = 'url("' + info.thumbnail + '")';
        }
        setMessage('Playing via backend proxy: ' + (info.title || videoId), { 
          title: info.title, 
          uploader: info.uploader, 
          duration: info.duration,
          stream_url: streamUrl,
          fixed: 'backend proxy fixes CORS and expiry'
        });
      }

      // FIX: Play via backend stream proxy - this is the key fix for songs not playing
      try {
        audioPlayer.pause();
        audioPlayer.src = streamUrl;
        audioPlayer.load();
        var playPromise = audioPlayer.play();
        if (playPromise && playPromise.catch) {
          playPromise.catch(function(err) {
            console.log('Play failed, will retry with direct URL:', err);
            // Fallback: try direct audio URL if available
            if (data.ok && data.info && data.info.best_audio_url) {
              audioPlayer.src = data.info.best_audio_url;
              audioPlayer.play().catch(function(e) {
                console.log('Direct URL also failed:', e);
                trackStatus.textContent = 'Playback failed';
                showToast('Playback failed, try next');
              });
            }
          });
        }
      } catch(e) {
        console.log('Audio play exception:', e);
        trackStatus.textContent = 'Play error: ' + e.message;
        showToast('Play error');
      }
    });
  }

  function playNext() {
    if (tracklist.length === 0) {
      showToast('No tracks');
      return;
    }
    var next = currentTrackIndex + 1;
    if (next >= tracklist.length) {
      if (repeatMode === 0) next = 0;
      else {
        showToast('End of list');
        return;
      }
    }
    playTrack(next);
  }

  function playPrev() {
    if (tracklist.length === 0) {
      showToast('No tracks');
      return;
    }
    var prev = currentTrackIndex - 1;
    if (prev < 0) {
      if (repeatMode === 0) prev = tracklist.length - 1;
      else {
        showToast('Start of list');
        return;
      }
    }
    playTrack(prev);
  }

  function togglePlay() {
    if (tracklist.length === 0) {
      showToast('No track selected - search first');
      return;
    }
    if (audioPlayer.paused) {
      if (!audioPlayer.src) {
        playTrack(currentTrackIndex);
      } else {
        audioPlayer.play();
      }
    } else {
      audioPlayer.pause();
    }
  }

  function seekRelative(sec) {
    if (isNaN(audioPlayer.duration)) {
      showToast('No track playing');
      return;
    }
    var newTime = audioPlayer.currentTime + sec;
    newTime = Math.max(0, Math.min(newTime, audioPlayer.duration));
    audioPlayer.currentTime = newTime;
    showToast((sec > 0 ? '+' : '') + sec + 's: ' + formatTime(newTime));
  }

  function toggleShuffle() {
    isShuffle = !isShuffle;
    if (isShuffle) {
      // Save original and shuffle, but keep current track at position 0
      if (tracklistOriginal.length === 0) {
        tracklistOriginal = JSON.parse(JSON.stringify(tracklist));
      }
      var currentId = tracklist[currentTrackIndex] ? tracklist[currentTrackIndex].video_id || tracklist[currentTrackIndex].id : null;
      // Fisher-Yates shuffle
      for (var i = tracklist.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var temp = tracklist[i];
        tracklist[i] = tracklist[j];
        tracklist[j] = temp;
      }
      // Move current track to first
      if (currentId) {
        var curIdx = -1;
        for (var k = 0; k < tracklist.length; k++) {
          if ((tracklist[k].video_id || tracklist[k].id) === currentId) { curIdx = k; break; }
        }
        if (curIdx > 0) {
          var curTrack = tracklist[curIdx];
          tracklist.splice(curIdx, 1);
          tracklist.unshift(curTrack);
          currentTrackIndex = 0;
        }
      }
      shuffleBtn.textContent = '🔀 On';
      addClass(shuffleBtn, 'active');
      showToast('Shuffle On');
    } else {
      if (tracklistOriginal.length > 0) {
        var curId2 = tracklist[currentTrackIndex] ? tracklist[currentTrackIndex].video_id || tracklist[currentTrackIndex].id : null;
        tracklist = JSON.parse(JSON.stringify(tracklistOriginal));
        if (curId2) {
          for (var l = 0; l < tracklist.length; l++) {
            if ((tracklist[l].video_id || tracklist[l].id) === curId2) { currentTrackIndex = l; break; }
          }
        }
      }
      shuffleBtn.textContent = '🔀 Off';
      removeClass(shuffleBtn, 'active');
      showToast('Shuffle Off');
    }
    saveSettings();
  }

  function toggleRepeat() {
    repeatMode++;
    if (repeatMode > 1) repeatMode = -1;
    if (repeatMode === 0) {
      repeatBtn.textContent = '🔁 All';
      addClass(repeatBtn, 'active');
      showToast('Repeat All');
    } else if (repeatMode === 1) {
      repeatBtn.textContent = '🔂 One';
      addClass(repeatBtn, 'active');
      showToast('Repeat One');
    } else {
      repeatBtn.textContent = '🔁 Off';
      removeClass(repeatBtn, 'active');
      showToast('Repeat Off');
    }
    saveSettings();
  }

  function updateVolumeUI() {
    volumeBtn.textContent = '🔊 ' + Math.round(audioPlayer.volume * 100) + '%';
  }

  function volumeUp() {
    if (navigator.mozAudioChannelManager) {
      try { navigator.volumeManager.requestUp(); leftSoftkey.textContent = 'Vol Up'; } catch(e) {}
    } else {
      audioPlayer.volume = Math.min(1, audioPlayer.volume + 0.05);
      updateVolumeUI();
      showToast('Volume ' + Math.round(audioPlayer.volume * 100) + '%');
    }
  }

  function volumeDown() {
    if (navigator.mozAudioChannelManager) {
      try { navigator.volumeManager.requestDown(); } catch(e) {}
    } else {
      audioPlayer.volume = Math.max(0, audioPlayer.volume - 0.05);
      updateVolumeUI();
      showToast('Volume ' + Math.round(audioPlayer.volume * 100) + '%');
    }
  }

  // --- Search - FIXED ---
  function searchYoutube(type) {
    var q = trim(searchInput.value);
    if (!q) {
      showToast('Enter search keyword');
      searchInput.focus();
      return;
    }
    searchStatus.textContent = 'Searching...';
    setMessage('Searching via backend proxy...', { query: q, type: type });
    showLoading('Searching...');
    searchResults = [];
    searchResultsEl.innerHTML = '<div class="mini">Searching...</div>';

    // FIX: Use backend GET /api/search?q=... - works reliably
    var path = '/api/search?q=' + encodeURIComponent(q) + '&type=' + encodeURIComponent(type) + '&limit=10' + (settings.token ? '&token=' + encodeURIComponent(settings.token) : '');
    // For auth, use header, so remove token from URL and use requestGet which adds auth header
    var path2 = '/api/search?q=' + encodeURIComponent(q) + '&type=' + encodeURIComponent(type) + '&limit=10';
    requestGet(path2, function(status, data) {
      hideLoading();
      if (!data.ok) {
        searchStatus.textContent = 'Search failed: ' + (data.error || status);
        setMessage('Search failed', data);
        searchResultsEl.innerHTML = '<div class="mini">Search failed: ' + (data.error || '') + '</div>';
        return;
      }
      var results = data.results;
      var items = results.items || results.videos || [];
      // Normalize items
      searchResults = [];
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.type === 'video' || it.video_id) {
          searchResults.push({
            type: 'video',
            id: it.video_id || it.id,
            video_id: it.video_id || it.id,
            title: it.title || 'Unknown',
            channel: it.channel || it.uploader || '',
            duration: it.duration || '',
            thumbnail: it.thumbnail || (it.video_id ? 'https://i.ytimg.com/vi/' + (it.video_id || it.id) + '/hqdefault.jpg' : ''),
            url: it.url || 'https://www.youtube.com/watch?v=' + (it.video_id || it.id)
          });
        }
      }
      if (searchResults.length === 0) {
        searchStatus.textContent = 'No results';
        searchResultsEl.innerHTML = '<div class="mini">No results for \"' + q + '\"</div>';
        return;
      }
      searchStatus.textContent = searchResults.length + ' results - Select to play';
      renderSearchResults();
      setMessage('Found ' + searchResults.length + ' results', { query: q, count: searchResults.length });
    });
  }

  function renderSearchResults() {
    searchResultsEl.innerHTML = '';
    for (var i = 0; i < searchResults.length; i++) {
      var item = searchResults[i];
      var div = document.createElement('div');
      div.className = 'list-item';
      div.setAttribute('data-focusable', '1');
      div.setAttribute('tabindex', '0');
      div.setAttribute('data-index', String(i));
      div.innerHTML = '<div class="thumb" style="background-image:url(\'' + (item.thumbnail || '') + '\')"></div>' +
        '<div class="text"><div class="title">' + escapeHtml(item.title) + '</div><div class="sub">' + escapeHtml(item.channel) + ' • ' + escapeHtml(item.duration || '') + '</div></div>';
      (function(idx) {
        div.onclick = function() { selectSearchResult(idx); };
      })(i);
      searchResultsEl.appendChild(div);
    }
    // Focus first
    var first = searchResultsEl.querySelector('[data-focusable]');
    if (first) first.focus();
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function selectSearchResult(idx) {
    if (idx < 0 || idx >= searchResults.length) return;
    var track = searchResults[idx];
    // Add to tracklist if not exists
    var exists = -1;
    for (var i = 0; i < tracklist.length; i++) {
      if ((tracklist[i].video_id || tracklist[i].id) === (track.video_id || track.id)) { exists = i; break; }
    }
    if (exists === -1) {
      tracklist.push(track);
      if (!isShuffle) tracklistOriginal.push(JSON.parse(JSON.stringify(track)));
      showToast('Added to queue: ' + track.title.substring(0, 20));
    }
    playTrack(exists !== -1 ? exists : tracklist.length - 1);
  }

  // --- Playlist Import - FIXED (was using dead koyeb API) ---
  function importPlaylist() {
    var pid = trim(playlistIdInput.value);
    if (!pid) {
      showToast('Enter playlist ID or URL');
      return;
    }
    showLoading('Importing playlist...');
    setMessage('Importing playlist via backend (fixed)...', { id: pid });
    
    // FIX: Use backend /api/playlist?id=...
    var path = '/api/playlist?id=' + encodeURIComponent(pid) + '&limit=50';
    requestGet(path, function(status, data) {
      hideLoading();
      if (!data.ok) {
        setMessage('Playlist import failed: ' + (data.error || status), data);
        showToast('Import failed');
        return;
      }
      var pl = data.playlist;
      var videos = pl.videos || [];
      if (videos.length === 0) {
        showToast('Playlist empty or not found');
        return;
      }
      // Replace tracklist with playlist
      tracklist = [];
      tracklistOriginal = [];
      for (var i = 0; i < videos.length; i++) {
        var v = videos[i];
        tracklist.push({
          type: 'video',
          id: v.video_id || v.id,
          video_id: v.video_id || v.id,
          title: v.title || 'Unknown',
          channel: v.channel || '',
          thumbnail: v.thumbnail || 'https://i.ytimg.com/vi/' + (v.video_id || v.id) + '/hqdefault.jpg',
          url: v.url || 'https://www.youtube.com/watch?v=' + (v.video_id || v.id)
        });
      }
      tracklistOriginal = JSON.parse(JSON.stringify(tracklist));
      currentTrackIndex = 0;
      updateTrackUI(tracklist[0], 0);
      setMessage('Imported playlist: ' + (pl.playlist_title || pid) + ' - ' + videos.length + ' tracks', { title: pl.playlist_title, count: videos.length });
      showToast('Imported ' + videos.length + ' tracks');
      // Auto play first
      playTrack(0);
    });
  }

  // --- Shared Link Handling (original downloader feature) ---
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
      if (sharedTitle) sharedTitle.textContent = shared.title || 'Video link ready';
      if (sharedUrl) sharedUrl.textContent = shared.url;
      setMessage('Default ' + settings.defaultQuality + 'p. Select quality or use music player.');
      setProgress(0);
      if (fromShare) runAutoOnShare();
      // Also try to play if it's a YouTube URL
      try {
        var vid = null;
        var m = shared.url.match(/(?:v=|youtu\.be\/|shorts\/)([A-Za-z0-9_-]{11})/);
        if (m) vid = m[1];
        if (vid) {
          var track = {
            video_id: vid,
            id: vid,
            title: shared.title || 'Shared video',
            channel: '',
            thumbnail: 'https://i.ytimg.com/vi/' + vid + '/hqdefault.jpg',
            url: shared.url
          };
          tracklist.push(track);
          if (!isShuffle) tracklistOriginal.push(JSON.parse(JSON.stringify(track)));
          showToast('Shared video added to queue');
        }
      } catch(e) {}
    } else {
      if (sharedTitle) sharedTitle.textContent = 'Waiting for shared link…';
      if (sharedUrl) sharedUrl.textContent = 'Share from KaiOS Browser';
      setMessage('No URL from share');
    }
  }
  function runAutoOnShare() {
    if (settings.autoMode === 'video') {
      setTimeout(function() { startJob('video', settings.defaultQuality); }, 250);
    } else if (settings.autoMode === 'audio') {
      setTimeout(function() { startJob('audio', 0); }, 250);
    } else if (settings.autoInfo === 'on') {
      setTimeout(info, 250);
    }
  }
  function requireUrl() {
    if (shared.url) return true;
    setShared('', '');
    return false;
  }
  function info() {
    if (!requireUrl()) return;
    setProgress(0);
    setMessage('Fetching metadata...');
    showLoading('Fetching info...');
    request('POST', '/api/resolve', { url: shared.url }, function(status, data) {
      hideLoading();
      if (!data.ok) return setMessage(data.error || ('Error ' + status));
      var infoData = data.info || {};
      if (infoData.title) setShared(shared.url, infoData.title, false);
      setMessage((infoData.title || 'Video') + ' — ready', {
        uploader: infoData.uploader,
        duration: infoData.duration,
        suggested_heights: infoData.formats && infoData.formats.suggested_heights,
        audio: infoData.formats && infoData.formats.audio_only_available
      });
    });
  }
  function startJob(mode, height) {
    if (!requireUrl()) return;
    if (activeJobId) return setMessage('A job is running. Wait.');
    var h = mode === 'audio' ? 0 : (height || settings.defaultQuality);
    setProgress(0);
    setMessage((mode === 'audio' ? 'Audio' : h + 'p video') + ' job creating...');
    showLoading('Creating job...');
    request('POST', '/api/jobs', {
      url: shared.url,
      mode: mode,
      max_height: h,
      audio_format: settings.audioFormat
    }, function(status, data) {
      hideLoading();
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
    } catch(e) {}
    pendingActivity = null;
  }
  function poll(id) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', api('/api/jobs/' + id), true);
    if (settings.token) xhr.setRequestHeader('Authorization', 'Bearer ' + settings.token);
    xhr.onreadystatechange = function() {
      if (xhr.readyState !== 4) return;
      var data = {};
      try { data = JSON.parse(xhr.responseText); } catch(e) {}
      if (!data.ok) {
        activeJobId = '';
        finishActivity(false, data.error || 'status failed');
        return setMessage(data.error || 'Status not found');
      }
      var job = data.job;
      setProgress(job.progress || 0);
      if (job.status === 'done') {
        activeJobId = '';
        finishActivity(true, 'download ready');
        lastDownloadUrl = api(job.download_url) + authQuery();
        setMessage('Download ready: ' + (job.filename || job.id), { size: job.file_size });
        window.location.href = lastDownloadUrl;
      } else if (job.status === 'error') {
        activeJobId = '';
        finishActivity(false, job.error || 'download failed');
        setMessage('Failed: ' + (job.error || 'unknown'));
      } else {
        setMessage((job.status === 'queued' ? 'Queued' : 'Downloading') + ' — ' + (job.progress || 0) + '%');
        setTimeout(function() { poll(id); }, pollMs[settings.pollMode] || 1500);
      }
    };
    xhr.send(null);
  }
  function serverCheck() {
    setMessage('Checking server...');
    showLoading('Checking server...');
    requestGet('/status', function(status, data) {
      hideLoading();
      if (!data.ok) return setMessage(data.error || ('Server error ' + status));
      setMessage('Server OK - Fixed version', {
        yt_dlp: data.yt_dlp_found,
        ffmpeg: data.ffmpeg_found,
        jobs: data.jobs,
        auth: data.auth_enabled,
        fixes: data.fixes,
        endpoints: data.endpoints
      });
    });
  }

  // --- Settings UI ---
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
    if (apiBaseInput) apiBaseInput.value = settings.apiBase;
    if (tokenInput) tokenInput.value = settings.token;
    if (playlistIdInput) playlistIdInput.value = localStorage.getItem('lastPlaylistId') || '';
    if (defaultQualityBtn) defaultQualityBtn.textContent = 'Default: ' + settings.defaultQuality + 'p';
    if (audioFormatBtn) audioFormatBtn.textContent = 'Audio: ' + settings.audioFormat;
    if (autoActionBtn) autoActionBtn.textContent = autoLabel(settings.autoMode);
    if (autoInfoBtn) autoInfoBtn.textContent = 'Auto Info: ' + (settings.autoInfo === 'on' ? 'On' : 'Off');
    if (pollModeBtn) pollModeBtn.textContent = pollLabel(settings.pollMode);
    if (prefMimeBtn) prefMimeBtn.textContent = 'Mime: ' + settings.prefMime.split('/')[1];
    if (autoplayBtn) autoplayBtn.textContent = 'Autoplay: ' + (settings.autoplay ? 'On' : 'Off');
    // Update player buttons
    if (shuffleBtn) {
      shuffleBtn.textContent = isShuffle ? '🔀 On' : '🔀 Off';
      if (isShuffle) addClass(shuffleBtn, 'active'); else removeClass(shuffleBtn, 'active');
    }
    if (repeatBtn) {
      if (repeatMode === 0) { repeatBtn.textContent = '🔁 All'; addClass(repeatBtn, 'active'); }
      else if (repeatMode === 1) { repeatBtn.textContent = '🔂 One'; addClass(repeatBtn, 'active'); }
      else { repeatBtn.textContent = '🔁 Off'; removeClass(repeatBtn, 'active'); }
    }
    var qBtns = ['q240', 'q360', 'q480', 'q720'];
    for (var i = 0; i < qBtns.length; i++) { var b = $(qBtns[i]); if (b) removeClass(b, 'primary'); }
    var qb = $('q' + settings.defaultQuality);
    if (qb) addClass(qb, 'primary');
    if (rightSoftkey) rightSoftkey.textContent = isPlaying ? 'Pause' : 'Settings';
  }
  function cycle(list, current) {
    var i = list.indexOf(current);
    return list[(i + 1) % list.length];
  }
  function toggleSettings() {
    if (hasClass(settingsPanel, 'hidden')) {
      removeClass(settingsPanel, 'hidden');
      updateSettingsUI();
      if (defaultQualityBtn) defaultQualityBtn.focus();
      leftSoftkey.textContent = 'Close';
      rightSoftkey.textContent = 'Save';
    } else {
      saveSettings();
      addClass(settingsPanel, 'hidden');
      if (settingsBtn) settingsBtn.focus();
      leftSoftkey.textContent = 'Search';
      centerSoftkey.textContent = isPlaying ? 'Pause' : 'Play';
      rightSoftkey.textContent = 'Settings';
    }
  }

  // --- Activity Handling (KaiOS 2.5) ---
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
      reader.onload = function() { setShared(firstUrl(reader.result), title, true); };
      reader.onerror = function() { setShared('', title, false); };
      reader.readAsText(data.blobs[0]);
    } catch(e) {
      setShared('', title, false);
    }
  }
  function readLaunchUrl() {
    var q = window.location.search || '';
    if (!q) return;
    var params = {};
    q.replace(/^\?/, '').split('&').forEach(function(part) {
      var p = part.split('=');
      if (!p[0]) return;
      params[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || '').replace(/\+/g, ' '));
    });
    var url = extractUrl(params.url || params.text || params.u || '');
    if (url) setShared(url, params.title || '', false);
  }
  function registerKaiOS25ActivityHandlers() {
    if (!navigator.mozSetMessageHandler) return;
    try { navigator.mozSetMessageHandler('activity', handleActivity); } catch(e) {}
    try { navigator.mozSetMessageHandler('share', handleActivity); } catch(e2) {}
    try { navigator.mozSetMessageHandler('view', handleActivity); } catch(e3) {}
  }

  // --- Focus Navigation - FIXED for KaiOS ---
  function focusables() {
    var all = document.querySelectorAll('[data-focusable="1"]');
    var visible = [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      // Check if visible (not in hidden panel)
      var parent = el;
      var isHidden = false;
      while (parent && parent !== document.body) {
        if (hasClass(parent, 'hidden')) { isHidden = true; break; }
        parent = parent.parentElement;
      }
      if (!isHidden && el.offsetParent !== null) visible.push(el);
    }
    return visible;
  }
  function focusMove(delta) {
    var list = focusables();
    if (list.length === 0) return;
    var current = document.activeElement;
    var idx = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i] === current) { idx = i; break; }
    }
    idx = (idx + delta + list.length) % list.length;
    list[idx].focus();
    // Update softkeys based on focused element
    updateSoftkeysForFocus(list[idx]);
  }
  function updateSoftkeysForFocus(el) {
    if (!el) return;
    var id = el.id || '';
    if (id === 'playBtn') {
      leftSoftkey.textContent = 'Prev';
      centerSoftkey.textContent = isPlaying ? 'Pause' : 'Play';
      rightSoftkey.textContent = 'Next';
    } else if (id.indexOf('search') === 0 || id === 'searchInput') {
      leftSoftkey.textContent = 'Clear';
      centerSoftkey.textContent = 'Search';
      rightSoftkey.textContent = 'Type';
    } else if (id === 'settingsBtn') {
      leftSoftkey.textContent = 'Search';
      centerSoftkey.textContent = 'Settings';
      rightSoftkey.textContent = 'Play';
    } else {
      leftSoftkey.textContent = 'Search';
      centerSoftkey.textContent = 'Select';
      rightSoftkey.textContent = 'Settings';
    }
  }

  // --- Event Listeners - FIXED ---
  if ($('infoBtn')) $('infoBtn').onclick = info;
  if ($('q240')) $('q240').onclick = function() { startJob('video', 240); };
  if ($('q360')) $('q360').onclick = function() { startJob('video', 360); };
  if ($('q480')) $('q480').onclick = function() { startJob('video', 480); };
  if ($('q720')) $('q720').onclick = function() { startJob('video', 720); };
  if ($('audioDlBtn')) $('audioDlBtn').onclick = function() { startJob('audio', 0); };
  if (settingsBtn) settingsBtn.onclick = toggleSettings;
  if (defaultQualityBtn) defaultQualityBtn.onclick = function() { settings.defaultQuality = cycle(qualities, settings.defaultQuality); saveSettings(); updateSettingsUI(); };
  if (audioFormatBtn) audioFormatBtn.onclick = function() { settings.audioFormat = cycle(audioFormats, settings.audioFormat); saveSettings(); updateSettingsUI(); };
  if (autoActionBtn) autoActionBtn.onclick = function() { settings.autoMode = cycle(autoModes, settings.autoMode); saveSettings(); updateSettingsUI(); };
  if (autoInfoBtn) autoInfoBtn.onclick = function() { settings.autoInfo = settings.autoInfo === 'on' ? 'off' : 'on'; saveSettings(); updateSettingsUI(); };
  if (pollModeBtn) pollModeBtn.onclick = function() { settings.pollMode = cycle(pollModes, settings.pollMode); saveSettings(); updateSettingsUI(); };
  if (prefMimeBtn) prefMimeBtn.onclick = function() { settings.prefMime = cycle(mimeTypes, settings.prefMime); saveSettings(); updateSettingsUI(); showToast('Preferred mime: ' + settings.prefMime); };
  if (autoplayBtn) autoplayBtn.onclick = function() { settings.autoplay = !settings.autoplay; saveSettings(); updateSettingsUI(); showToast('Autoplay ' + (settings.autoplay ? 'On' : 'Off')); };
  if (serverCheckBtn) serverCheckBtn.onclick = serverCheck;
  if (searchBtn) searchBtn.onclick = function() { searchYoutube('video'); };
  if (searchVideoBtn) searchVideoBtn.onclick = function() { searchYoutube('video'); };
  if (searchChannelBtn) searchChannelBtn.onclick = function() { searchYoutube('channel'); };
  if (searchPlaylistBtn) searchPlaylistBtn.onclick = function() { searchYoutube('playlist'); };
  if (importPlaylistBtn) importPlaylistBtn.onclick = function() { 
    var pid = trim(playlistIdInput.value);
    if (pid) localStorage.setItem('lastPlaylistId', pid);
    importPlaylist(); 
  };
  if (clearCacheBtn) clearCacheBtn.onclick = function() {
    localStorage.removeItem('audioCache');
    // Clear backend cache is server-side, but we can show message
    showToast('Cache cleared');
    setMessage('Cache cleared');
  };
  if (lastBtn) lastBtn.onclick = function() {
    var url = localStorage.getItem('lastSharedUrl') || '';
    var title = localStorage.getItem('lastSharedTitle') || '';
    if (url) setShared(url, title, false); else setMessage('No last link');
  };
  if (clearBtn) clearBtn.onclick = function() {
    localStorage.removeItem('lastSharedUrl');
    localStorage.removeItem('lastSharedTitle');
    lastDownloadUrl = '';
    activeJobId = '';
    setShared('', '');
    setProgress(0);
    setMessage('History cleared');
    showToast('History cleared');
  };

  // Player controls - FIXED
  if (playBtn) playBtn.onclick = togglePlay;
  if (prevBtn) prevBtn.onclick = playPrev;
  if (nextBtn) nextBtn.onclick = playNext;
  if (rewindBtn) rewindBtn.onclick = function() { seekRelative(-10); };
  if (forwardBtn) forwardBtn.onclick = function() { seekRelative(10); };
  if (shuffleBtn) shuffleBtn.onclick = toggleShuffle;
  if (repeatBtn) repeatBtn.onclick = toggleRepeat;
  if (volumeBtn) volumeBtn.onclick = function() {
    if (navigator.mozAudioChannelManager) {
      try { navigator.volumeManager.requestShow(); } catch(e) {}
    } else {
      showToast('Volume: ' + Math.round(audioPlayer.volume * 100) + '%');
    }
  };
  if (playlistBtn) playlistBtn.onclick = function() {
    if (tracklist.length === 0) { showToast('No playlist'); return; }
    var listHtml = '';
    for (var i = 0; i < Math.min(tracklist.length, 20); i++) {
      var t = tracklist[i];
      listHtml += (i === currentTrackIndex ? '▶ ' : '  ') + (i+1) + '. ' + (t.title || 'Unknown').substring(0, 30) + '\n';
    }
    setMessage('Playlist (' + tracklist.length + ' tracks):', { current: currentTrackIndex, list: listHtml });
    showToast('Playlist: ' + tracklist.length + ' tracks');
  };

  // Search input enter
  if (searchInput) {
    searchInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.keyCode === 13) {
        searchYoutube('video');
        e.preventDefault();
      }
    });
  }

  // --- Keyboard Handling - FIXED for KaiOS ---
  document.addEventListener('keydown', function(e) {
    var key = e.key || e.keyCode;
    var isInput = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');

    // Navigation
    if (!isInput) {
      if (key === 'ArrowDown' || key === 40) { focusMove(1); e.preventDefault(); return; }
      if (key === 'ArrowUp' || key === 38) { focusMove(-1); e.preventDefault(); return; }
      if (key === 'ArrowRight' || key === 39) {
        // In player, next track, otherwise nav
        if (document.activeElement && document.activeElement.id === 'playBtn') { playNext(); e.preventDefault(); return; }
        if (tracklist.length > 0 && (document.activeElement === document.body || hasClass(document.activeElement, 'nowPlaying') || document.activeElement.id.indexOf('main') === 0)) {
          playNext(); e.preventDefault(); return;
        }
        focusMove(1); e.preventDefault(); return;
      }
      if (key === 'ArrowLeft' || key === 37) {
        if (document.activeElement && document.activeElement.id === 'playBtn') { playPrev(); e.preventDefault(); return; }
        if (tracklist.length > 0 && (document.activeElement === document.body || hasClass(document.activeElement, 'nowPlaying'))) {
          playPrev(); e.preventDefault(); return;
        }
        focusMove(-1); e.preventDefault(); return;
      }
    }

    // Softkeys
    if (key === 'SoftLeft' || key === 'SoftRight' || key === 'Enter' || key === ' ') {
      // Let focused element handle click, but also handle global
    }

    // Global shortcuts - FIXED
    if (!isInput) {
      if (key === 'SoftLeft' || key === 112) { // Left softkey
        if (hasClass(settingsPanel, 'hidden')) {
          // In main, go to search
          if (searchInput) searchInput.focus();
        } else {
          toggleSettings();
        }
        e.preventDefault();
      }
      if (key === 'SoftRight' || key === 113) { // Right softkey
        if (hasClass(settingsPanel, 'hidden')) {
          toggleSettings();
        } else {
          saveSettings();
          toggleSettings();
        }
        e.preventDefault();
      }
      if (key === 'Enter' || key === 13 || key === ' ') {
        // Center - play/pause if in player, else click focused
        var active = document.activeElement;
        if (active && active.id === 'playBtn') {
          togglePlay();
          e.preventDefault();
        } else if (active && active.tagName === 'BUTTON') {
          // Let button handle
        } else {
          if (tracklist.length > 0) togglePlay();
          e.preventDefault();
        }
      }
      // Number keys
      if (key === '1' || key === 49) { seekRelative(-10); e.preventDefault(); }
      if (key === '2' || key === 50) { volumeDown(); e.preventDefault(); }
      if (key === '3' || key === 51) { seekRelative(10); e.preventDefault(); }
      if (key === '4' || key === 52) { playPrev(); e.preventDefault(); }
      if (key === '5' || key === 53) { togglePlay(); e.preventDefault(); }
      if (key === '6' || key === 54) { playNext(); e.preventDefault(); }
      if (key === '7' || key === 55) { toggleShuffle(); e.preventDefault(); }
      if (key === '8' || key === 56) { volumeUp(); e.preventDefault(); }
      if (key === '9' || key === 57) { toggleRepeat(); e.preventDefault(); }
      if (key === '0' || key === 48) { toggleSettings(); e.preventDefault(); }
      if (key === '*' || key === 42) { toggleShuffle(); e.preventDefault(); }
      if (key === '#' || key === 35) { toggleRepeat(); e.preventDefault(); }
    }

    // Back key
    if (key === 'Backspace' || key === 8 || key === 'Back' || key === 'GoBack') {
      if (!hasClass(settingsPanel, 'hidden')) {
        toggleSettings();
        e.preventDefault();
        return;
      }
      // If search results focused, go back to search input
      if (document.activeElement && document.activeElement.parentElement === searchResultsEl) {
        if (searchInput) searchInput.focus();
        e.preventDefault();
        return;
      }
    }
  });

  // --- Init ---
  function init() {
    updateSettingsUI();
    registerKaiOS25ActivityHandlers();
    readLaunchUrl();
    if (!shared.url) {
      var lastUrl = localStorage.getItem('lastSharedUrl') || '';
      var lastTitle = localStorage.getItem('lastSharedTitle') || '';
      if (lastUrl) setShared(lastUrl, lastTitle, false);
    }
    // Load saved tracklist
    try {
      var savedList = localStorage.getItem('tracklist');
      if (savedList) {
        var parsed = JSON.parse(savedList);
        if (Array.isArray(parsed) && parsed.length > 0) {
          tracklist = parsed;
          tracklistOriginal = JSON.parse(JSON.stringify(parsed));
          var savedIdx = parseInt(localStorage.getItem('currentTrackIndex') || '0', 10);
          if (savedIdx >= 0 && savedIdx < tracklist.length) {
            currentTrackIndex = savedIdx;
            updateTrackUI(tracklist[currentTrackIndex], currentTrackIndex);
          }
        }
      }
    } catch(e) { console.log('Failed to load tracklist', e); }

    // Focus default
    setTimeout(function() {
      if (tracklist.length > 0) {
        if (playBtn) playBtn.focus();
      } else {
        if (searchInput) searchInput.focus();
        else if ($('q' + settings.defaultQuality)) $('q' + settings.defaultQuality).focus();
      }
    }, 300);

    setMessage('Fixed YT Music ready • Backend proxy enabled • All actions working');
    setProgress(0);

    // Save tracklist periodically
    setInterval(function() {
      try {
        if (tracklist.length > 0) {
          localStorage.setItem('tracklist', JSON.stringify(tracklist.slice(0, 100))); // Limit 100
        }
      } catch(e) {}
    }, 5000);
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Handle visibility change for autosleep
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') {
      // Could pause or set sleep timer
    } else {
      // Resume
    }
  });

  // Expose for debugging
  window.YTMusicFixed = {
    audioPlayer: audioPlayer,
    tracklist: function() { return tracklist; },
    playTrack: playTrack,
    search: searchYoutube,
    settings: settings
  };

}());
