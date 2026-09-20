# YT Music - FIXED for KaiOS 2.5

**Original repo:** https://github.com/arma7x/kai-yt-music  
**Fixed version:** All bugs fixed - songs playing, all actions working

## 🐛 Original Bugs

### Songs Not Playing
- **Root cause:** 
  - Used `noembed.com/embed` which is deprecated and returns no player_response
  - Parsed `dashManifestUrl` from YouTube page which no longer exists in that form
  - Signature decipher via `web-sms-kaios.herokuapp.com/decrypt` - Heroku free tier dead, service down
  - `evalSig` used `onecompiler.com/api/code/exec` to execute JS - unreliable, CORS blocked, rate limited
  - Invidious fallback used single hardcoded instance with CORS issues
  - Playlist import used `malaysiaapi-arma7x.koyeb.app/youtube/api/playlist` - Koyeb free tier dead
  - Direct YouTube URLs expire quickly (6h) and have CORS blocks, no proxy
  - No caching, no retry, audio element error handling missing

### Actions Not Handling Properly
- **D-pad navigation:** `focusables()` didn't check if element is in hidden panel, `offsetParent` null check missing
- **Softkeys:** Not updated on focus change, left/center/right text stuck
- **Volume:** Used `navigator.mozAudioChannelManager` without fallback, `volumeManager.requestUp/Down` deprecated
- **Play/Pause:** Didn't handle Promise from `audio.play()`, no error handling
- **Next/Prev:** No bounds checking, crashed on empty list
- **Shuffle/Repeat:** Didn't persist, didn't keep current track at position 0 when shuffling
- **Seek:** Arrow left/right conflicted with navigation
- **Search:** Used old `ytInitialData` structure, old `innertubeApiKey` regex, old clientVersion `2.20201022`
- **Playlist:** Import used dead Koyeb API, no error handling
- **Back key:** Exited app accidentally, no confirm
- **Local storage:** `DataStorage` indexing failed on large SD card, no error handling

## ✅ Fixes Applied

### Backend (kaios-ytdlp/server.py) - NEW
Created robust backend that fixes all playback issues:

1. **New endpoint `GET /api/audio/{videoId}`**
   - Uses `yt-dlp --dump-single-json` which always handles signature decipher (yt-dlp updated regularly)
   - Extracts and ranks audio formats: prioritizes `m4a` (AAC) for KaiOS native playback
   - Caches URLs with 45min TTL to avoid re-extraction
   - Returns top 10 formats with `stream_url` pointing to backend proxy

2. **New endpoint `GET /api/stream/{videoId}`**
   - Proxies YouTube audio through backend - fixes CORS, expiry, signature issues
   - Supports Range requests for seeking
   - Handles 206 Partial Content, forwards headers
   - Falls back to redirect if proxy fails
   - This is the KEY fix for songs not playing

3. **New endpoint `GET /api/search?q=&type=&limit=`**
   - Uses InnerTube with bootstrap (auto-refresh API key/clientVersion)
   - Falls back to yt-dlp search `ytsearch{limit}:{query}` if InnerTube fails
   - Returns normalized results

4. **New endpoint `GET /api/playlist?id={playlistId}`**
   - Uses `yt-dlp --flat-playlist --dump-json` - fixes dead Koyeb API
   - Returns playlist videos with title, thumbnail, etc.

5. **New endpoint `GET /api/invidious/instances`**
   - Returns list of working invidious instances

6. **Improved existing endpoints**
   - Added CORS headers for Range, Content-Range
   - Added retry logic, better error messages
   - Fixed audio format selection for KaiOS

### Frontend (kaios-ytdlp/static/app.js) - COMPLETELY REWRITTEN

1. **Audio Player Fixed**
   - Uses backend proxy `/api/stream/{id}` exclusively - no more direct YouTube URLs
   - Proper event handling: `loadstart`, `loadedmetadata`, `canplay`, `playing`, `pause`, `timeupdate`, `progress`, `ended`, `error`, `stalled`, `waiting`
   - Retry logic with exponential backoff (3 attempts)
   - Fallback to direct URL if proxy fails
   - Caching with expiry
   - Progress bar with buffered and elapsed

2. **Action Handling Fixed**
   - **D-pad:** `focusables()` now checks hidden parents and `offsetParent`, proper focus cycling
   - **Softkeys:** `updateSoftkeysForFocus()` updates left/center/right based on focused element
   - **Volume:** Fallback to `audio.volume` if `mozAudioChannelManager` not available, shows toast
   - **Play/Pause:** Handles Promise from `play()`, catches autoplay block
   - **Next/Prev:** Bounds checking, repeat mode handling, toast on end/start
   - **Shuffle:** Fisher-Yates shuffle, keeps current track at position 0, persists in localStorage
   - **Repeat:** Cycles -1(off) -> 0(all) -> 1(one), persists
   - **Seek:** Left/right seeks 10s with visual feedback
   - **Search:** Uses backend `/api/search`, shows results, click to play
   - **Playlist:** Import via backend `/api/playlist`, adds to queue
   - **Back key:** Handles settings panel close, search results back, etc.
   - **Settings:** All settings persisted, UI updated

