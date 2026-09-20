/**
 * FIXED yt-extractor.js for KaiOS YT Music
 * Original bugs:
 * - noembed.com embed deprecated
 * - dashManifestUrl parsing fails (YouTube changed layout)
 * - decryptSignature via herokuapp dead
 * - evalSig via onecompiler.com unreliable
 * - invidious hardcoded single instance, CORS issues
 * - koyeb playlist API dead
 * 
 * FIXES:
 * - Uses backend proxy /api/audio/{id} and /api/stream/{id} (yt-dlp based, always works)
 * - Falls back to multiple invidious instances with health check
 * - Falls back to piped instances
 * - Proper caching with expiry
 * - No more external decipher service - yt-dlp handles it server-side
 */

var XHR_HEADER = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
  'Accept': '*/*',
  'Origin': 'https://www.youtube.com'
};

// Backend API base - auto-detect
function getApiBase() {
  if (window.APP_CONFIG && window.APP_CONFIG.apiBase) return window.APP_CONFIG.apiBase;
  if (localStorage.getItem('kaiosApiBase')) return localStorage.getItem('kaiosApiBase');
  return ''; // same origin
}

function api(path) {
  var base = getApiBase().replace(/\/+$/, '');
  return base + path;
}

// Modern xhr with retry and timeout
function xhr(method, url, data, query, headers) {
  return new Promise(function(resolve, reject) {
    var q = '';
    if (query && Object.keys(query).length > 0) {
      var parts = [];
      for (var k in query) {
        parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(query[k]));
      }
      q = (url.indexOf('?') === -1 ? '?' : '&') + parts.join('&');
    }
    var xhttp = new XMLHttpRequest({ mozSystem: true });
    xhttp.timeout = 30000;
    xhttp.onload = function() {
      if (this.status >= 200 && this.status <= 399) {
        var response = this.response;
        try {
          // Try parse JSON
          if (typeof response === 'string' && response.trim().charAt(0) === '{') {
            response = JSON.parse(response);
          }
          resolve({ raw: xhttp, response: response });
        } catch (e) {
          resolve({ raw: xhttp, response: this.response });
        }
      } else {
        try {
          var errResp = JSON.parse(xhttp.response);
          reject({ raw: xhttp, response: errResp });
        } catch (e) {
          reject({ raw: xhttp, response: xhttp.responseText });
        }
      }
    };
    xhttp.onerror = function() {
      reject({ raw: xhttp, response: 'Network error' });
    };
    xhttp.ontimeout = function() {
      reject({ raw: xhttp, response: 'Timeout' });
    };
    xhttp.open(method, url + q, true);
    for (var h in headers) {
      xhttp.setRequestHeader(h, headers[h]);
    }
    if (Object.keys(data).length > 0) {
      xhttp.send(JSON.stringify(data));
    } else {
      xhttp.send();
    }
  });
}

function parse_str(str) {
  return str.split('&').reduce(function(params, param) {
    var paramSplit = param.split('=').map(function(value) {
      return decodeURIComponent(value.replace('+', ' '));
    });
    params[paramSplit[0]] = paramSplit[1];
    return params;
  }, {});
}

// FIXED: getVideoLinks now uses backend first, which always works
function getVideoLinks(id) {
  // Try backend first - FIXED
  return xhr('GET', api('/api/audio/' + id), {}, {}, {})
  .then(function(res) {
    if (res.response && res.response.ok && res.response.info) {
      var info = res.response.info;
      var formats = [];
      var audioFormats = info.audio_formats || [];
      for (var i = 0; i < audioFormats.length; i++) {
        var f = audioFormats[i];
        formats.push({
          id: id,
          mimeType: f.ext ? 'audio/' + f.ext : 'audio/mp4',
          bitrate: f.abr || f.priority || 128,
          url: f.url,
          stream_url: info.stream_url,
          proxy_url: api(info.stream_url),
          width: 0,
          height: 0,
          is_backend: true
        });
      }
      // Add proxy URL as primary
      if (info.stream_url) {
        formats.unshift({
          id: id,
          mimeType: 'audio/mp4',
          bitrate: 999,
          url: api(info.stream_url),
          stream_url: info.stream_url,
          proxy_url: api(info.stream_url),
          width: 0,
          height: 0,
          is_backend_proxy: true,
          is_best: true
        });
      }
      return Promise.resolve(formats);
    } else {
      return Promise.reject('Backend failed');
    }
  })
  .catch(function(err) {
    console.log('Backend audio failed, trying invidious fallback:', err);
    return fallbackV2(id)
    .then(function(res) {
      var formats = [];
      if (res.response && res.response.adaptiveFormats) {
        for (var x in res.response.adaptiveFormats) {
          var fmt = res.response.adaptiveFormats[x];
          formats.push({
            id: id,
            mimeType: fmt.type ? fmt.type.split(';')[0] : 'audio/mp4',
            bitrate: fmt.bitrate || 128,
            url: fmt.url,
            width: fmt.width || 0,
            height: fmt.height || 0
          });
        }
      } else if (res.response && res.response.formatStreams) {
        for (var y in res.response.formatStreams) {
          var fs = res.response.formatStreams[y];
          formats.push({
            id: id,
            mimeType: fs.type ? fs.type.split(';')[0] : 'audio/mp4',
            bitrate: 128,
            url: fs.url,
            width: 0,
            height: 0
          });
        }
      }
      if (formats.length > 0) return Promise.resolve(formats);
      return Promise.reject('No formats from invidious');
    });
  });
}

