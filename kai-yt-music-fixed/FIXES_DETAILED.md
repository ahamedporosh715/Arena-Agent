# Detailed Bug Fixes - Kai YT Music

## Original Repo: https://github.com/arma7x/kai-yt-music

## 1. Songs Not Playing - Root Causes and Fixes

### Bug 1.1: noembed.com embed deprecated
**File:** `js/yt-extractor.js` line ~150
```javascript
// BROKEN:
xhr('GET', `https://noembed.com/embed?url=https://www.youtube.com/watch?v=${id}&html5=1`)
```
**Problem:** noembed.com no longer returns player_response, returns 404 or empty.
**Fix:** Use backend `/api/audio/{id}` which uses yt-dlp:
```javascript
// FIXED:
xhr('GET', api('/api/audio/' + id))
.then(res => {
  // Returns audio_formats with direct URLs and proxy URL
  return res.response.info.audio_formats;
})
```

### Bug 1.2: dashManifestUrl parsing broken
**File:** `js/yt-extractor.js` fallback function
```javascript
// BROKEN:
const start = res.response.search('dashManifestUrl');
if (start > -1) {
  const s = res.response.substring(start...).replace('dashManifestUrl":"', '');
}
```
**Problem:** YouTube changed page structure, dashManifestUrl no longer in HTML, or requires JS execution.
**Fix:** Backend yt-dlp extracts directly, no HTML parsing needed.

### Bug 1.3: Signature decipher via dead Heroku app
**File:** `js/yt-extractor.js`
```javascript
// BROKEN:
xhr('GET', 'https://web-sms-kaios.herokuapp.com/decrypt', {}, query)
```
**Problem:** Heroku free tier removed in 2022, app dead, returns 404.
**Fix:** yt-dlp handles signature decipher server-side, no external service needed.

### Bug 1.4: evalSig via onecompiler.com unreliable
**File:** `js/yt-extractor.js`
```javascript
// BROKEN:
xhr('POST', `https://onecompiler.com/api/code/exec`, data)
```
**Problem:** onecompiler.com has CORS, rate limits, requires API key, unreliable for KaiOS.
**Fix:** Removed, backend handles decipher.

### Bug 1.5: Invidious single instance CORS
**File:** `js/yt-extractor.js`
```javascript
// BROKEN:
window['_INVIDIOUS_INSTANCE_'] = single hardcoded instance
```
**Problem:** Single instance often down, CORS blocks, no fallback.
**Fix:** 
- Backend proxy `/api/stream/{id}` fixes CORS
- Multiple instances with fallback
- Backend `/api/invidious/instances` returns working list

### Bug 1.6: Playlist import via dead Koyeb API
**File:** `js/yt-extractor.js`
```javascript
// BROKEN:
xhr('GET', 'https://malaysiaapi-arma7x.koyeb.app/youtube/api/playlist', {}, {id:id})
```
**Problem:** Koyeb free tier dead, API returns 404.
**Fix:** Backend uses yt-dlp flat playlist:
```python
# FIXED in server.py:
cmd = [ytdlp_bin, "--flat-playlist", "--dump-json", "--playlist-end", str(limit), url]
```

### Bug 1.7: Direct YouTube URLs expire and CORS blocked
**Problem:** Even if you get direct URL, it expires in ~6h and has CORS.
**Fix:** Backend proxy:
```python
# FIXED: /api/stream/{id} proxies through backend
req = urllib.request.Request(audio_url, headers={
  "User-Agent": DEFAULT_USER_AGENT,
  "Referer": "https://www.youtube.com/",
})
with urllib.request.urlopen(req) as resp:
  # Stream to client with same origin, no CORS
  self.wfile.write(resp.read())
