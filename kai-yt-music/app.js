// Prefer IndexedDB but keep localStorage as a fallback: with a single driver a
// failed setDriver() leaves the default localforage instance permanently rejected.
localforage.setDriver([localforage.INDEXEDDB, localforage.LOCALSTORAGE]).catch((err) => {
  console.warn('No preferred localforage driver available:', err);
});

var BOOT = false;
var SLEEP_TIMER = null;
var WAKE_LOCK = null;
var QR_READER = null;
var MAIN_OBJECT_URL = null;      // blob: URL of the currently playing local file (revoked on change)
var MAIN_PLAY_RETRY = 0;         // guards the error → retry loop of the main player
const MAX_PLAY_RETRY = 2;
const DEFAULT_VOLUME = 0.02;

const DB_NAME = 'YT_MUSIC';
const DB_AUDIO = 'YT_AUDIO'; // { id: { ...metadata } }
const DB_PLAYLIST = 'YT_PLAYLIST'; // { id: {name, sync, collections: []} }
const DB_CACHED_URL = 'YT_CACHED_URL'; // { id: URL }
const DB_PLAYING = 'YT_PLAYING'; //
const DB_CONFIGURATION = 'YT_CONFIGURATION';

const T_AUDIO = localforage.createInstance({
  name: DB_NAME,
  storeName: DB_AUDIO
});

const T_PLAYLIST = localforage.createInstance({
  name: DB_NAME,
  storeName: DB_PLAYLIST
});

const T_CACHED_URL = localforage.createInstance({
  name: DB_NAME,
  storeName: DB_CACHED_URL
});

const T_CONFIGURATION = localforage.createInstance({
  name: DB_NAME,
  storeName: DB_CONFIGURATION
});

var MAIN_DURATION_ELAPSED;
var MAIN_DURATION_SLIDER;
var MAIN_CURRENT_TIME;
var MAIN_DURATION;
var MAIN_THUMB;
var MAIN_TITLE;
var MAIN_PLAY_BTN;
var MAIN_BUFFERING;
var MAIN_BUFFERED;

var LFT_DBL_CLICK_TH = 0;
var LFT_DBL_CLICK_TIMER = undefined;
var RGT_DBL_CLICK_TH = 0;
var RGT_DBL_CLICK_TIMER = undefined;

if (navigator.mozAudioChannelManager) {
  navigator.mozAudioChannelManager.volumeControlChannel = 'content';
}

function putCachedURL(obj, url) {
  var params = getURLParam('expire', url);
  var expire = params[0];
  if (expire == null) {
    const segments = url.split('/');
    var idx = segments.indexOf('expire');
    if (idx > -1)
      idx++;
    if (isNaN(segments[idx]) === false)
      expire = parseInt(segments[idx]);
  }
  if (expire) {
    T_CACHED_URL.getItem(obj.id)
    .then((cached) => {
      if (cached == null || typeof cached !== 'object')
        cached = {};
      cached[obj.bitrate] = {
        url: url,
        expire: parseInt(expire) * 1000,
        local: obj.local != null ? (obj.local ? true : false) : (window['INVIDIOUS'] ? true : false)
      };
      return T_CACHED_URL.setItem(obj.id, cached);
    })
    .then((saved) => {
      console.log('CACHED:', obj.id, saved);
    })
    .catch((err) => {
      console.log(err);
    })
  }
}

function getCachedURL(id, bitrate = null) {
  return new Promise((resolve, reject) => {
    T_CACHED_URL.getItem(id)
    .then((cached) => {
      if (cached == null) {
        reject("ID not exist");
        return;
      }
      if (bitrate != null && cached[bitrate] == null) {
        reject("Bitrate not exist");
        return;
      }
      if (bitrate === null) {
        const keys = Object.keys(cached).filter((k) => cached[k] && cached[k].url);
        if (keys.length === 0) {
          reject("ID not exist");
          return;
        }
        bitrate = keys[keys.length - 1];
      }
      const entry = cached[bitrate];
      if (entry == null || !entry.url) {
        reject("Bitrate not exist");
        return;
      }
      const wantLocal = window['INVIDIOUS'] ? true : false;
      if (entry.local != null && entry.local !== wantLocal) {
        reject("Cached link is for another audio source");
        return;
      }
      // keep a 60s safety margin, googlevideo rejects links right at `expire`
      if (Date.now() + 60000 < new Date(entry['expire']).getTime()) {
        console.log('FOUND:', id, bitrate);
        resolve(entry['url']);
        return;
      }
      reject("Expired link");
    })
    .catch((err) => {
      reject(err);
    });
  });
}