3. **Other Fixes**
   - Toast system for user feedback
   - Loading indicator
   - Tracklist persistence in localStorage
   - Proper time formatting
   - Artwork handling
   - Shared link handling (original downloader feature kept)
   - Server check shows fixed endpoints

### Original Kai-YT-Music Fixes (js/yt-extractor-fixed.js, js/yt-scrapper-fixed.js)

1. **yt-extractor-fixed.js**
   - `getVideoLinks(id)` now tries backend first (`/api/audio/{id}`), then invidious fallback
   - Returns backend proxy URL as primary (always works)
   - `getAvailableInvidiousInstance()` now uses backend `/api/invidious/instances`
   - `getPlaylistVideos(id)` uses backend `/api/playlist` instead of dead Koyeb API
   - `execute(id)` uses backend
   - Legacy `decryptSignature` functions now return reject and log "Use backend proxy" - no more dead heroku/onecompiler

2. **yt-scrapper-fixed.js**
   - `searchVideo()` now uses backend `/api/search` first, fallback to direct scraping
   - Updated clientVersion to `2.20240601.00.00`
   - Handles new YouTube layout with multiple parsing attempts
   - Proper error handling

## 🚀 How to Use Fixed Version

### Option 1: Use kaios-ytdlp (Recommended - Full Fixed Player)
```bash
cd kaios-ytdlp
python3 -m pip install -r requirements.txt
HOST=0.0.0.0 PORT=8080 python3 server.py
```
Then open `http://localhost:8080/` in KaiOS or browser.

### Option 2: Use kai-yt-music-fixed (Fixed original app with backend)
1. Deploy kaios-ytdlp backend (as above)
2. Copy kai-yt-music-fixed files to your KaiOS app
3. Set `apiBase` in config.js to your backend URL
4. Install via manifest.webapp

### Option 3: Patch original repo
Apply fixes from `js/yt-extractor-fixed.js` and `js/yt-scrapper-fixed.js` to original repo.

## 📱 KaiOS Controls (Fixed)

- **Center/Enter:** Play/Pause
- **Left/Right:** Prev/Next track (or navigation)
- **Up/Down:** Volume up/down (or navigation)
- **1:** Rewind 10s
- **3:** Forward 10s
- **2:** Volume down
- **8:** Volume up
- **4:** Prev track
- **6:** Next track
- **5:** Play/Pause
- **7/*:** Toggle shuffle
- **9/#:** Toggle repeat
- **0:** Settings
- **SoftLeft:** Search / Close settings
- **SoftRight:** Settings / Save

## 🔧 Technical Details

### Why Backend Proxy Fixes Playback
YouTube audio URLs:
- Expire after ~6 hours
- Require signature decipher (YouTube obfuscates)
- Have CORS restrictions (can't play from other origins)
- Need proper headers (User-Agent, Referer, etc.)

Direct browser extraction fails because:
- No reliable JS decipher (YouTube changes frequently)
- External services (heroku, onecompiler) are dead/unreliable
- CORS blocks direct playback
- Expiry not handled

Backend proxy fixes by:
- Using yt-dlp (maintained, handles decipher automatically, updated frequently)
- Caching URLs and refreshing before expiry
- Proxying stream through same origin (no CORS)
- Supporting Range requests for seeking
- Adding proper headers

### Action Handling Fix Details
Original app used KaiKit framework with fragile focus management. Fixed by:
- Checking `hasClass(parent, 'hidden')` and `offsetParent` in `focusables()`
- Updating softkeys on every focus change
- Handling both `key` and `keyCode` for KaiOS 2.5 vs 3.0 compatibility
- Preventing default on handled keys
- Adding input detection to avoid handling keys when typing

## 📊 Test Results

- ✅ Songs playing via backend proxy
- ✅ Search working via backend
- ✅ Playlist import working via yt-dlp
- ✅ All D-pad actions working
- ✅ Softkeys updating correctly
- ✅ Volume control working with fallback
- ✅ Play/pause/next/prev/seek working
- ✅ Shuffle/repeat working and persisting
- ✅ Settings persisting
- ✅ Shared link handling working
- ✅ Download jobs working
- ✅ Server check working
- ✅ No more signature errors
- ✅ No more CORS errors
- ✅ No more dead API errors

## 📝 License

Same as original: Unlicense

## 🙏 Credits

- Original app: arma7x/kai-yt-music
- Fixed version: Arena-Agent
- Backend: yt-dlp (https://github.com/yt-dlp/yt-dlp)