```

## 2. Actions Not Handling - Root Causes and Fixes

### Bug 2.1: D-pad navigation broken
**File:** `app.js` focusables()
```javascript
// BROKEN:
function focusables() {
  var ids = ['infoBtn', 'q240', ...];
  var out = [];
  ids.forEach(function(id) { var el = $(id); if (el) out.push(el); });
  return out;
}
```
**Problem:** Doesn't check if element is in hidden panel, returns hidden elements, focus jumps to invisible.
**Fix:**
```javascript
// FIXED:
function focusables() {
  var all = document.querySelectorAll('[data-focusable="1"]');
  var visible = [];
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
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
```

### Bug 2.2: Softkeys not updating
**Problem:** Left/center/right softkey text stuck, not updated on focus change.
**Fix:**
```javascript
function updateSoftkeysForFocus(el) {
  if (!el) return;
  var id = el.id || '';
  if (id === 'playBtn') {
    leftSoftkey.textContent = 'Prev';
    centerSoftkey.textContent = isPlaying ? 'Pause' : 'Play';
    rightSoftkey.textContent = 'Next';
  } else if (id.indexOf('search') === 0) {
    leftSoftkey.textContent = 'Clear';
    centerSoftkey.textContent = 'Search';
    rightSoftkey.textContent = 'Type';
  }
  // ... etc
}
```

### Bug 2.3: Volume control broken
**File:** `app.js` volumeUp/Down
```javascript
// BROKEN:
function volumeUp(PLYR, $router, cb) {
  if (navigator.mozAudioChannelManager) {
    navigator.volumeManager.requestUp();
  } else {
    if (PLYR.volume < 1) {
      PLYR.volume = parseFloat((PLYR.volume + DEFAULT_VOLUME).toFixed(2));
    }
  }
}
```
**Problem:** `mozAudioChannelManager` deprecated, `volumeManager.requestUp` not available on KaiOS 3, no feedback, no fallback UI.
**Fix:**
```javascript
function volumeUp() {
  if (navigator.mozAudioChannelManager) {
    try { navigator.volumeManager.requestUp(); } catch(e) {}
  } else {
    audioPlayer.volume = Math.min(1, audioPlayer.volume + 0.05);
    updateVolumeUI();
    showToast('Volume ' + Math.round(audioPlayer.volume * 100) + '%');
  }
}
```

### Bug 2.4: Play/pause not handling Promise
**Problem:** `audio.play()` returns Promise in modern browsers, if autoplay blocked it rejects and crashes.
**Fix:**
```javascript
var playPromise = audioPlayer.play();
if (playPromise && playPromise.catch) {
  playPromise.catch(function(err) {
    console.log('Autoplay blocked:', err);
    trackStatus.textContent = 'Tap Play to start';
  });
}
```

### Bug 2.5: Next/prev no bounds checking
**Problem:** Crashed when at end of list, no repeat handling.
**Fix:**
```javascript
function playNext() {
  if (tracklist.length === 0) { showToast('No tracks'); return; }
  var next = currentTrackIndex + 1;
  if (next >= tracklist.length) {
    if (repeatMode === 0) next = 0;
    else { showToast('End of list'); return; }
  }
  playTrack(next);
}
```

### Bug 2.6: Shuffle not keeping current track
**Problem:** Shuffle lost current track position.
**Fix:** Fisher-Yates shuffle but keep current at 0:
```javascript
var currentId = tracklist[currentTrackIndex].video_id;
for (var i = tracklist.length - 1; i > 0; i--) {
  var j = Math.floor(Math.random() * (i + 1));
  var temp = tracklist[i]; tracklist[i] = tracklist[j]; tracklist[j] = temp;
}
// Move current to first
var curIdx = tracklist.findIndex(t => t.video_id === currentId);
if (curIdx > 0) {
  var curTrack = tracklist[curIdx];
  tracklist.splice(curIdx, 1);
  tracklist.unshift(curTrack);
  currentTrackIndex = 0;
}
```

### Bug 2.7: Search using old YouTube structure
**File:** `js/yt-scrapper.js`
```javascript
// BROKEN:
json["key"] = data.response.match(/"innertubeApiKey":"([^"]*)/)[1];
const start = data.response.search(`var ytInitialData = `);
```
**Problem:** YouTube changed to new layout, regex fails, ytInitialData moved.
**Fix:** Use backend search first:
```javascript
// FIXED:
var xhr = new XMLHttpRequest();
xhr.open('GET', api('/api/search?q=' + encodeURIComponent(query)), true);
xhr.onload = function() {
  if (this.status >= 200) {
    var data = JSON.parse(this.responseText);
    if (data.ok && data.results) {
      // Use backend results
      json.results = data.results.items.map(...);
      resolve(json);
      return;
    }
  }
  // Fallback to direct scraping with updated parsing
  fallbackSearch(...);
};
```

### Bug 2.8: Back key exits app
**Problem:** Back key always exited, no handling for settings panel, search results.
**Fix:**
```javascript
if (key === 'Backspace' || key === 'Back') {
  if (!hasClass(settingsPanel, 'hidden')) {
    toggleSettings();
    e.preventDefault();
    return;
  }
  if (document.activeElement.parentElement === searchResultsEl) {
    searchInput.focus();
    e.preventDefault();
    return;
  }
}
```

## 3. Other Fixes

- **Audio URL caching:** Added 45min TTL cache to avoid re-extraction
- **Retry logic:** 3 retries with exponential backoff
- **Progress bar:** Fixed to show buffered and elapsed
- **Tracklist persistence:** Save to localStorage every 5s
- **CORS:** Added headers for Range, Content-Range, Accept-Ranges
- **Range support:** Added for seeking
- **Toast system:** User feedback for all actions
- **Loading indicator:** For all async operations

## 4. Testing

All fixes tested:
- ✅ Songs play via backend proxy
- ✅ No CORS errors
- ✅ No signature errors
- ✅ Search works
- ✅ Playlist import works
- ✅ D-pad navigation works
- ✅ Softkeys update
- ✅ Volume control works
- ✅ Play/pause/next/prev/seek works
- ✅ Shuffle/repeat works and persists
- ✅ Settings persist
- ✅ Shared link works
- ✅ Download works
- ✅ Server check works
