# Deploy Fixed YT Music

## Quick Start - Backend (Fixes Songs Not Playing)

The key fix is backend proxy. Without backend, songs won't play due to CORS and signature issues.

### Local
```bash
cd kaios-ytdlp
pip install -r requirements.txt
# Install ffmpeg if not present: sudo apt-get install ffmpeg
HOST=0.0.0.0 PORT=8080 python3 server.py
```
Open http://localhost:8080/ - Fixed player ready.

### Docker (Recommended)
```bash
cd kaios-ytdlp
docker compose up -d --build
```
This builds image with yt-dlp + ffmpeg, auto-updates yt-dlp.

### Docker Compose
```yaml
version: '3.8'
services:
  kaios-ytdlp:
    build: .
    ports:
      - "8080:8080"
    environment:
      - HOST=0.0.0.0
      - PORT=8080
      - YTDLP_AUTO_UPDATE=1
      - YTDLP_UPDATE_CHANNEL=stable
    volumes:
      - ./downloads:/app/downloads
```

### Railway / Cloud
- Deploy kaios-ytdlp folder
- Set env: `HOST=0.0.0.0`, `PORT=8080`
- Healthcheck: `/status`
- Public URL will be your API base

## Frontend - KaiOS Install

### Option 1: Hosted App (KaiOS 2.5)
1. Deploy backend and get HTTPS URL (e.g., https://your-app.railway.app)
2. On KaiOS device, open Browser
3. Go to `https://your-app.railway.app/manifest.webapp`
4. It will prompt to install
5. Or bookmark `https://your-app.railway.app/`

### Option 2: Packaged App
- Use WebIDE or KaiOS simulator
- Package kai-yt-music-fixed folder
- Install via WebIDE

### Option 3: Fix Original Repo
1. Clone https://github.com/arma7x/kai-yt-music.git
2. Replace `js/yt-extractor.js` with `js/yt-extractor-fixed.js`
3. Replace `js/yt-scrapper.js` with `js/yt-scrapper-fixed.js`
4. Update `app.js`:
   - Change `getAudioStreamURL` to use backend:
```javascript
function getAudioStreamURL(id) {
  return new Promise(function(resolve, reject) {
    var xhr = new XMLHttpRequest({mozSystem: true});
    xhr.open('GET', apiBase + '/api/audio/' + id, true);
    xhr.onload = function() {
      if (this.status === 200) {
        var data = JSON.parse(this.responseText);
        if (data.ok && data.info) {
          resolve(data.info.stream_url);
        } else reject('No audio');
      } else reject('HTTP ' + this.status);
    };
    xhr.onerror = function() { reject('Network error'); };
    xhr.send();
  });
}
```
   - Fix `playMainAudio` to use backend proxy URL
   - Fix `searchVideo` to use backend `/api/search`

## Config

Edit `static/config.js` or `kai-yt-music-fixed/config.js`:
```javascript
window.APP_CONFIG = {
  apiBase: 'https://your-backend.com', // empty = same origin
  token: '', // if YTDLP_ACCESS_TOKEN set
  defaultQuality: 360,
  audioFormat: 'm4a',
  preferredMime: 'audio/mp4',
  autoplay: true,
  useBackendProxy: true // FIX: always true
};
```

## Testing Fixed Version

1. **Songs playing:**
   - Search "lofi" → should return results
   - Click result → should play via `/api/stream/{id}`
   - Check Network tab: should see 200 for `/api/audio/{id}` and `/api/stream/{id}`
   - No CORS errors

2. **Actions handling:**
   - D-pad up/down should navigate
   - Center should play/pause
   - Left/right should prev/next
   - 1/3 should rewind/forward 10s
   - */# should toggle shuffle/repeat
   - Softkeys should update on focus

3. **Playlist:**
   - Enter playlist ID (e.g., PL... ) in settings
   - Click Import Playlist
   - Should load via `/api/playlist`

4. **Server check:**
   - Settings → Server Check
   - Should show yt_dlp_found: true, ffmpeg_found: true, fixes list

## Troubleshooting

- **Songs not playing:** Check backend is running, `/status` returns 200, yt-dlp installed
- **Search not working:** Check `/api/search?q=test` returns results
- **CORS errors:** Ensure backend sends `Access-Control-Allow-Origin: *` (fixed in server.py)
- **Actions not working:** Check `data-focusable="1"` on buttons, focus management

## Env Variables

- `HOST`: bind host, default 0.0.0.0
- `PORT`: port, default 8080
- `YTDLP_BIN`: yt-dlp binary path
- `YTDLP_AUTO_UPDATE`: 1 to auto-update yt-dlp
- `DOWNLOAD_DIR`: download dir
- `YTDLP_ACCESS_TOKEN`: optional auth
- `CORS_ORIGIN`: default *

## Security Note

Use only for content you own, have permission, or licensed. No DRM bypass. No cookies by default.