window.addEventListener("load", () => {

  const dummy = new Kai({
    name: '_dummy_',
    data: {
      title: '_dummy_'
    },
    verticalNavClass: '.dummyNav',
    templateUrl: document.location.origin + '/templates/dummy.html',
    mounted: function() {},
    unmounted: function() {},
    methods: {},
    softKeyText: { left: 'L2', center: 'C2', right: 'R2' },
    softKeyListener: {
      left: function() {},
      center: function() {},
      right: function() {}
    },
    dPadNavListener: {
      arrowUp: function() {
        this.navigateListNav(-1);
      },
      arrowDown: function() {
        this.navigateListNav(1);
      }
    }
  });

  const DS = new DataStorage(() => {}, () => {}, false);
  // Touch the storage once so KaiOS prompts for the sdcard permission up-front.
  try {
    if (DS.available && DS.deviceStorages.length > 0 && typeof DS.deviceStorages[0].get === 'function') {
      DS.deviceStorages[0].get('trigger_permission');
    }
  } catch (e) {
    console.warn('Device storage permission probe failed:', e);
  }

  var TRACK_NAME = '';
  var TRACKLIST = [];
  var TRACKLIST_DEFAULT_SORT = [];

  const state = new KaiState({
    MAIN_PLAYER_DURATION: 0,
    CONFIGURATION: {},
    DATABASE: {},
    PLAYLIST: {},
    TRACKLIST_IDX: 0,
    REPEAT: -1,
    SHUFFLE: false,
    AUTOPLAY: JSON.parse(localStorage.getItem('AUTOPLAY')) || false,
    AUTOSLEEP: JSON.parse(localStorage.getItem('AUTOSLEEP')) || false,
    INVIDIOUS: window['INVIDIOUS'] ? true : false,
  });

  const MAIN_PLAYER = document.createElement("audio");
  MAIN_PLAYER.volume = navigator.mozAudioChannelManager ? 1 : 0.02;
  MAIN_PLAYER.mozAudioChannelType = 'content';

  MAIN_PLAYER.onloadedmetadata = (e) => {
    MAIN_PLAY_RETRY = 0; // stream is usable again → re-arm the error retry budget
    state.setState('MAIN_PLAYER_DURATION', e.target.duration);
  }

  MAIN_PLAYER.onended = (e) => {
    const REPEAT = state.getState('REPEAT');
    if (REPEAT === 1) {
      const p = MAIN_PLAYER.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } else if (REPEAT === 0) {
      const next = state.getState('TRACKLIST_IDX') + 1;
      if (TRACKLIST[next]) {
        state.setState('TRACKLIST_IDX', next);
        playMainAudio(next);
      } else {
        state.setState('TRACKLIST_IDX', 0);
        playMainAudio(0);
      }
    } else if (REPEAT === -1 && (state.getState('TRACKLIST_IDX') !== (TRACKLIST.length - 1))) {
      const next = state.getState('TRACKLIST_IDX') + 1;
      if (TRACKLIST[next]) {
        state.setState('TRACKLIST_IDX', next);
        playMainAudio(next);
      }
    }
  }

  // fastSeek() exists on Gecko (KaiOS) but not on Chromium — fall back to currentTime.
  function seekTo(PLYR, seconds) {
    if (!PLYR) return;
    const duration = isFinite(PLYR.duration) && PLYR.duration > 0 ? PLYR.duration : Infinity;
    const target = Math.min(Math.max(0, seconds), duration);
    try {
      if (typeof PLYR.fastSeek === 'function') {
        PLYR.fastSeek(target);
      } else {
        PLYR.currentTime = target;
      }
    } catch (e) {
      console.warn('seek failed:', e);
    }
  }

  function hasVolumeManager() {
    return navigator.mozAudioChannelManager && navigator.volumeManager && typeof navigator.volumeManager.requestUp === 'function';
  }

  function toggleVolume(PLYR, $router) {
    if (hasVolumeManager()) {
      navigator.volumeManager.requestShow();
      $router.setSoftKeyRightText('');
    } else {
      $router.setSoftKeyRightText((PLYR.volume * 100).toFixed(0) + '%');
    }
  }

  function volumeUp(PLYR, $router, cb = () => {}) {
    if (hasVolumeManager()) {
      navigator.volumeManager.requestUp();
    } else {
      if (PLYR.volume < 1) {
        PLYR.volume = parseFloat((PLYR.volume + DEFAULT_VOLUME).toFixed(2));
        cb(PLYR, $router);
        $router.showToast('Volume ' + (PLYR.volume * 100).toFixed(0).toString() + '%');
      }
    }
  }

  function volumeDown(PLYR, $router, cb = () => {}) {
    if (hasVolumeManager()) {
      navigator.volumeManager.requestDown();
    } else {
      if (PLYR.volume > 0) {
        PLYR.volume = parseFloat((PLYR.volume - DEFAULT_VOLUME).toFixed(2));
        cb(PLYR, $router);
        $router.showToast('Volume ' + (PLYR.volume * 100).toFixed(0).toString() + '%');
      }
    }
  }

  function toggleShuffle($router) {
    const SHUFFLE = !state.getState('SHUFFLE');
    const SHUFFLE_BTN = {};
    if (SHUFFLE) {
      SHUFFLE_BTN.classList = '';
      if ($router)
        $router.showToast('Shuffle On');
    } else {
      SHUFFLE_BTN.classList = 'inactive';
      if ($router)
        $router.showToast('Shuffle Off');
    }
    state.setState('SHUFFLE', SHUFFLE);
    T_CONFIGURATION.setItem('SHUFFLE', SHUFFLE);
    shuffling();
    return SHUFFLE_BTN;
  }

  function shuffling() {
    if (TRACKLIST.length <= 1)
      return
    const SHUFFLE = state.getState('SHUFFLE');
    if (TRACKLIST[state.getState('TRACKLIST_IDX')] == null) {
      state.setState('TRACKLIST_IDX', 0);
    }
    if (SHUFFLE) {
      const v_id = TRACKLIST[state.getState('TRACKLIST_IDX')].id;
      for (var i = 0; i < TRACKLIST.length - 1; i++) {
        var j = i + Math.floor(Math.random() * (TRACKLIST.length - i));
        var temp = TRACKLIST[j];
        TRACKLIST[j] = TRACKLIST[i];
        TRACKLIST[i] = temp;
      }
      const idx = TRACKLIST.findIndex((t) => {
        return t.id === v_id;
      });
      if (idx > 0) {
        const t = TRACKLIST[0];
        const b =  TRACKLIST[idx];
        TRACKLIST[idx] = t;
        TRACKLIST[0] = b;
      }
      state.setState('TRACKLIST_IDX', 0);
    } else {
      const v_id = TRACKLIST[state.getState('TRACKLIST_IDX')].id;
      TRACKLIST = JSON.parse(JSON.stringify(TRACKLIST_DEFAULT_SORT));
      const idx = TRACKLIST.findIndex((t) => {
        return t.id === v_id;
      });
      state.setState('TRACKLIST_IDX', idx > -1 ? idx : 0);
    }
  }

  function toggleRepeat($router) {
    var REPEAT = state.getState('REPEAT');
    REPEAT++;
    const REPEAT_BTN = {};
    if (REPEAT === 0) {
      REPEAT_BTN.src = '/icons/img/baseline_repeat_white_18dp.png';
      REPEAT_BTN.classList = '';
      if ($router)
        $router.showToast('Repeat On');
    } else if (REPEAT === 1) {
      REPEAT_BTN.src = '/icons/img/baseline_repeat_one_white_18dp.png';
      REPEAT_BTN.classList = '';
      if ($router)
        $router.showToast('Repeat One');
    } else {
      REPEAT = -1;
      REPEAT_BTN.src = '/icons/img/baseline_repeat_white_18dp.png';
      REPEAT_BTN.classList = 'inactive';
      if ($router)
        $router.showToast('Repeat Off');
    }
    state.setState('REPEAT', REPEAT);
    T_CONFIGURATION.setItem('REPEAT', REPEAT);
    return REPEAT_BTN;
  }

  function init(dbg = null) {
    console.log('INIT:', dbg);
    T_CONFIGURATION.getItem('SHUFFLE')
    .then((SHUFFLE) => {
      if (SHUFFLE == null)
        SHUFFLE = false;
      state.setState('SHUFFLE', SHUFFLE);
      T_CONFIGURATION.setItem('SHUFFLE', SHUFFLE);
      localforage.getItem(DB_PLAYLIST)
      .then((playlist_id) => {
        if (playlist_id == null) {
          playDefaultPlaylist();
        } else {
          playPlaylistById(playlist_id);
        }
      });
    });
  }

  T_CONFIGURATION.keys()
  .then((keys) => {
    const kv = {}
    var done = keys.length;
    if (done === 0) {
      state.setState('CONFIGURATION', kv);
      return;
    }
    keys.forEach((key) => {
      T_CONFIGURATION.getItem(key)
      .then((value) => {
        kv[key] = value;
        done--;
        if (done <= 0 ) {
          state.setState('CONFIGURATION', kv);
          // console.log(state.getState('CONFIGURATION'));
        }
      })
      .catch((err) => {
        console.log(err);
        done--;
        if (done <= 0 ) {
          state.setState('CONFIGURATION', kv);
          console.log(state.getState('CONFIGURATION'));
        }
      });
    });
  }).catch((err) => {
    console.log(err);
  });

  T_AUDIO.keys()
  .then((keys) => {
    var success = 0;
    var fail = 0;
    var done = keys.length;
    if (done === 0) {
      init('Empty');
      return;
    }
    const list = state.getState('DATABASE');
    const finish = () => {
      done--;
      if (done <= 0) {
        state.setState('DATABASE', list);
        init(`${success}, ${fail}`);
      }
    };
    keys.forEach((key) => {
      T_AUDIO.getItem(key)
      .then((value) => {
        if (value != null && typeof value === 'object') {
          if (value.id == null) value.id = key;
          list[key] = value;
          success++;
        } else {
          fail++;
        }
        finish();
      })
      .catch((err) => {
        fail++;
        finish();
      });
    });
  })
  .catch((err) => {
    console.log(err);
    init(err.toString());
  });

  T_PLAYLIST.keys()
  .then((keys) => {
    if (keys.length === 0) {
      return;
    }
    const list = state.getState('PLAYLIST');
    var done = keys.length;
    keys.forEach((key) => {
      T_PLAYLIST.getItem(key.toString())
      .then((value) => {
        if (value != null && typeof value === 'object' && Array.isArray(value.collections)) {
          list[key] = value;
        }
      })
      .catch((err) => {
        console.log(err);
      })
      .then(() => {
        done--;
        if (done <= 0) {
          state.setState('PLAYLIST', list);
        }
      });
    });
  })
  .catch((err) => {
    console.log(err);
  });

  function playDefaultPlaylist() {
    TRACKLIST = [];
    TRACKLIST_DEFAULT_SORT = [];
    localforage.removeItem(DB_PLAYLIST);
    state.setState('TRACKLIST_IDX', 0);
    TRACK_NAME = 'YT MUSIC';
    const tracks = state.getState('DATABASE');
    for (var y in tracks) {
      TRACKLIST.push(tracks[y]);
      TRACKLIST_DEFAULT_SORT.push(tracks[y]);
    }
    shuffling();
    if (TRACKLIST.length > 0) {
      playMainAudio(state.getState('TRACKLIST_IDX'));
    }
  }

  function playPlaylistById(id) {
    T_PLAYLIST.getItem(id.toString())
    .then((result) => {
      if (result == null) {
        playDefaultPlaylist();
        return Promise.reject('Playlist not exist');
      }
      return Promise.resolve(result);
    })
    .then((playlist) => {
      const tracks = state.getState('DATABASE');
      const list = []
      playlist.collections.forEach((c) => {
        if (tracks[c]) {
          list.push(tracks[c]);
        }
      });
      state.setState('TRACKLIST_IDX', 0);
      TRACK_NAME = playlist.name;
      TRACKLIST = list;
      TRACKLIST_DEFAULT_SORT = JSON.parse(JSON.stringify(list));
      shuffling();
      if (TRACKLIST.length > 0) {
        playMainAudio(state.getState('TRACKLIST_IDX'));
        if (router) router.showToast(`PLAYING ${TRACK_NAME}`);
      } else if (router) {
        router.showToast(`${TRACK_NAME} is empty`);
      }
      localforage.setItem(DB_PLAYLIST, playlist.id);
    })
    .catch((e) => {
      if (router) router.showToast(e.toString());
    });
  }

  // Audio-only formats sorted by bitrate (kbps), each with a menu label.
  function listAudioFormats(links) {
    const audio = [];
    (links || []).forEach((link) => {
      if (link && link.mimeType && link.mimeType.indexOf('audio') > -1 && link.url) {
        link.bitrate = normalizeBitrate(link.bitrate);
        link.text = link.mimeType + '(' + link.bitrate.toString() + 'kbps)' + (link.local ? ' via proxy' : '');
        audio.push(link);
      }
    });
    audio.sort((a, b) => a.bitrate - b.bitrate);
    return audio;
  }

  function getAudioStreamURL(id) {
    return getVideoLinks(id)
    .then((links) => {
      const preferred = (state.getState('CONFIGURATION') || {})['mimeType'] || 'audio';
      const obj = pickAudioFormat(links, preferred);
      if (obj == null || obj.url == null) {
        return Promise.reject('No audio stream');
      }
      putCachedURL(obj, obj.url);
      return obj.url;
    })
    .catch((e) => {
      return Promise.reject(errorToString(e));
    });
  }

  const qrReader = function($router, cb = () => {}) {
    var found = false;
    var activeStream = null;
    $router.showBottomSheet(
      new Kai({
        name: 'qrReader',
        data: {
          title: 'qrReader'
        },
        template: `<div class="kui-flex-wrap" style="overflow:hidden!important;height:264px;"><video id="qr_video" height="320" width="240" autoplay></video></div>`,
        softKeyText: { left: 'Cancel', center: '', right: '' },
        softKeyListener: {
          left: function() {
            $router.hideBottomSheet();
          },
          center: function() {},
          right: function() {}
        },
        mounted: function() {
          if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
            $router.showToast('Camera not available');
            return;
          }
          navigator.mediaDevices.getUserMedia({ audio: false, video: true })
          .then((stream) => {
            activeStream = stream;
            const video = document.getElementById("qr_video");
            if (!video) {
              stream.getTracks().forEach((track) => track.stop());
              return;
            }
            video.srcObject = stream;
            video.onloadedmetadata = (e) => {
              const playing = video.play();
              if (playing && typeof playing.catch === 'function') playing.catch(() => {});
              var barcodeCanvas = document.createElement("canvas");
              QR_READER = setInterval(() => {
                if (found) return;
                var imageWidth = Math.max(1, Math.floor(video.videoWidth)), imageHeight = Math.max(1, Math.floor(video.videoHeight));
                barcodeCanvas.width = imageWidth;
                barcodeCanvas.height = imageHeight;
                var barcodeContext = barcodeCanvas.getContext("2d");
                barcodeContext.drawImage(video, 0, 0, imageWidth, imageHeight);
                var imageData = barcodeContext.getImageData(0, 0, imageWidth, imageHeight);
                let code = null;
                try {
                  code = jsQR(imageData.data, imageWidth, imageHeight);
                } catch (err) {
                  code = null;
                }
                if (code && code.data) {
                  found = true;
                  clearInterval(QR_READER);
                  QR_READER = null;
                  cb(code.data);
                }
              }, 1000);
            };
          }).catch((err) => {
            $router.showToast(err.toString());
          });
        },
        unmounted: function() {
          if (QR_READER) {
            clearInterval(QR_READER);
            QR_READER = null;
          }
          const video = document.getElementById("qr_video");
          const stream = (video && video.srcObject) || activeStream;
          if (stream && typeof stream.getTracks === 'function') {
            stream.getTracks().forEach(function (track) {
              track.stop();
            });
          }
          if (video) {
            video.srcObject = null;
          }
          activeStream = null;
        },
      })
    );
  }

  function downloadAudio($router, audio, cb = () => {}) {
    return new Promise((resolve, reject) => {
      $router.showLoading();
      getAudioStreamURL(audio.id)
      .then((url) => {
        // console.log(url);
        var BAR, CUR, MAX;
        var start = 0;
        var loaded = 0;
        var req = new XMLHttpRequest({ mozSystem: true });
        req.open('GET', url, true);
        req.responseType = 'blob';
        $router.showBottomSheet(
          new Kai({
            name: 'downloaderPopup',
            data: {
              title: 'downloaderPopup',
              downloading: false,
            },
            templateUrl: document.location.origin + '/templates/downloaderPopup.html',
            softKeyText: { left: 'Cancel', center: '0KB/S', right: '0%' },
            softKeyListener: {
              left: function() {
                $router.hideBottomSheet();
                req.abort();
              },
              center: function() {},
              right: function() {}
            },
            mounted: function() {
              const lock = navigator.b2g || navigator;
              try {
                WAKE_LOCK = typeof lock.requestWakeLock === 'function' ? lock.requestWakeLock('cpu') : null;
              } catch (e) {
                WAKE_LOCK = null;
              }
              BAR = document.getElementById('download_bar');
              CUR = document.getElementById('download_cur');
              MAX = document.getElementById('download_max');
              req.onprogress = this.methods.onprogress;
              req.onreadystatechange = this.methods.onreadystatechange;
              req.onerror = this.methods.onerror;
              start = new Date().getTime();
              req.send();
            },
            unmounted: function() {
              if (WAKE_LOCK) {
                try { WAKE_LOCK.unlock(); } catch (e) {}
                WAKE_LOCK = null;
              }
              if (req.readyState !== 4) {
                try { req.abort(); } catch (e) {}
              }
              resolve(audio);
              setTimeout(cb, 100);
            },
            methods: {
              onprogress: function(evt) {
                if (evt.lengthComputable) {
                  var end = new Date().getTime();
                  var elapsed = Math.max(1, end - start);
                  start = end;
                  var percentComplete = evt.loaded / evt.total * 100;
                  const frag = evt.loaded - loaded;
                  loaded = evt.loaded;
                  const speed = (frag / elapsed) * 1000;
                  BAR.style.width = `${percentComplete.toFixed(2)}%`;
                  CUR.innerHTML = `${readableFileSize(evt.loaded, true, 2)}`;
                  $router.setSoftKeyCenterText(`${readableFileSize(Math.round(speed), true)}/s`);
                  $router.setSoftKeyRightText(BAR.style.width);
                  MAX.innerHTML = `${readableFileSize(evt.total, true, 2)}`;
                }
              },
              onreadystatechange: function(evt) {
                const xhrTarget = evt.currentTarget;
                if (xhrTarget.readyState === 4) {
                  if (xhrTarget.status === 0) {
                    return; // aborted / network error → handled by onerror or Cancel
                  }
                  if (xhrTarget.response != null && xhrTarget.status >= 200 && xhrTarget.status <= 299 && xhrTarget.response.size > 0) {
                    if (!DS.available) {
                      $router.setSoftKeyCenterText('FAIL');
                      $router.setSoftKeyLeftText('Exit');
                      $router.showToast('Device storage not available');
                      return;
                    }
                    var ext = 'm4a';
                    const type = (xhrTarget.response.type || '').split(';')[0].trim();
                    if (MIME[type] != null) {
                      ext = MIME[type];
                    }
                    var localPath = ['ytm', 'cache'];
                    if (DS.deviceStorage.storageName != '') {
                      localPath = [DS.deviceStorage.storageName, ...localPath];
                    }
                    DS.addFile(localPath, `${audio.id}.${ext}`, xhrTarget.response)
                    .then((file) => {
                      audio['local_stream'] = file.name;
                      BAR.style.width = '100%';
                      $router.setSoftKeyCenterText('SUCCESS');
                      $router.setSoftKeyLeftText('Close');
                      $router.setSoftKeyRightText('100%');
                      $router.showToast('Saved to ' + localPath.join('/'));
                      if (WAKE_LOCK) {
                        try { WAKE_LOCK.unlock(); } catch (e) {}
                        WAKE_LOCK = null;
                      }
                    })
                    .catch((err) => {
                      console.log(err);
                      $router.setSoftKeyCenterText('FAIL');
                      $router.setSoftKeyLeftText('Exit');
                      $router.showToast('Unable to save file');
                    });
                  } else {
                    $router.setSoftKeyCenterText('FAIL');
                    $router.setSoftKeyLeftText('Exit');
                    $router.showToast(xhrTarget.status === 403 ? 'Stream rejected (403), try Invidious source' : `Download failed (HTTP ${xhrTarget.status})`);
                  }
                }
              },
              onerror: function(err) {
                console.log(err);
                $router.setSoftKeyCenterText('FAIL');
                $router.setSoftKeyLeftText('Exit');
                $router.showToast('Network Error');
              }
            },
            backKeyListener: function(evt) {
              return true;
            }
          })
        );
      })
      .catch((e) => {
        console.log(e);
        $router.showToast("Stream Unavailable");
        resolve(audio);
      })
      .finally(() => {
        $router.hideLoading();
      });
    });
  }

  function releaseMainObjectURL() {
    if (MAIN_OBJECT_URL) {
      try { window.URL.revokeObjectURL(MAIN_OBJECT_URL); } catch (e) {}
      MAIN_OBJECT_URL = null;
    }
  }

  function setMainPlayerSource(src, isObjectURL) {
    releaseMainObjectURL();
    if (isObjectURL) {
      MAIN_OBJECT_URL = src;
    }
    MAIN_PLAYER.mozAudioChannelType = 'content';
    MAIN_PLAYER.src = src;
    const shouldPlay = (state.getState('AUTOPLAY') && BOOT == false) || BOOT;
    BOOT = true;
    if (shouldPlay) {
      const p = MAIN_PLAYER.play();
      if (p && typeof p.catch === 'function') {
        p.catch((err) => {
          console.warn('play() rejected:', err && err.name);
        });
      }
    }
  }

  function playMainAudioFallback(audio, skipCache) {
    const fromCache = skipCache ? Promise.reject('skip cache') : getCachedURL(audio.id);
    fromCache
    .catch(() => getAudioStreamURL(audio.id))
    .then((url) => {
      setMainPlayerSource(url, false);
    })
    .catch((err) => {
      console.warn('Stream lookup failed, using latest_version redirect:', errorToString(err));
      // Last resort: let the Invidious instance resolve the stream (302 redirect)
      if (window['_INVIDIOUS_INSTANCE_']) {
        setMainPlayerSource(getLatestVersionURL(audio.id, 140), false);
      } else if (router) {
        router.showToast('Stream Unavailable');
      }
    });
  }

  function playMainAudio(idx, skipCache) {
    if (TRACKLIST[idx] == null) {
      return;
    }
    if (!skipCache) {
      MAIN_PLAY_RETRY = 0;
    }
    if (TRACKLIST[idx].local_stream && DS.available) {
      DS.__getFile__(TRACKLIST[idx].local_stream)
      .then((file) => {
        setMainPlayerSource(window.URL.createObjectURL(file), true);
      })
      .catch((err) => {
        console.warn("Unable to get the file: " + err.toString());
        playMainAudioFallback(TRACKLIST[idx], skipCache);
      });
    } else {
      playMainAudioFallback(TRACKLIST[idx], skipCache);
    }
  }

  function playMiniAudio($router, obj) {
    if (obj && obj.url != null) {
      miniPlayer($router, obj.url);
    } else if (obj && obj.id) {
      $router.showLoading();
      getCachedURL(obj.id, obj.bitrate)
      .catch(() => getAudioStreamURL(obj.id))
      .then((url) => {
        miniPlayer($router, url);
      })
      .catch((err) => {
        console.log(err);
        $router.showToast('Stream Unavailable');
      })
      .finally(() => {
        $router.hideLoading();
      });
    } else {
      $router.showToast('Stream Unavailable');
    }
  }

  const miniPlayer = function($router, url) {

    var PLAY_BTN, DURATION_SLIDER, CURRENT_TIME, DURATION, DURATION_ELAPSED, BUFFERED;
    const MINI_PLAYER = document.createElement("audio");
    MINI_PLAYER.volume = navigator.mozAudioChannelManager ? 1 : 0.02;
    MINI_PLAYER.mozAudioChannelType = 'content';

    $router.showBottomSheet(
      new Kai({
        name: 'miniPlayer',
        data: {
          title: 'miniPlayer',
          duration: 0,
        },
        templateUrl: document.location.origin + '/templates/miniPlayer.html',
        softKeyText: { left: 'Exit', center: '', right: '' },
        softKeyListener: {
          left: function() {
            $router.hideBottomSheet();
          },
          center: function() {
            if (MINI_PLAYER.duration > 0 && !MINI_PLAYER.paused) {
              MINI_PLAYER.pause();
            } else {
              const p = MINI_PLAYER.play();
              if (p && typeof p.catch === 'function') p.catch(() => {});
            }
          },
          right: function() {}
        },
        mounted: function() {

          DURATION_ELAPSED = document.getElementById('duration_elapsed');
          DURATION_SLIDER = document.getElementById('duration_slider');
          CURRENT_TIME = document.getElementById('current_time');
          DURATION = document.getElementById('duration');
          PLAY_BTN = document.getElementById('play_btn');
          BUFFERED = document.getElementById('duration_buffered');
          MINI_PLAYER.addEventListener('loadedmetadata', this.methods.onloadedmetadata);
          MINI_PLAYER.addEventListener('timeupdate', this.methods.ontimeupdate);
          MINI_PLAYER.addEventListener('pause', this.methods.onpause);
          MINI_PLAYER.addEventListener('play', this.methods.onplay);
          MINI_PLAYER.addEventListener('seeking', this.methods.onseeking);
          MINI_PLAYER.addEventListener('seeked', this.methods.onseeked);
          MINI_PLAYER.addEventListener('ratechange', this.methods.onratechange);
          MINI_PLAYER.addEventListener('ended', this.methods.onended);
          MINI_PLAYER.addEventListener('error', this.methods.onerror);
          document.addEventListener('keydown', this.methods.onKeydown);
          // console.log('miniPlayer:', url);
          if (!navigator.mozAudioChannelManager) {
            $router.setSoftKeyRightText((MINI_PLAYER.volume * 100).toFixed(0) + '%');
          }
          MAIN_PLAYER.pause();
          MINI_PLAYER.src = url;
          const p = MINI_PLAYER.play();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        },
        unmounted: function() {
          $router.hideLoading();
          MINI_PLAYER.pause();
          try {
            MINI_PLAYER.removeAttribute('src');
            MINI_PLAYER.load();
          } catch (e) {}
          MINI_PLAYER.removeEventListener('loadedmetadata', this.methods.onloadedmetadata);
          MINI_PLAYER.removeEventListener('timeupdate', this.methods.ontimeupdate);
          MINI_PLAYER.removeEventListener('pause', this.methods.onpause);
          MINI_PLAYER.removeEventListener('play', this.methods.onplay);
          MINI_PLAYER.removeEventListener('seeking', this.methods.onseeking);
          MINI_PLAYER.removeEventListener('seeked', this.methods.onseeked);
          MINI_PLAYER.removeEventListener('ratechange', this.methods.onratechange);
          MINI_PLAYER.removeEventListener('ended', this.methods.onended);
          MINI_PLAYER.removeEventListener('error', this.methods.onerror);
          document.removeEventListener('keydown', this.methods.onKeydown);
        },
        methods: {
          onloadedmetadata: function(evt) {
            seekTo(MINI_PLAYER, 0);
            this.data.duration = evt.target.duration;
            DURATION.innerHTML = convertTime(evt.target.duration);
          },
          ontimeupdate: function(evt) {
            const duration = this.data.duration || 1;
            const value = ((evt.target.currentTime / duration) * 100).toFixed(2);
            var currentTime = evt.target.currentTime;
            CURRENT_TIME.innerHTML = convertTime(evt.target.currentTime);
            DURATION_SLIDER.style.marginLeft = `${value}%`;
            DURATION_ELAPSED.style.width = `${value}%`;
            if (MINI_PLAYER.buffered.length > 0) {
              const value = (MINI_PLAYER.buffered.end(MINI_PLAYER.buffered.length - 1) / duration) * 100;
              BUFFERED.style.width = `${(value+5).toFixed(2)}%`;
            }
          },
          onpause: function() {
            PLAY_BTN.src = '/icons/img/play.png';
          },
          onplay: function() {
            PLAY_BTN.src = '/icons/img/pause.png';
          },
          onseeking: function(evt) {
            $router.showLoading(false);
            const duration = this.data.duration || 1;
            const value = ((evt.target.currentTime / duration) * 100).toFixed(2);
            CURRENT_TIME.innerHTML = convertTime(evt.target.currentTime);
            DURATION_SLIDER.style.marginLeft = `${value}%`;
          },
          onseeked: function(evt) {
            $router.hideLoading();
          },
          onratechange: function() {
            $router.setSoftKeyCenterText(`${MINI_PLAYER.playbackRate}x`);
          },
          onended: function() {
            PLAY_BTN.src = '/icons/img/play.png';
          },
          onerror: function (evt) {
            $router.hideLoading();
            MINI_PLAYER.pause();
            console.log(evt);
            PLAY_BTN.src = '/icons/img/play.png';
            const code = evt.target && evt.target.error ? evt.target.error.code : 0;
            if (code === 4) {
              $router.showToast('Stream rejected, try Invidious source / clear caches');
            } else {
              $router.showToast('Playback Error');
            }
          },
          onKeydown: function (evt) {
            switch (evt.key) {
              case '2':
                if (MINI_PLAYER.playbackRate >= 4)
                  return
                MINI_PLAYER.playbackRate += 0.25;
                break;
              case '5':
                MINI_PLAYER.playbackRate = 1;
                break;
              case '8':
                if (MINI_PLAYER.playbackRate <= 0.5)
                  return
                MINI_PLAYER.playbackRate -= 0.25;
                break;
            }
          }
        },
        dPadNavListener: {
          arrowUp: function() {
            volumeUp(MINI_PLAYER, $router, toggleVolume)
          },
          arrowRight: function() {
            seekTo(MINI_PLAYER, MINI_PLAYER.currentTime + 10);
          },
          arrowDown: function() {
            volumeDown(MINI_PLAYER, $router, toggleVolume);
          },
          arrowLeft: function() {
            seekTo(MINI_PLAYER, MINI_PLAYER.currentTime - 10);
          },
        },
        backKeyListener: function(evt) {
          return -1;
        }
      })
    );
  }

  const keypadshorcuts = new Kai({
    name: 'keypadshorcuts',
    data: {
      title: 'keypadshorcuts'
    },
    templateUrl: document.location.origin + '/templates/keypadshorcuts.html',
    mounted: function() {
      this.$router.setHeaderTitle('Keypad Shorcuts');
    },
    unmounted: function() {},
    methods: {},
    softKeyText: { left: '', center: '', right: '' },
    softKeyListener: {
      left: function() {},
      center: function() {},
      right: function() {}
    }
  });

  // Save a map of {id: audioRecord} into T_AUDIO; resolves with the number saved.
  function persistTracks(audio) {
    const ids = Object.keys(audio);
    return Promise.all(ids.map((id) => T_AUDIO.setItem(id, audio[id])))
    .then(() => ids.length);
  }

  // Generic single-line text prompt rendered as a bottom sheet dialog.
  // onSubmit(value) is called with the trimmed value when the user presses the right soft key.
  function textInputDialog(scope, title, placeholder, initial, onSubmit) {
    const inputId = 'text-input-' + Date.now();
    const dialog = Kai.createDialog(title, `<div><input id="${inputId}" placeholder="${placeholder}" class="kui-input" type="text" value=""/></div>`, null, '', undefined, '', undefined, '', undefined, undefined, scope.$router);
    dialog.mounted = () => {
      setTimeout(() => {
        const INPUT = document.getElementById(inputId);
        if (!INPUT) {
          return;
        }
        setTimeout(() => {
          scope.$router.setSoftKeyText('Cancel', '', 'OK');
          INPUT.value = initial || '';
        }, 103);
        INPUT.focus();
        const close = () => {
          scope.$router.hideBottomSheet();
          setTimeout(() => {
            INPUT.blur();
            if (scope.methods && typeof scope.methods.renderSoftKeyLCR === 'function') {
              scope.methods.renderSoftKeyLCR();
            } else if (scope.softKeyText) {
              scope.$router.setSoftKeyText(scope.softKeyText.left, scope.softKeyText.center, scope.softKeyText.right);
            }
          }, 100);
        };
        INPUT.addEventListener('keydown', (evt) => {
          switch (evt.key) {
            case 'Backspace':
            case 'EndCall':
              if (document.activeElement.value.length === 0) {
                evt.preventDefault();
                close();
              }
              break
            case 'Enter':
            case 'SoftRight':
              evt.preventDefault();
              const value = INPUT.value.trim();
              close();
              if (value.length > 0) {
                setTimeout(() => onSubmit(value), 120);
              }
              break
            case 'SoftLeft':
              evt.preventDefault();
              close();
              break
          }
        });
      });
    }
    dialog.dPadNavListener = {
      arrowUp: function() {
        const INPUT = document.getElementById(inputId);
        if (INPUT) INPUT.focus();
      },
      arrowDown: function() {
        const INPUT = document.getElementById(inputId);
        if (INPUT) INPUT.focus();
      }
    }
    scope.$router.showBottomSheet(dialog);
  }

  const settings = new Kai({
    name: 'settings',
    data: {
      title: 'settings',
      autoplay: false,
      autosleep: false,
    },
    verticalNavClass: '.settingNav',
    templateUrl: document.location.origin + '/templates/settings.html',
    mounted: function() {
      this.$router.setHeaderTitle('Settings');
      this.methods.listenState(this.$state.getState());
      this.$state.addGlobalListener(this.methods.listenState);
      this.methods.renderSoftKeyText();
    },
    unmounted: function() {
      this.$state.removeGlobalListener(this.methods.listenState);
    },
    methods: {
      listenState: function(data) {
        const obj = {};
        if (data['AUTOSLEEP'] != null) {
          obj['autosleep'] = JSON.parse(data['AUTOSLEEP']);
        }
        if (data['AUTOPLAY'] != null) {
          obj['autoplay'] = JSON.parse(data['AUTOPLAY']);
        }
        if (data['INVIDIOUS'] != null) {
          obj['invidious'] = data['INVIDIOUS'] ? true : false;
          window['INVIDIOUS'] = obj['invidious'];
        }
        this.setData(obj);
      },
      changeAutoSleep: function() {
        const choices = [
          { 'text': 'Off', value: false },
          { 'text': '1 Minutes(TEST)', value: 1 },
          { 'text': '10 Minutes', value: 10 },
          { 'text': '20 Minutes', value: 20 },
          { 'text': '30 Minutes', value: 30 },
          { 'text': '40 Minutes', value: 40 },
          { 'text': '50 Minutes', value: 50 },
          { 'text': '60 Minutes', value: 60 },
        ]
        const idx = choices.findIndex((opt) => {
          return opt.value === this.data.autosleep;
        });
        this.$router.showOptionMenu('Sleep Timer', choices, 'SELECT', (selected) => {
          const value = JSON.parse(selected.value);
          localStorage.setItem('AUTOSLEEP', value);
          this.$state.setState('AUTOSLEEP', JSON.parse(localStorage.getItem('AUTOSLEEP')));
        }, this.methods.renderSoftKeyText, idx);
      },
      changeAutoPlay: function() {
        const value = !this.data.autoplay;
        localStorage.setItem('AUTOPLAY', value);
        this.$state.setState('AUTOPLAY', JSON.parse(localStorage.getItem('AUTOPLAY')));
      },
      changeInvidious: function() {
        const value = setInvidiousProxy(!this.data.invidious);
        this.$state.setState('INVIDIOUS', value);
        this.$router.showToast(value ? 'Audio via Invidious (' + window['_INVIDIOUS_INSTANCE_'] + ')' : 'Audio direct from YouTube CDN');
      },
      renderSoftKeyText: function() {
        setTimeout(() => {
          if (this.verticalNavIndex == 0) {
            this.$router.setSoftKeyText('', 'TOGGLE', '');
          } else if (this.verticalNavIndex == 2) {
            this.$router.setSoftKeyText('', 'TOGGLE', '');
          } else {
            this.$router.setSoftKeyText('', 'SELECT', '');
          }
        }, 100);
      }
    },
    softKeyText: { left: '', center: 'SELECT', right: '' },
    softKeyListener: {
      left: function() {},
      center: function() {
        const listNav = document.querySelectorAll(this.verticalNavClass);
        if (this.verticalNavIndex > -1 && listNav[this.verticalNavIndex]) {
          listNav[this.verticalNavIndex].click();
        }
      },
      right: function() {}
    },
    dPadNavListener: {
      arrowUp: function() {
        this.navigateListNav(-1);
        this.methods.renderSoftKeyText();
      },
      arrowDown: function() {
        this.navigateListNav(1);
        this.methods.renderSoftKeyText();
      }
    }
  });

  const playlistEditor = function(scope, name = '', id = null) {
    const playlistDialog = Kai.createDialog((id ? 'Edit' : 'Add') + ' Playlist', `<div><input id="playlist-name" placeholder="Enter playlist name" class="kui-input" type="text" value=""/></div>`, null, '', undefined, '', undefined, '', undefined, undefined, scope.$router);
    playlistDialog.mounted = () => {
      setTimeout(() => {
        setTimeout(() => {
          scope.$router.setSoftKeyText('Cancel' , '', 'Save');
          INPUT.value = name;
        }, 103);
        const INPUT = document.getElementById('playlist-name');
        if (!INPUT) {
          return;
        }
        INPUT.focus();
        INPUT.addEventListener('keydown', (evt) => {
          switch (evt.key) {
            case 'Backspace':
            case 'EndCall':
              if (document.activeElement.value.length === 0) {
                scope.$router.hideBottomSheet();
                setTimeout(() => {
                  scope.methods.renderSoftKeyLCR();
                  INPUT.blur();
                }, 100);
              }
              break
            case 'SoftRight':
              scope.$router.hideBottomSheet();
              setTimeout(() => {
                scope.methods.renderSoftKeyLCR();
                INPUT.blur();
                scope.methods.playlistEditor(INPUT.value, id == null ? undefined : id); // null → new id
              }, 100);
              break
            case 'SoftLeft':
              scope.$router.hideBottomSheet();
              setTimeout(() => {
                scope.methods.renderSoftKeyLCR();
                INPUT.blur();
              }, 100);
              break
          }
        });
      });
    }
    playlistDialog.dPadNavListener = {
      arrowUp: function() {
        const INPUT = document.getElementById('playlist-name');
        INPUT.focus();
      },
      arrowDown: function() {
        const INPUT = document.getElementById('playlist-name');
        INPUT.focus();
      }
    }
    scope.$router.showBottomSheet(playlistDialog);
  }

  const playlist = new Kai({
    name: '_playlist_',
    data: {
      title: '_playlist_',
      playlists: [],
    },
    verticalNavClass: '.playlistNav',
    templateUrl: document.location.origin + '/templates/playlist.html',
    mounted: function() {
      this.$router.setHeaderTitle('Playlist');
      this.methods.getPlaylist();
    },
    unmounted: function() {},
    methods: {
      renderSoftKeyLCR: function() {
        if (this.$router.bottomSheet) {
          return
        }
        this.$router.setSoftKeyText('Add', '', '');
        if (this.verticalNavIndex > -1) {
          const selected = this.data.playlists[this.verticalNavIndex];
          if (selected) {
            this.$router.setSoftKeyText('Add', 'PLAY', 'Action');
          }
        }
      },
      getPlaylist: function() {
        var playlists = [];
        const src = this.$state.getState('PLAYLIST');
        for (var y in src) {
          playlists.push(src[y]);
        }
        this.setData({ playlists: playlists });
        this.methods.renderSoftKeyLCR();
      },
      playlistEditor: function(name = '', id = new Date().getTime()) {
        var isUpdate = false;
        var oldName = '';
        name = name.toString().trim();
        if (name.length === 0) {
          this.$router.showToast('Playlist name is required');
        } else {
          T_PLAYLIST.getItem(id.toString())
          .then((playlist) => {
            if (playlist == null) {
              playlist = { id: id, name: name, sync: false, collections: [] };
            } else {
              isUpdate = true;
              oldName = playlist.name;
              playlist.name = name;
            }
            return T_PLAYLIST.setItem(id.toString(), playlist);
          })
          .then((saved) => {
            var msg = `${name} added to Playlist`;
            if (isUpdate) {
              msg = `${oldName} updated to ${name}`;
            }
            this.$router.showToast(msg);
            const PLAYLIST = state.getState('PLAYLIST');
            PLAYLIST[saved.id] = saved;
            state.setState('PLAYLIST', PLAYLIST);
            this.methods.getPlaylist();
          })
          .catch((err) => {
            console.log(err);
            this.$router.showToast(err.toString());
          });
        }
      }
    },
    softKeyText: { left: 'Add', center: '', right: '' },
    softKeyListener: {
      left: function() {
        playlistEditor(this, '', null); // dialog title "Add Playlist" (id is generated on save)
      },
      center: function() {
        const _selected = this.data.playlists[this.verticalNavIndex];
        if (_selected) {
          playPlaylistById(_selected.id);
        }
      },
      right: function() {
        const _selected = this.data.playlists[this.verticalNavIndex];
        if (_selected) {
          var menus = [
            { text: 'Tracklist' },
            { text: 'Rename' },
            { text: 'Delete' },
          ]
          if (_selected.sync) {
            menus = [{ text: 'Sync' }, ...menus];
          }
          this.$router.showOptionMenu('Action', menus, 'Select', (selected) => {
            if (selected.text === 'Tracklist') {
              const DB = this.$state.getState('DATABASE');
              const PLAYLIST = this.$state.getState('PLAYLIST');
              const cur = PLAYLIST[_selected.id];
              if (cur) {
                if (cur.collections.length > 0) {
                  var collections = [];
                  cur.collections.forEach((v) => {
                    if (DB[v] == null) {
                      return; // track deleted from the database, skip silently
                    }
                    DB[v].checked = true;
                    DB[v].text = DB[v].title || DB[v].audio_title;
                    collections.push(DB[v]);
                  });
                  if (collections.length === 0) {
                    this.$router.showToast('Empty Tracklist');
                    return;
                  }
                  setTimeout(() => {
                    this.$router.showMultiSelector(_selected.name, collections, 'Select', null, 'Save', (_collections_) => {
                      var _tracklist = [];
                      _collections_.forEach((v) => {
                        if (v.checked) {
                          _tracklist.push(v.id);
                        }
                      });
                      PLAYLIST[_selected.id].collections = _tracklist;
                      T_PLAYLIST.setItem(_selected.id.toString(), PLAYLIST[_selected.id])
                      .then((saved) => {
                        this.$router.showToast('DONE');
                        this.$state.setState('PLAYLIST', PLAYLIST);
                        this.methods.getPlaylist();
                      })
                      .catch((err) => {
                        this.$router.showToast(err.toString());
                      });
                    }, 'Cancel', null, () => {
                      setTimeout(() => {
                        this.methods.renderSoftKeyLCR();
                      }, 100);
                    }, 0);
                  }, 105);
                } else {
                  this.$router.showToast('Empty Tracklist');
                }
              }
            } else if (selected.text === 'Rename') {
              playlistEditor(this, _selected.name, _selected.id);
            } else if (selected.text === 'Delete'){
              const PLAYLIST = this.$state.getState('PLAYLIST');
              if (PLAYLIST[_selected.id]) {
                this.$router.showDialog('Delete', `Are you sure to remove ${_selected.name} ?`, null, 'Yes', () => {
                  delete PLAYLIST[_selected.id];
                  T_PLAYLIST.removeItem(_selected.id.toString())
                  .then(() => {
                    this.$router.showToast(`${_selected.name} deleted`);
                    this.$state.setState('PLAYLIST', PLAYLIST);
                    this.verticalNavIndex -= 1;
                    this.methods.getPlaylist();
                  })
                  .catch((err) => {
                    this.$router.showToast(err.toString());
                  });
                }, 'No', () => {}, ' ', null, () => {
                  setTimeout(() => {
                    this.methods.renderSoftKeyLCR();
                  }, 100);
                });
              }
            } else if (selected.text === 'Sync') {
              // exclude current collections
              console.log('SYNC', _selected.collections);
              const playlistId = _selected.sync;
              const DB = this.$state.getState('DATABASE');
              const PLAYLIST = this.$state.getState('PLAYLIST');
              if (PLAYLIST[playlistId] == null) {
                this.$router.showToast(`Playlist ID not exist`);
                return;
              }
              this.$router.showLoading();
              getPlaylistVideos(playlistId)
              .then((remote) => {
                setTimeout(() => {
                  const existing = PLAYLIST[playlistId].collections || [];
                  const result = remote.videos.filter((v) => {
                    if (existing.indexOf(v.videoId) === -1) {
                      v.id = v.videoId;
                      v.checked = true;
                      v.text = v.title;
                      return true;
                    }
                    return false;
                  });
                  if (result.length === 0) {
                    this.$router.showToast('Up-to-date');
                    return;
                  }
                  this.$router.showMultiSelector(`Sync Playlist(${result.length})`, result, 'Select', null, 'Save', (list) => {
                    const playlist = PLAYLIST[playlistId];
                    const audio = {};
                    var added = 0;
                    list.forEach((i) => {
                      if (!i.checked || playlist.collections.indexOf(i.id) > -1) {
                        return;
                      }
                      added++;
                      playlist.collections.push(i.id);
                      if (DB[i.id] == null) {
                        audio[i.id] = {
                          id: i.id,
                          audio_title: i.title,
                          duration: false,
                          title: false,
                          artist: false,
                          album: false,
                          genre: false,
                          year: false,
                          track: false,
                          local_stream: false,
                        }
                      }
                    });
                    if (added === 0) {
                      this.$router.showToast('No track selected');
                      return;
                    }
                    var success = 0;
                    var done = Object.keys(audio).length;
                    if (done === 0) {
                      T_PLAYLIST.setItem(playlistId.toString(), playlist)
                      .then((savedPlaylist) => {
                        PLAYLIST[playlistId] = savedPlaylist;
                        this.$state.setState('PLAYLIST', PLAYLIST);
                        console.log('1 PLAYLIST SUCCESS:', playlistId, success);
                        this.$router.showToast('SYNC Success');
                        this.methods.getPlaylist();
                      })
                      .catch((err) => {
                        this.$router.showToast(err.toString());
                      });
                      return;
                    }
                    for (var x in audio) {
                      T_AUDIO.setItem(x, audio[x])
                      .then((savedAudio) => {
                        success++;
                        done--;
                        if (done === 0) {
                          if (success === Object.keys(audio).length) {
                            T_PLAYLIST.setItem(playlistId.toString(), playlist)
                            .then((savedPlaylist) => {
                              PLAYLIST[playlistId] = savedPlaylist;
                              Object.assign(DB, audio);
                              this.$state.setState('PLAYLIST', PLAYLIST);
                              this.$state.setState('DATABASE', DB);
                              console.log('2 PLAYLIST SUCCESS:', playlistId, success);
                              this.$router.showToast('SYNC Success');
                              this.methods.getPlaylist();
                            })
                            .catch((err) => {
                              this.$router.showToast(err.toString());
                            });
                          } else {
                            console.log('1 PLAYLIST FAIL:', playlistId, success);
                            this.$router.showToast('SYNC partially failed');
                          }
                        }
                      })
                      .catch((err) => {
                        console.log(err);
                        done--;
                        if (done === 0) {
                          console.log('2 PLAYLIST FAIL:', playlistId, success);
                        }
                      });
                    }
                  }, 'Cancel', null, () => {}, 0);
                }, 100);
              })
              .catch((err) => {
                console.log(err);
                this.$router.showToast(errorToString(err));
              })
              .finally(() => {
                this.$router.hideLoading();
              });
            }
          }, () => {
            setTimeout(() => {
              this.methods.renderSoftKeyLCR();
            }, 100);
          }, 0);
        }
      }
    },
    dPadNavListener: {
      arrowUp: function() {
        if (this.verticalNavIndex <= 0) {
          return
        }
        this.navigateListNav(-1);
        this.methods.renderSoftKeyLCR();
      },
      arrowDown: function() {
        if (this.verticalNavIndex === this.data.playlists.length - 1) {
          return
        }
        this.navigateListNav(1);
        this.methods.renderSoftKeyLCR();
      }
    },
  });

  const audioMetadataEditor = function ($router, audio, isUpdate = false) {
    T_AUDIO.getItem(audio.id)
    .then((METADATA) => {
      if (METADATA != null && !isUpdate) {
       $router.showToast('Already exist inside DB');
      } else {
        $router.push(
          new Kai({
            name: 'audioEditor',
            data: {
              title: isUpdate ? (audio.title || '') : '',
              artist: isUpdate ? (audio.artist || '') : '',
              album: isUpdate ? (audio.album || '') : '',
              genre: isUpdate ? (audio.genre || '') : '',
              year: isUpdate ? (audio.year || '') : '',
              track: isUpdate ? (audio.track || '') : '',
            },
            verticalNavClass: '.audioEditorNav',
            templateUrl: document.location.origin + '/templates/audioEditor.html',
            mounted: function() {
              this.$router.setHeaderTitle(`Metadata #${audio.id}`);
            },
            unmounted: function() {},
            methods: {
              submit: function() {
                const metadata = {
                  id: audio.id,
                  audio_title: audio.audio_title || audio.title,
                  duration: audio.duration,
                  title: false,
                  artist: false,
                  album: false,
                  genre: false,
                  year: false,
                  track: false,
                  local_stream: audio.local_stream || false,
                };
                if (document.getElementById('title').value.trim().length > 0) {
                  metadata.title = document.getElementById('title').value.trim();
                }
                if (document.getElementById('artist').value.trim().length > 0) {
                  metadata.artist = document.getElementById('artist').value.trim();
                }
                if (document.getElementById('album').value.trim().length > 0) {
                  metadata.album = document.getElementById('album').value.trim();
                }
                if (document.getElementById('genre').value.trim().length > 0) {
                  metadata.genre = document.getElementById('genre').value.trim();
                }
                if (document.getElementById('year').value.trim().length > 0) {
                  try {
                    metadata.year = JSON.parse(document.getElementById('year').value.trim());
                  } catch(e){}
                }
                if (document.getElementById('track').value.trim().length > 0) {
                  try {
                    metadata.track = JSON.parse(document.getElementById('track').value.trim());
                  } catch(e){}
                }

                T_AUDIO.setItem(audio.id, metadata)
                .then((saved) => {
                  $router.showToast('Saved');
                  const list = state.getState('DATABASE');
                  list[audio.id] = metadata;
                  $router.pop();
                  setTimeout(() => {
                    state.setState('DATABASE', list);
                  }, 103);
                })
                .catch((err) => {
                  console.log(err);
                  $router.showToast(err.toString());
                });
              }
            },
            softKeyText: { left: '', center: '', right: '' },
            softKeyListener: {
              left: function() {},
              center: function() {
                const listNav = document.querySelectorAll(this.verticalNavClass);
                if (this.verticalNavIndex > -1) {
                  if (listNav[this.verticalNavIndex]) {
                    listNav[this.verticalNavIndex].click();
                  }
                }
              },
              right: function() {}
            },
            dPadNavListener: {
              arrowUp: function() {
                this.navigateListNav(-1);
              },
              arrowDown: function() {
                this.navigateListNav(1);
              }
            }
          })
        );
      }
    }).catch((err) => {
      console.log(err);
    });
  }

  const search = new Kai({
    name: 'search',
    data: {
      title: 'search',
      results: [],
      empty: true,
      key: '',
      query: '',
      nextPageToken: null,
      continuation: null,
      estimatedResults: ''
    },
    verticalNavClass: '.searchNav',
    templateUrl: document.location.origin + '/templates/search.html',
    mounted: function() {
      this.$router.setHeaderTitle('Search');
      this.methods.renderSoftKeyLCR();
    },
    unmounted: function() {

    },
    methods: {
      selected: function(vid) {
        this.$router.showLoading();
        getVideoLinks(vid.id)
        .then((links) => {
          const audio = listAudioFormats(links);
          if (audio.length > 0) {
            this.methods.showPlayOption(audio);
          } else {
            this.$router.showToast('No audio stream');
          }
        })
        .catch((err) => {
          console.log(err);
          this.$router.showToast(errorToString(err));
        })
        .finally(() => {
          this.$router.hideLoading();
        });
      },
      showPlayOption: function(formats) {
        this.$router.showOptionMenu('Select Format', formats, 'Select', (selected) => {
          playMiniAudio(this.$router, selected);
        }, () => {
          setTimeout(() => {
            this.methods.renderSoftKeyLCR();
          }, 100);
        }, 0);
      },
      search: function(q = '') {
        q = (q || '').trim();
        if (q.length === 0) {
          this.$router.showToast('Enter a keyword');
          return;
        }
        this.$router.showLoading();
        searchVideo(q)
        .then((data) => {
          this.verticalNavIndex = -1;
          const audios = this.methods.extractAudios(data);
          this.setData({
            results: [],
            query: q,
            key: data.key || '',
            estimatedResults: data.estimatedResults || '',
            continuation: data.continuation || null,
            nextPageToken: data.continuation ? (data.continuation.token || data.continuation.page || true) : null,
          });
          this.methods.processResult(audios);
          if (audios.length === 0) {
            this.$router.showToast('No results');
          }
        })
        .catch((err) => {
          console.log(err);
          this.$router.showToast(errorToString(err));
        })
        .finally(() => {
          this.$router.hideLoading();
        });
      },
      nextPage: function() {
        if (!this.data.continuation) {
          return;
        }
        this.$router.showLoading();
        searchVideo(this.data.query, this.data.continuation)
        .then((data) => {
          const audios = this.methods.extractAudios(data);
          this.setData({
            key: data.key || this.data.key,
            estimatedResults: data.estimatedResults || this.data.estimatedResults,
            continuation: data.continuation || null,
            nextPageToken: data.continuation ? (data.continuation.token || data.continuation.page || true) : null,
          });
          this.methods.processResult(audios);
        })
        .catch((err) => {
          console.log(err);
          this.$router.showToast(errorToString(err));
        })
        .finally(() => {
          this.$router.hideLoading();
        });
      },
      extractAudios: function(data) {
        const seen = {};
        this.data.results.forEach((r) => { if (r && r.id) seen[r.id] = true; });
        const audios = [];
        (data.results || []).forEach((t) => {
          if (t && t.video && t.video.id && !seen[t.video.id]) {
            seen[t.video.id] = true;
            t.video.isAudio = true;
            audios.push(t.video);
          }
        });
        return audios;
      },
      processResult: function(audios) {
        const last = this.data.results[this.data.results.length - 1];
        if (last && !last.isAudio) {
          this.data.results.pop();
        }
        const merged = [...this.data.results, ...audios];
        if (this.data.nextPageToken) {
          merged.push({ isAudio: false });
        }
        this.setData({ results: merged, empty: merged.length === 0 });
        this.methods.renderSoftKeyLCR();
      },
      renderSoftKeyLCR: function() {
        if (this.$router.bottomSheet) {
          return
        }
        this.$router.setSoftKeyCenterText('');
        this.$router.setSoftKeyRightText('');
        if (this.verticalNavIndex > -1) {
          const selected = this.data.results[this.verticalNavIndex];
          if (selected) {
            if (selected.isAudio) {
              this.$router.setSoftKeyCenterText('PLAY');
              this.$router.setSoftKeyRightText('Save');
            } else {
              this.$router.setSoftKeyCenterText('SELECT');
            }
          }
        }
      }
    },
    softKeyText: { left: 'Search', center: '', right: '' },
    softKeyListener: {
      left: function() {
        const searchDialog = Kai.createDialog('Search', '<div><input id="search-input" placeholder="Enter your keyword" class="kui-input" type="text" /></div>', null, '', undefined, '', undefined, '', undefined, undefined, this.$router);
        searchDialog.mounted = () => {
          setTimeout(() => {
            setTimeout(() => {
              this.$router.setSoftKeyText('Cancel' , '', 'Go');
            }, 103);
            const SEARCH_INPUT = document.getElementById('search-input');
            if (!SEARCH_INPUT) {
              return;
            }
            SEARCH_INPUT.focus();
            SEARCH_INPUT.addEventListener('keydown', (evt) => {
              switch (evt.key) {
                case 'Backspace':
                case 'EndCall':
                  if (document.activeElement.value.length === 0) {
                    this.$router.hideBottomSheet();
                    setTimeout(() => {
                      this.methods.renderSoftKeyLCR();
                      SEARCH_INPUT.blur();
                    }, 100);
                  }
                  break
                case 'SoftRight':
                  this.$router.hideBottomSheet();
                  setTimeout(() => {
                    this.methods.renderSoftKeyLCR();
                    SEARCH_INPUT.blur();
                    this.methods.search(SEARCH_INPUT.value);
                  }, 100);
                  break
                case 'SoftLeft':
                  this.$router.hideBottomSheet();
                  setTimeout(() => {
                    this.methods.renderSoftKeyLCR();
                    SEARCH_INPUT.blur();
                  }, 100);
                  break
              }
            });
          });
        }
        searchDialog.dPadNavListener = {
          arrowUp: function() {
            const SEARCH_INPUT = document.getElementById('search-input');
            SEARCH_INPUT.focus();
          },
          arrowDown: function() {
            const SEARCH_INPUT = document.getElementById('search-input');
            SEARCH_INPUT.focus();
          }
        }
        this.$router.showBottomSheet(searchDialog);
      },
      center: function() {
        const selected = this.data.results[this.verticalNavIndex];
        if (selected) {
          if (selected.isAudio)
            this.methods.selected(selected);
          else
            this.methods.nextPage();
        }
      },
      right: function() {
        const selected = this.data.results[this.verticalNavIndex];
        if (selected) {
          if (selected.isAudio)
            audioMetadataEditor(this.$router, selected);
        }
      }
    },
    dPadNavListener: {
      arrowUp: function() {
        if (this.verticalNavIndex <= 0) {
          return
        }
        this.navigateListNav(-1);
        this.methods.renderSoftKeyLCR();
      },
      arrowDown: function() {
        if (this.verticalNavIndex === this.data.results.length - 1) {
          return
        }
        this.navigateListNav(1);
        this.methods.renderSoftKeyLCR();
      }
    },
    backKeyListener: function() {
      return false;
    }
  });

  const database = new Kai({
    name: 'database',
    data: {
      title: 'database',
      bulk_results: [],
      results: [],
      empty: true,
      perPage: 50,
      nextPage: null
    },
    verticalNavClass: '.searchNav',
    templateUrl: document.location.origin + '/templates/search.html',
    mounted: function() {
      this.$state.addStateListener('DATABASE', this.methods.dbStateListener);
      this.$router.setHeaderTitle('Local Audio Database');
      if (this.data.results.length === 0) {
        this.methods.resetSearch();
      }
      this.methods.renderSoftKeyLCR();
    },
    unmounted: function() {
      this.$state.removeStateListener('DATABASE', this.methods.dbStateListener);
    },
    methods: {
      dbStateListener: function(db) {
        const temp = this.data.results;
        const item = temp[this.verticalNavIndex];
        if (item == null || item.id == null || db[item.id] == null) {
          return;
        }
        Object.assign(item, db[item.id]);
        temp[this.verticalNavIndex] = item;
        this.setData({ results: temp, empty: temp.length === 0 });
      },
      selected: function(vid) {
        this.$router.showLoading();
        getVideoLinks(vid.id)
        .then((links) => {
          const audio = listAudioFormats(links);
          if (audio.length > 0) {
            this.methods.showPlayOption(audio);
          } else {
            this.$router.showToast('No audio stream');
          }
        })
        .catch((err) => {
          console.log(err);
          this.$router.showToast(errorToString(err));
        })
        .finally(() => {
          this.$router.hideLoading();
        });
      },
      showPlayOption: function(formats) {
        this.$router.showOptionMenu('Select Format', formats, 'Select', (selected) => {
          playMiniAudio(this.$router, selected);
        }, () => {
          setTimeout(() => {
            this.methods.renderSoftKeyLCR();
          }, 100);
        }, 0);
      },
      presentInPlaylist: function(audio) {
        var _playlist = []
        const PLAYLIST = this.$state.getState('PLAYLIST');
        for (var y in PLAYLIST) {
          var checked = false;
          if (PLAYLIST[y].collections.indexOf(audio.id) > -1) {
            checked = true;
          }
          _playlist.push({ "text": PLAYLIST[y].name, "id": PLAYLIST[y].id, "checked": checked });
        }
        if (_playlist.length === 0) {
          this.$router.showToast("Empty Playlist");
        } else {
          this.$router.showMultiSelector('Playlist', _playlist, 'Select', null, 'Save', (cursor) => {
            cursor.forEach((p) => {
              const idx = PLAYLIST[p.id].collections.indexOf(audio.id);
              if (p.checked) {
                if (idx === -1){
                  PLAYLIST[p.id].collections.push(audio.id);
                }
              } else {
                if (idx > -1){
                  PLAYLIST[p.id].collections.splice(idx, 1);
                }
              }
            });
            var done = Object.keys(PLAYLIST).length;
            for (var key in PLAYLIST) {
              T_PLAYLIST.setItem(key, PLAYLIST[key])
              .finally(() => {
                done--;
                if (done === 0) {
                  this.$state.setState('PLAYLIST', PLAYLIST);
                  this.$router.showToast('DONE');
                }
              });
            }
          }, 'Cancel', null, () => {
            setTimeout(() => {
              this.methods.renderSoftKeyLCR();
            }, 100);
          }, 0);
        }
      },
      deleteAudio: function(audio) {
        var playlists = [];
        const DB = this.$state.getState('DATABASE');
        const PLAYLIST = this.$state.getState('PLAYLIST');
        if (DB[audio.id]) {
          this.$router.showDialog('Delete', `Are you sure to remove ${audio.audio_title} ?`, null, 'Yes', () => {
            for (var y in PLAYLIST) {
              const idx = PLAYLIST[y].collections.indexOf(audio.id);
              if (idx > -1){
                PLAYLIST[y].collections.splice(idx, 1);
                playlists.push(PLAYLIST[y]);
              }
            }
            if (playlists.length > 0) {
              playlists.forEach((cursor) => {
                T_PLAYLIST.setItem(cursor.id.toString(), cursor);
              });
              this.$state.setState('PLAYLIST', PLAYLIST);
            }
            T_AUDIO.removeItem(audio.id)
            .then(() => {
              delete DB[audio.id];
              this.$router.showToast('Deleted');
              this.$state.setState('DATABASE', DB);
              this.methods.resetSearch();
            })
            .catch((err) => {
              console.log(err);
              this.$router.showToast(err.toString());
            });
          }, 'No', () => {}, ' ', null, () => {
            setTimeout(() => {
              this.methods.renderSoftKeyLCR();
            }, 100);
          });
        }
      },
      resetSearch: function() {
        this.verticalNavIndex = -1;
        const src = this.$state.getState('DATABASE');
        const bulk_results = [];
        for (var x in src) {
          src[x].isAudio = true
          bulk_results.push(src[x]);
        }
        this.data.results = [];
        this.data.bulk_results = bulk_results;
        this.methods.nextPage(0);
      },
      search: function(keyword = '') {
        keyword = keyword.trim();
        if (keyword.length === 0) {
          this.methods.resetSearch();
        } else {
          const src = this.$state.getState('DATABASE');
          const bulk_results = [];
          for (var x in src) {
            src[x].isAudio = true;
            if (src[x].audio_title.toLowerCase().indexOf(keyword.toLowerCase()) > -1) {
              bulk_results.push(src[x]);
            } else {
              const fields = ['title', 'artist', 'album', 'genre', 'year'];
              for (var v in fields) {
                if (src[x][fields[v]] && src[x][fields[v]].toString().toLowerCase().indexOf(keyword.toLowerCase()) > -1) {
                  bulk_results.push(src[x]);
                  break
                }
              }
            }
          }
          this.verticalNavIndex = -1;
          this.data.results = [];
          this.data.bulk_results = bulk_results;
          this.methods.nextPage(0);
        }
      },
      nextPage: function(page = 0) {
        const last = this.data.results[this.data.results.length - 1];
        if (last && !last.isAudio) {
          this.data.results.pop();
        }
        var totalPages = Math.floor(this.data.bulk_results.length / this.data.perPage);
        if ((this.data.bulk_results.length % this.data.perPage) > 0) {
          totalPages++;
        }
        var next = null;
        var start = page * this.data.perPage;
        var end = start + this.data.perPage;
        if (page < (totalPages - 1)) {
          next = page + 1;
        }
        this.data.nextPage = next;
        const merged = [...this.data.results, ...this.data.bulk_results.slice(start, end)];
        if (this.data.nextPage) {
          merged.push({ isAudio: false });
        }
        this.setData({ results: merged, empty: merged.length === 0 });
        this.methods.renderSoftKeyLCR();
      },
      renderSoftKeyLCR: function() {
        if (this.$router.bottomSheet) {
          return
        }
        this.$router.setSoftKeyText('Search', '', '');
        if (this.verticalNavIndex > -1) {
          const selected = this.data.results[this.verticalNavIndex];
          if (selected) {
            if (selected.isAudio) {
              this.$router.setSoftKeyText('Search', 'PLAY', 'Action');
            } else {
              this.$router.setSoftKeyText('Search', 'SELECT', '');
            }
          }
        }
      }
    },
    softKeyText: { left: 'Search', center: '', right: '' },
    softKeyListener: {
      left: function() {
        const searchDialog = Kai.createDialog('Search', '<div><input id="local-search-input" placeholder="Enter your keyword" class="kui-input" type="text" /></div>', null, '', undefined, '', undefined, '', undefined, undefined, this.$router);
        searchDialog.mounted = () => {
          setTimeout(() => {
            setTimeout(() => {
              this.$router.setSoftKeyText('Cancel' , '', 'Go');
            }, 103);
            const SEARCH_INPUT = document.getElementById('local-search-input');
            if (!SEARCH_INPUT) {
              return;
            }
            SEARCH_INPUT.focus();
            SEARCH_INPUT.addEventListener('keydown', (evt) => {
              switch (evt.key) {
                case 'Backspace':
                case 'EndCall':
                  if (document.activeElement.value.length === 0) {
                    this.$router.hideBottomSheet();
                    setTimeout(() => {
                      this.methods.renderSoftKeyLCR();
                      SEARCH_INPUT.blur();
                    }, 100);
                  }
                  break
                case 'SoftRight':
                  this.$router.hideBottomSheet();
                  setTimeout(() => {
                    this.methods.renderSoftKeyLCR();
                    SEARCH_INPUT.blur();
                    this.methods.search(SEARCH_INPUT.value);
                  }, 100);
                  break
                case 'SoftLeft':
                  this.$router.hideBottomSheet();
                  setTimeout(() => {
                    this.methods.renderSoftKeyLCR();
                    SEARCH_INPUT.blur();
                  }, 100);
                  break
              }
            });
          });
        }
        searchDialog.dPadNavListener = {
          arrowUp: function() {
            const SEARCH_INPUT = document.getElementById('local-search-input');
            SEARCH_INPUT.focus();
          },
          arrowDown: function() {
            const SEARCH_INPUT = document.getElementById('local-search-input');
            SEARCH_INPUT.focus();
          }
        }
        this.$router.showBottomSheet(searchDialog);
      },
      center: function() {
        const selected = this.data.results[this.verticalNavIndex];
        if (selected) {
          if (selected.isAudio)
            this.methods.selected(selected);
          else {
            if (this.data.nextPage != null)
            this.methods.nextPage(this.data.nextPage);
          }
        }
      },
      right: function() {
        const _selected = this.data.results[this.verticalNavIndex];
        if (_selected) {
          if (_selected.isAudio) {
            const menus = [
              { text: 'Play All' },
              { text: 'Add/Remove from Playlist' },
              { text: 'Update Metadata' },
              { text: _selected.local_stream ? 'Remove Audio' : 'Download Audio' },
              { text: 'Delete' },
            ]
            this.$router.showOptionMenu('Menu', menus, 'Select', (selected) => {
              if (selected.text === 'Update Metadata') {
                audioMetadataEditor(this.$router, _selected, true);
              } else if (selected.text === 'Add/Remove from Playlist') {
                this.methods.presentInPlaylist(_selected);
              } else if (selected.text === 'Delete') {
                this.methods.deleteAudio(_selected);
              } else if (selected.text === 'Play All') {
                playDefaultPlaylist();
              } else if (selected.text === 'Download Audio') {
                downloadAudio(this.$router, JSON.parse(JSON.stringify(_selected)), this.methods.renderSoftKeyLCR)
                .then((downloaded) => {
                  delete downloaded['isAudio'];
                  if (downloaded['local_stream']) {
                    T_AUDIO.getItem(downloaded['id'].toString())
                    .then((cur) => {
                      if (cur != null) {
                        cur['local_stream'] = downloaded['local_stream'];
                        return T_AUDIO.setItem(downloaded['id'].toString(), cur);
                      }
                      return Promise.reject('Audio ID not exist');
                    })
                    .then((saved) => {
                      const DB = this.$state.getState('DATABASE');
                      DB[saved.id] = saved;
                      this.$state.setState('DATABASE', DB);
                    })
                    .catch((err) => {
                      console.log(err);
                    });
                  }
                })
                .finally(() => {
                  setTimeout(() => {
                    this.methods.renderSoftKeyLCR();
                  }, 100);
                })
              } else if (selected.text === 'Remove Audio') {
                const path = _selected['local_stream'].split('/');
                if (path[0] == '') {
                  path.splice(0, 1);
                }
                const name = path.pop();
                const detach = () => {
                  return T_AUDIO.getItem(_selected['id'].toString())
                  .then((cur) => {
                    if (cur != null) {
                      cur['local_stream'] = false;
                      return T_AUDIO.setItem(_selected['id'].toString(), cur);
                    }
                    return Promise.reject('Audio ID not exist');
                  })
                  .then((saved) => {
                    const DB = this.$state.getState('DATABASE');
                    DB[saved.id] = saved;
                    this.$state.setState('DATABASE', DB);
                    this.$router.showToast('Local audio removed');
                  });
                };
                DS.deleteFile(path, name, true)
                .then(detach)
                .catch((err) => {
                  console.log(err);
                  // file already gone → still detach the stale reference
                  detach().catch((e) => {
                    console.log(e);
                    this.$router.showToast('Unable to remove audio');
                  });
                });
              }
            }, () => {
              setTimeout(() => {
                this.methods.renderSoftKeyLCR();
              }, 100);
            }, 0);
          }
        }
      }
    },
    dPadNavListener: {
      arrowUp: function() {
        if (this.verticalNavIndex <= 0) {
          return
        }
        this.navigateListNav(-1);
        this.methods.renderSoftKeyLCR();
      },
      arrowDown: function() {
        if (this.verticalNavIndex === this.data.results.length - 1) {
          return
        }
        this.navigateListNav(1);
        this.methods.renderSoftKeyLCR();
      }
    },
    backKeyListener: function() {
      this.data.title = 'database';
      this.data.bulk_results = [];
      this.data.results = [];
      this.data.perPage = 50;
      this.data.nextPage = null;
    },
  });

  const home = new Kai({
    name: 'home',
    data: {
      title: 'YT Music'
    },
    templateUrl: document.location.origin + '/templates/home.html',
    mounted: function() {
      this.$router.setHeaderTitle('YT Music');

      MAIN_DURATION_ELAPSED = document.getElementById('main_duration_elapsed');
      MAIN_DURATION_SLIDER = document.getElementById('main_duration_slider');
      MAIN_CURRENT_TIME = document.getElementById('main_current_time');
      MAIN_DURATION = document.getElementById('main_duration');
      MAIN_THUMB = document.getElementById('main_thumb');
      MAIN_TITLE = document.getElementById('main_title');
      MAIN_PLAY_BTN = document.getElementById('main_play_btn');
      MAIN_BUFFERING = document.getElementById('thumb_buffering');
      MAIN_BUFFERED = document.getElementById('main_duration_buffered');
      MAIN_CURRENT_TIME.innerHTML = convertTime(MAIN_PLAYER.currentTime);

      MAIN_PLAYER.addEventListener('loadedmetadata', this.methods.onloadedmetadata);
      MAIN_PLAYER.addEventListener('timeupdate', this.methods.ontimeupdate);
      MAIN_PLAYER.addEventListener('pause', this.methods.onpause);
      MAIN_PLAYER.addEventListener('play', this.methods.onplay);
      MAIN_PLAYER.addEventListener('seeking', this.methods.onseeking);
      MAIN_PLAYER.addEventListener('seeked', this.methods.onseeked);
      MAIN_PLAYER.addEventListener('ratechange', this.methods.onratechange);
      MAIN_PLAYER.addEventListener('ended', this.methods.onended);
      MAIN_PLAYER.addEventListener('error', this.methods.onerror);
      document.addEventListener('keydown', this.methods.onKeydown);

      MAIN_DURATION.innerHTML = convertTime(this.$state.getState('MAIN_PLAYER_DURATION'));

      this.$state.addStateListener('TRACKLIST_IDX', this.methods.listenTrackChange);
      this.methods.listenTrackChange(this.$state.getState('TRACKLIST_IDX'));

      T_CONFIGURATION.getItem('REPEAT')
      .then((val) => {
        if (val != null) {
          var REPEAT = val - 1;
          this.$state.setState('REPEAT', REPEAT);
          var style = toggleRepeat();
          const r = document.getElementById('main_repeat');
          r.className = style.classList;
          r.src = style.src;
        }
      });

      T_CONFIGURATION.getItem('SHUFFLE')
      .then((val) => {
        const s = document.getElementById('main_shuffle');
        if (val != null && val) {
          s.className = '';
        } else {
          s.className = 'inactive';
        }
      });

      if (TRACKLIST.length === 0)
        MAIN_BUFFERING.style.visibility = 'hidden';

      this.methods.togglePlayIcon();
    },
    unmounted: function() {
      this.$state.removeStateListener('TRACKLIST_IDX', this.methods.listenTrackChange);
      MAIN_PLAYER.removeEventListener('loadedmetadata', this.methods.onloadedmetadata);
      MAIN_PLAYER.removeEventListener('timeupdate', this.methods.ontimeupdate);
      MAIN_PLAYER.removeEventListener('pause', this.methods.onpause);
      MAIN_PLAYER.removeEventListener('play', this.methods.onplay);
      MAIN_PLAYER.removeEventListener('seeking', this.methods.onseeking);
      MAIN_PLAYER.removeEventListener('seeked', this.methods.onseeked);
      MAIN_PLAYER.removeEventListener('ratechange', this.methods.onratechange);
      MAIN_PLAYER.removeEventListener('ended', this.methods.onended);
      MAIN_PLAYER.removeEventListener('error', this.methods.onerror);
      document.removeEventListener('keydown', this.methods.onKeydown);
    },
    methods: {
      togglePlayIcon: function() {
        if (MAIN_PLAYER.duration > 0 && !MAIN_PLAYER.paused) {
          MAIN_PLAY_BTN.src = '/icons/img/baseline_pause_circle_filled_white_36dp.png';
        } else {
          MAIN_PLAY_BTN.src = '/icons/img/baseline_play_circle_filled_white_36dp.png';
        }
      },
      onloadedmetadata: function(evt) {
        MAIN_BUFFERING.style.visibility = 'hidden';
        MAIN_DURATION.innerHTML = convertTime(evt.target.duration);
      },
      ontimeupdate: function(evt) {
        const duration = this.$state.getState('MAIN_PLAYER_DURATION') || 1;
        const value = ((evt.target.currentTime / duration) * 100).toFixed(2);
        MAIN_CURRENT_TIME.innerHTML = convertTime(evt.target.currentTime);
        MAIN_DURATION_SLIDER.style.marginLeft = `${value}%`;
        MAIN_DURATION_ELAPSED.style.width = `${value}%`;
        MAIN_PLAY_BTN.src = '/icons/img/baseline_pause_circle_filled_white_36dp.png';
        if (MAIN_PLAYER.buffered.length > 0) {
          const value = (MAIN_PLAYER.buffered.end(MAIN_PLAYER.buffered.length - 1) / duration) * 100;
          MAIN_BUFFERED.style.width = `${(value+5).toFixed(2)}%`;
        }
        // console.log('ontimeupdate', evt.target.duration); // weird behaviour ¯\_(ツ)_/¯
      },
      onpause: function() {
        MAIN_PLAY_BTN.src = '/icons/img/baseline_play_circle_filled_white_36dp.png';
      },
      onplay: function() {
        MAIN_PLAY_BTN.src = '/icons/img/baseline_pause_circle_filled_white_36dp.png';
      },
      onseeking: function(evt) {
        MAIN_BUFFERING.style.visibility = 'visible';
        const duration = this.$state.getState('MAIN_PLAYER_DURATION') || 1;
        const value = ((evt.target.currentTime / duration) * 100).toFixed(2);
        MAIN_CURRENT_TIME.innerHTML = convertTime(evt.target.currentTime);
        MAIN_DURATION_SLIDER.style.marginLeft = `${value}%`;
      },
      onseeked: function(evt) {
        MAIN_BUFFERING.style.visibility = 'hidden';
      },
      onratechange: function() {
        if (this.$router.bottomSheet === false)
          this.$router.setSoftKeyCenterText(`${MAIN_PLAYER.playbackRate}x`);
      },
      onended: function() {
        MAIN_PLAY_BTN.src = '/icons/img/baseline_play_circle_filled_white_36dp.png';
      },
      onerror: function (evt) {
        const mediaError = evt && evt.target ? evt.target.error : null;
        const code = mediaError ? mediaError.code : 0;
        MAIN_PLAYER.pause();
        MAIN_PLAY_BTN.src = '/icons/img/baseline_play_circle_filled_white_36dp.png';
        MAIN_BUFFERING.style.visibility = 'hidden';
        if (!MAIN_PLAYER.currentSrc && !MAIN_PLAYER.src) {
          return; // error raised by clearing the source, nothing to retry
        }
        const idx = this.$state.getState('TRACKLIST_IDX');
        // code 2 = network, 3 = decode, 4 = src not supported (expired/403 link)
        if ((code === 4 || code === 2 || code === 3) && TRACKLIST[idx] && MAIN_PLAY_RETRY < MAX_PLAY_RETRY) {
          MAIN_PLAY_RETRY++;
          this.$router.showToast(`Stream error, retrying (${MAIN_PLAY_RETRY}/${MAX_PLAY_RETRY})`);
          T_CACHED_URL.removeItem(TRACKLIST[idx].id)
          .finally(() => {
            setTimeout(() => {
              playMainAudio(idx, true);
            }, 400);
          });
        } else {
          // budget exhausted: stay paused, the counter is re-armed by a new
          // track, a successful loadedmetadata or the user pressing play
          this.$router.showToast(code === 4 ? 'Stream rejected. Try another Invidious instance or toggle Audio Source.' : 'Playback Error');
        }
      },
      listenTrackChange: function(val) {
        const T = TRACKLIST[val];
        if (T) {
          MAIN_BUFFERING.style.visibility = 'hidden';
          MAIN_TITLE.innerHTML = T.title || T.audio_title;
          MAIN_THUMB.style.backgroundImage = `url('https://i.ytimg.com/vi/${T.id}/2.jpg')`;
          document.getElementById('main_artist').innerHTML = T.artist || 'UNKNOWN';
          document.getElementById('main_album').innerHTML = T.album || 'UNKNOWN';
          document.getElementById('main_genre').innerHTML = T.genre || 'UNKNOWN';
          document.getElementById('main_list').innerHTML = `${(val + 1).toString()}/${TRACKLIST.length.toString()}`;
        }
      },
      onKeydown: function (evt) {
        if (this.$router.bottomSheet || this.$router.loading || ['INPUT', 'TEXTAREA'].indexOf(document.activeElement.tagName) > -1) {
          return;
        }
        switch (evt.key) {
          case '1':
            var threshold = new Date().getTime() - LFT_DBL_CLICK_TH;
            if (threshold > 0 && threshold <= 300) {
              clearTimeout(LFT_DBL_CLICK_TIMER);
              LFT_DBL_CLICK_TH = 0;
              seekTo(MAIN_PLAYER, MAIN_PLAYER.currentTime - 10);
            } else {
              LFT_DBL_CLICK_TH = new Date().getTime();
              LFT_DBL_CLICK_TIMER = setTimeout(() => {
                if (LFT_DBL_CLICK_TH !== 0) {
                  LFT_DBL_CLICK_TH = 0;
                }
              }, 500);
            }
            break;
          case '3':
            var threshold = new Date().getTime() - RGT_DBL_CLICK_TH;
            if (threshold > 0 && threshold <= 300) {
              clearTimeout(RGT_DBL_CLICK_TIMER);
              RGT_DBL_CLICK_TH = 0;
              seekTo(MAIN_PLAYER, MAIN_PLAYER.currentTime + 10);
            } else {
              RGT_DBL_CLICK_TH = new Date().getTime();
              RGT_DBL_CLICK_TIMER = setTimeout(() => {
                if (RGT_DBL_CLICK_TH !== 0) {
                  RGT_DBL_CLICK_TH = 0;
                }
              }, 500);
            }
            break;
          case '2':
            if (MAIN_PLAYER.playbackRate >= 4)
              return
            MAIN_PLAYER.playbackRate += 0.25;
            break;
          case '5':
            MAIN_PLAYER.playbackRate = 1;
            break;
          case '8':
            if (MAIN_PLAYER.playbackRate <= 0.5)
              return
            MAIN_PLAYER.playbackRate -= 0.25;
            break;
          case '*':
            var style = toggleRepeat(this.$router);
            const r = document.getElementById('main_repeat');
            r.className = style.classList;
            r.src = style.src;
            break;
          case '#':
            var style = toggleShuffle(this.$router);
            const s = document.getElementById('main_shuffle');
            s.className = style.classList;
            break;
        }
      },
      importPlaylist: function (input) {
        if (this.$router.bottomSheet) {
          this.$router.hideBottomSheet();
        }
        const playlistId = extractPlaylistId(input);
        if (!playlistId) {
          this.$router.showToast('Invalid playlist ID/URL');
          return;
        }
        const DB = this.$state.getState('DATABASE');
        const PLAYLIST = this.$state.getState('PLAYLIST');
        if (PLAYLIST[playlistId] != null) {
          this.$router.showToast(`Already imported, please sync ${PLAYLIST[playlistId].name}`);
          return;
        }
        this.$router.showLoading();
        getPlaylistVideos(playlistId)
        .then((remote) => {
          const result = remote.videos.map((v) => {
            v.id = v.videoId;
            v.checked = true;
            v.text = v.title;
            return v;
          });
          if (result.length === 0) {
            this.$router.showToast('Empty');
            return;
          }
          setTimeout(() => {
            this.$router.showMultiSelector(`Import Playlist(${result.length})`, result, 'Select', null, 'Save', (list) => {
              const playlist = { id: playlistId, name: remote.title || playlistId, sync: playlistId, collections: [] };
              const audio = {};
              list.forEach((i) => {
                if (!i.checked || playlist.collections.indexOf(i.id) > -1) {
                  return;
                }
                playlist.collections.push(i.id);
                if (DB[i.id] == null) {
                  audio[i.id] = {
                    id: i.id,
                    audio_title: i.title,
                    duration: false,
                    title: false,
                    artist: false,
                    album: false,
                    genre: false,
                    year: false,
                    track: false,
                    local_stream: false,
                  }
                }
              });
              if (playlist.collections.length === 0) {
                this.$router.showToast('No track selected');
                return;
              }
              this.$router.showLoading();
              persistTracks(audio)
              .then((savedCount) => {
                return T_PLAYLIST.setItem(playlistId.toString(), playlist)
                .then((savedPlaylist) => {
                  PLAYLIST[playlistId] = savedPlaylist;
                  Object.assign(DB, audio);
                  this.$state.setState('PLAYLIST', PLAYLIST);
                  this.$state.setState('DATABASE', DB);
                  this.$router.showToast(`IMPORT Success (${playlist.collections.length} tracks)`);
                });
              })
              .catch((err) => {
                console.log(err);
                this.$router.showToast('IMPORT failed: ' + errorToString(err));
              })
              .finally(() => {
                this.$router.hideLoading();
              });
            }, 'Cancel', null, () => {}, 0);
          }, 100);
        })
        .catch((err) => {
          console.log(err);
          this.$router.showToast(errorToString(err));
        })
        .finally(() => {
          this.$router.hideLoading();
        });
      }
    },
    softKeyText: { left: 'Tracklist', center: '', right: 'Menu' },
    softKeyListener: {
      left: function() {
        var tracklist = []
        TRACKLIST.forEach((t, i) => {
          t.text = `${i+1} - ${t.title || t.audio_title}`;
          t.idx = i;
          tracklist.push(t);
        });
        if (tracklist.length === 0)
          return;
        this.$router.showOptionMenu(TRACK_NAME, tracklist, 'Select', (selected) => {
          if (TRACKLIST[selected.idx]) {
            this.$state.setState('TRACKLIST_IDX', selected.idx);
            playMainAudio(selected.idx);
          }
        }, () => {}, this.$state.getState('TRACKLIST_IDX'));
      },
      center: function() {
        if (MAIN_PLAYER.duration > 0 && !MAIN_PLAYER.paused) {
          MAIN_PLAYER.pause();
          return;
        }
        if (TRACKLIST.length === 0) {
          this.$router.showToast('Tracklist is empty, add audio via Search');
          return;
        }
        MAIN_PLAY_RETRY = 0;
        if (!MAIN_PLAYER.currentSrc && !MAIN_PLAYER.src) {
          BOOT = true;
          playMainAudio(this.$state.getState('TRACKLIST_IDX'));
          return;
        }
        const p = MAIN_PLAYER.play();
        if (p && typeof p.catch === 'function') {
          p.catch((err) => {
            console.warn('play() rejected:', err && err.name);
            playMainAudio(this.$state.getState('TRACKLIST_IDX'), true);
          });
        }
      },
      right: function() {
        const menus = [
          { text: 'Search' },
          { text: 'Local Audio Database' },
          { text: 'Playlist' },
          { text: 'Import Youtube Playlist ID' },
          { text: 'Import Playlist (QR Code)' },
          { text: 'Preferred Mime' },
          { text: 'Clear Caches' },
          { text: 'Keypad Shorcuts' },
          { text: 'Settings' },
          { text: 'Invidious Instances' },
          { text: 'Exit' }
        ]
        this.$router.showOptionMenu('Menu', menus, 'Select', (selected) => {
          if (selected.text === 'Search') {
            this.$router.push('search');
          } else if (selected.text === 'Local Audio Database') {
            this.$router.push('database');
          } else if (selected.text === 'Playlist') {
            this.$router.push('playlist');
          } else if (selected.text === 'Preferred Mime') {
            const CONFIG = this.$state.getState('CONFIGURATION');
            const match = CONFIG['mimeType'];
            const opts = [
              { "text": "audio", "checked": match === "audio" },
              { "text": "audio/webm", "checked": match === "audio/webm" },
              { "text": "audio/mp4", "checked": match === "audio/mp4" }
            ];
            const idx = opts.findIndex((opt) => {
              return opt.text === match;
            });
            this.$router.showSingleSelector('Preferred Mime', opts, 'Select', (selected) => {
              T_CONFIGURATION.setItem('mimeType', selected.text)
              .then((value) => {
                CONFIG['mimeType'] = value;
                this.$state.setState('CONFIGURATION', CONFIG);
              });
            }, 'Cancel', null, undefined, idx);
          } else if (selected.text === 'Clear Caches') {
            T_CACHED_URL.clear()
            .finally(() => {
              this.$router.showToast('DONE');
            });
          } else if (selected.text === 'Settings') {
            this.$router.push('settings');
          } else if (selected.text === 'Import Youtube Playlist ID') {
            setTimeout(() => {
              textInputDialog(this, 'Import Playlist', 'Playlist ID or URL', '', (value) => {
                this.methods.importPlaylist(value);
              });
            }, 105);
          } else if (selected.text === 'Import Playlist (QR Code)') {
            if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
              setTimeout(() => {
                qrReader(this.$router, (playlistId) => {
                  if (playlistId !== null) {
                    this.methods.importPlaylist(playlistId);
                  }
                });
              }, 105);
            } else {
              this.$router.showToast('No camera on this device, use Import Youtube Playlist ID');
            }
          } else if (selected.text === 'Keypad Shorcuts') {
            this.$router.push('keypadshorcuts');
          } else if (selected.text === 'Exit') {
            window.close();
          } else if (selected.text === 'Invidious Instances') {
            this.$router.showLoading();
            getAvailableInvidiousInstance()
            .then(result => {
              let idx = 0;
              let opts = [];
              result.forEach((item, i) => {
                if (item.uri === window['_INVIDIOUS_INSTANCE_'])
                  idx = i;
                const sub = [item.region, item.uptime != null ? `uptime ${item.uptime}%` : null].filter(Boolean).join(' · ');
                opts.push({ text: item.uri, subtext: sub, checked: item.uri === window['_INVIDIOUS_INSTANCE_'] });
              });
              opts.push({ text: 'Custom instance...', subtext: 'Enter a host name', custom: true, checked: false });
              setTimeout(() => {
                this.$router.showSingleSelector('Invidious Instances', opts, 'Select', (selected) => {
                  if (selected.custom) {
                    setTimeout(() => {
                      textInputDialog(this, 'Custom Instance', 'e.g. invidious.example.com', window['_INVIDIOUS_INSTANCE_'], (value) => {
                        const host = setInvidiousInstance(value);
                        if (host) {
                          T_CACHED_URL.clear().finally(() => {
                            this.$router.showToast('Instance: ' + host);
                          });
                        } else {
                          this.$router.showToast('Invalid host');
                        }
                      });
                    }, 105);
                    return;
                  }
                  const host = setInvidiousInstance(selected.text);
                  T_CACHED_URL.clear().finally(() => {
                    this.$router.showToast('Instance: ' + host);
                  });
                }, 'Cancel', null, undefined, idx);
              }, 105);
            })
            .catch(err => {
              console.error(err);
              this.$router.showToast('Unable to load instance list');
            })
            .finally(() => {
              this.$router.hideLoading();
            });
          }
        }, () => {
          setTimeout(() => {}, 100);
        }, 0);
      }
    },
    dPadNavListener: {
      arrowUp: function() {
        volumeUp(MAIN_PLAYER, this.$router);
      },
      arrowRight: function() {
        const move = this.$state.getState('TRACKLIST_IDX') + 1;
        if (TRACKLIST[move]) {
          this.$state.setState('TRACKLIST_IDX', move);
          playMainAudio(move);
        }
      },
      arrowDown: function() {
        volumeDown(MAIN_PLAYER, this.$router);
      },
      arrowLeft: function() {
        const move = this.$state.getState('TRACKLIST_IDX') - 1;
        if (TRACKLIST[move]) {
          this.$state.setState('TRACKLIST_IDX', move);
          playMainAudio(move);
        }
      },
    },
    backKeyListener: function() {
      return false;
    }
  });

  const router = new KaiRouter({
    title: 'KaiKit',
    routes: {
      'index': {
        name: 'home',
        component: home
      },
      'search': {
        name: 'search',
        component: search
      },
      'database': {
        name: 'database',
        component: database
      },
      'playlist': {
        name: 'playlist',
        component: playlist
      },
      'settings': {
        name: 'settings',
        component: settings
      },
      'keypadshorcuts': {
        name: 'keypadshorcuts',
        component: keypadshorcuts
      },
    }
  });

  const app = new Kai({
    name: '_APP_',
    data: {},
    templateUrl: document.location.origin + '/templates/template.html',
    mounted: function() {},
    unmounted: function() {},
    router,
    state
  });

  try {
    app.mount('app');
  } catch(err) {
    console.log(err);
  }

  document.addEventListener('visibilitychange', (evt) => {
    if (document.visibilityState === 'visible') {
      if (SLEEP_TIMER != null) {
        clearTimeout(SLEEP_TIMER);
        SLEEP_TIMER = null;
      }
    } else {
      if (state.getState('AUTOSLEEP') !== false && typeof state.getState('AUTOSLEEP') === 'number' && WAKE_LOCK == null) {
        SLEEP_TIMER = setTimeout(() => {
          window.close();
        }, state.getState('AUTOSLEEP') * 60 * 1000);
      }
    }
  });
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js')
  .then(function(swReg) {
    console.log('Service Worker Registered');
  })
  .catch(function(error) {
    console.error('Service Worker Error', error);
  });
}