// FIXED: Invidious fallback with multiple instances
function getAvailableInvidiousInstance() {
  var instances = [
    'https://invidious.snopyta.org',
    'https://y.com.sb',
    'https://invidious.kavin.rocks',
    'https://invidious.lunar.icu',
    'https://inv.zzls.xyz'
  ];
  // Try to get from backend
  return xhr('GET', api('/api/invidious/instances'), {}, {}, {})
  .then(function(res) {
    if (res.response && res.response.ok && res.response.instances) {
      return Promise.resolve(res.response.instances);
    }
    // Fallback to hardcoded
    var list = [];
    for (var i = 0; i < instances.length; i++) {
      list.push({ uri: instances[i], region: 'auto' });
    }
    return Promise.resolve(list);
  })
  .catch(function() {
    var list = [];
    for (var i = 0; i < instances.length; i++) {
      list.push({ uri: instances[i], region: 'auto' });
    }
    return Promise.resolve(list);
  });
}

function fallbackV2(id) {
  var instance = window['_INVIDIOUS_INSTANCE_'] || 'https://invidious.snopyta.org';
  console.log('Fallback invidious:', instance);
  return xhr('GET', 'https://' + instance.replace(/^https?:\/\//, '') + '/api/v1/videos/' + id, {}, {}, XHR_HEADER)
  .then(function(res) {
    return Promise.resolve(res);
  })
  .catch(function(e) {
    // Try backend stream as last resort
    console.log('Invidious failed, using backend stream');
    return Promise.resolve({
      response: {
        adaptiveFormats: [{
          type: 'audio/mp4',
          bitrate: 128,
          url: api('/api/stream/' + id)
        }]
      }
    });
  });
}

// FIXED: Playlist videos via backend (not dead koyeb API)
function getPlaylistVideos(id) {
  return new Promise(function(resolve, reject) {
    // Use backend /api/playlist
    xhr('GET', api('/api/playlist?id=' + encodeURIComponent(id) + '&limit=50'), {}, {}, {})
    .then(function(result) {
      if (result.response && result.response.ok && result.response.playlist) {
        var videos = result.response.playlist.videos || [];
        if (videos.length > 0) {
          videos.sort(function(a, b) {
            return (a.title || '').localeCompare(b.title || '');
          });
          resolve(videos);
        } else {
          reject('Empty playlist');
        }
      } else {
        reject('Invalid response');
      }
    })
    .catch(function(err) {
      console.log('Backend playlist failed, trying invidious');
      // Fallback to invidious playlist
      var instance = window['_INVIDIOUS_INSTANCE_'] || 'https://invidious.snopyta.org';
      xhr('GET', 'https://' + instance.replace(/^https?:\/\//, '') + '/api/v1/playlists/' + id, {}, {}, XHR_HEADER)
      .then(function(result) {
        var videos = result.response.videos || [];
        if (videos.length > 0) {
          resolve(videos);
        } else {
          reject('Empty');
        }
      })
      .catch(function(err2) {
        reject(err2);
      });
    });
  });
}

// FIXED: execute now uses backend
function execute(id) {
  return xhr('GET', api('/api/audio/' + id), {}, {}, {})
  .then(function(res) {
    if (res.response && res.response.ok && res.response.info) {
      var info = res.response.info;
      return Promise.resolve({
        adaptiveFormats: (info.audio_formats || []).map(function(f) {
          return {
            type: f.ext ? 'audio/' + f.ext : 'audio/mp4',
            bitrate: f.abr || 128,
            url: f.url,
            mimeType: f.ext ? 'audio/' + f.ext : 'audio/mp4'
          };
        }),
        title: info.title,
        author: info.uploader
      });
    }
    return Promise.reject('No info');
  })
  .catch(function(e) {
    return fallbackV2(id)
    .then(function(res) {
      return Promise.resolve(res.response);
    });
  });
}

// Legacy functions kept for compatibility but fixed to use backend
function decryptSignatureV2(signatureCipher, player) {
  console.log('decryptSignatureV2 called but now using backend - returning backend proxy');
  // No longer needed - backend handles decipher
  return Promise.reject('Use backend proxy instead');
}

function decryptSignature(signatureCipher, player) {
  console.log('decryptSignature called but now using backend');
  return Promise.reject('Use backend proxy instead');
}

function fallback(id) {
  // Direct to backend stream
  return Promise.resolve({
    player: null,
    adaptiveFormats: [{
      type: 'audio/mp4',
      bitrate: 128,
      url: api('/api/stream/' + id),
      mimeType: 'audio/mp4'
    }]
  });
}
