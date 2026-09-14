# 📱 Premium KaiOS 2.5 yt-dlp Backend + Share App

এটি **শুধু KaiOS 2.5** target করে বানানো lightweight hosted app + backend। Flow:

**KaiOS Browser → Options → Share → Premium Downloader → Quality/Audio select → Download**

Copy-paste, ৬-ডিজিট code bridge, KaiOS 3.x service worker—কিছুই রাখা হয়নি। KaiOS 2.5 WebActivity/MozActivity path যতটা সম্ভব clean ও stable রাখা হয়েছে।

> ⚠️ ব্যবহার নীতি: শুধু নিজের, অনুমতিপ্রাপ্ত, পাবলিক-ডোমেইন/Creative Commons বা ডাউনলোড-লাইসেন্স থাকা কনটেন্টে ব্যবহার করুন। DRM/পেওয়াল/অননুমোদিত কনটেন্ট বাইপাস করার জন্য এটি বানানো নয়; সার্ভার cookies ব্যবহার করে না।

## ✨ ফিচার

- ✅ KaiOS 2.5 share receiver: `manifest.webapp` → `activities.share` + `messages.activity`
- ✅ `navigator.mozSetMessageHandler('activity', ...)` based receive flow
- ✅ Lightweight HTML/CSS/ES5 JavaScript UI — কোনো heavy framework নেই
- ✅ D-pad focus navigation + softkey shortcuts
- ✅ `api.raw.json` — InnerTube + yt-dlp + ffmpeg + backend endpoints এক raw JSON manifest-এ
- ✅ Runtime auto reload: local `api.raw.json` বা remote `API_MANIFEST_URL`
- ✅ InnerTube runtime bootstrap: YouTube HTML থেকে API key/clientVersion auto refresh
- ✅ InnerTube video/channel search API + channel browse + player info
- ✅ yt-dlp link/format extract API + metadata resolve + download job
- ✅ Premium Settings panel:
  - Default quality: 240p / 360p / 480p / 720p
  - Audio format: m4a / mp3 / opus
  - Share mode: Ask / Auto default video / Auto audio
  - Auto Info on share
  - Poll mode: Eco / Normal / Fast
  - Server health check
  - YouTube video/channel search + result-to-link select
  - Last shared link restore + local history clear
  - API base + token config
- ✅ KaiOS-friendly default: 360p, MP4/M4A preferred format selection
- ✅ yt-dlp CLI দিয়ে metadata resolve/link extract ও download job
- ✅ Video+audio merge/remux to MP4 (`ffmpeg` দরকার)
- ✅ Audio-only export (`m4a`, `mp3`, `opus`, `ogg`, `wav` backend-supported)
- ✅ Queue/progress/status API
- ✅ Resume-friendly file serving (`Range`/`HEAD` support)
- ✅ Docker/Compose ready, non-root user, `/status` healthcheck
- ✅ Runtime download cleanup

## 📁 স্ট্রাকচার

```text
kaios-ytdlp/
├── server.py                 # stdlib HTTP API + InnerTube + yt-dlp job worker
├── api.raw.json              # raw API manifest: InnerTube + yt-dlp + ffmpeg
├── static/
│   ├── index.html             # KaiOS 2.5 share receiver UI
│   ├── app.js                 # MozActivity receiver + API client, ES5-style
│   ├── config.js              # premium deploy-time defaults
│   ├── styles.css             # compact QVGA UI
│   └── manifest.webapp        # KaiOS 2.5 hosted app manifest
├── Dockerfile
├── docker-compose.yml
├── requirements.txt           # yt-dlp CLI package
├── KAIOS_RESEARCH_AUDIT.md    # compatibility notes
├── .env.example
└── tests/
```

## 📲 KaiOS 2.5 ব্যবহার flow

1. সার্ভার deploy করুন এবং public HTTPS URL নিন।
2. KaiOS-এ app install/bookmark করুন: `https://আপনার-ডোমেইন/manifest.webapp` অথবা `https://আপনার-ডোমেইন/`।
3. KaiOS built-in Browser-এ কোনো ভিডিও page খুলুন।
4. **Options → Share → Premium Downloader** select করুন।
5. App খুলে shared link দেখাবে।
6. Softkey/number shortcut দিয়ে select করুন:
   - Left Softkey বা `1` = Info
   - `2` = 240p
   - Right Softkey বা `3` = 360p / current default quality
   - `4` = Audio-only
   - `5` = 480p
   - `7` = 720p
   - `8` = current default quality download
   - `9` = Auto mode cycle
   - `0` = Premium Settings

## 🧩 Raw JSON API manifest

সব API compatibility setting এক raw JSON ফাইলে রাখা হয়েছে:

```text
kaios-ytdlp/api.raw.json
```

এখানে আছে:

- InnerTube base URL, endpoints, bootstrap regex, clients, headers
- YouTube search filter params: video/channel/playlist/live/short/long
- yt-dlp common/extract/download args
- KaiOS-friendly MP4/M4A format selectors
- ffmpeg preferred container/codec notes
- backend endpoint map
- safety policy

Backend auto-update behavior:

- Local `api.raw.json` বদলালে server runtime-এ reload করে।
- `API_MANIFEST_URL=https://.../api.raw.json` দিলে remote raw JSON নির্দিষ্ট interval-এ reload হবে।
- InnerTube `INNERTUBE_API_KEY` ও `INNERTUBE_CLIENT_VERSION` YouTube HTML থেকে runtime-এ bootstrap/refresh হয়।
- Docker build-এ standalone `yt-dlp` থাকে, `YTDLP_AUTO_UPDATE=1` হলে interval অনুযায়ী `yt-dlp -U` চালানোর চেষ্টা করে।

## ⚙️ Premium Settings

Settings panel খুলতে `0` চাপুন অথবা **Premium Settings** button select করুন।

| Setting | কাজ |
|---|---|
| `Default quality` | Right softkey/default action কোন quality নেবে |
| `Audio format` | Audio-only output format |
| `Share mode` | Share করার পর Ask / Auto Video / Auto Audio |
| `Auto Info` | Share আসলেই metadata দেখাবে |
| `Poll` | Progress polling: Eco কম data, Fast দ্রুত update |
| `Server Check` | backend, raw API manifest, InnerTube bootstrap, yt-dlp, ffmpeg status দেখবে |
| `YT Search` | InnerTube দিয়ে video/channel search করে result link select করবে |
| `API Base` | app ও backend আলাদা হলে backend URL |
| `Token` | `YTDLP_ACCESS_TOKEN` enabled হলে |
| `Last Link` | শেষ shared link restore |
| `Clear` | local last-link/history clear |

## 🚀 লোকালি চালানো

প্রথমে `yt-dlp` ও `ffmpeg` থাকতে হবে।

```bash
cd kaios-ytdlp
python3 -m pip install -r requirements.txt
# Debian/Ubuntu হলে ffmpeg: sudo apt-get install ffmpeg
HOST=0.0.0.0 PORT=8080 python3 server.py
```

তারপর খুলুন:

- KaiOS app UI: `http://SERVER_IP:8080/`
- KaiOS 2.5 Manifest: `http://SERVER_IP:8080/manifest.webapp`
- Healthcheck: `http://SERVER_IP:8080/status`
- Dev/test fallback: `http://SERVER_IP:8080/?url=https%3A%2F%2Fexample.com%2Fvideo`

## 🐳 Docker Compose

Docker image নিজেই `yt-dlp` + `ffmpeg` ইনস্টল করে।

```bash
cd kaios-ytdlp
cp .env.example .env
# Optional token দিন:
# YTDLP_ACCESS_TOKEN=$(openssl rand -hex 24)
docker compose up -d --build
```

## 🔐 Token auth

`YTDLP_ACCESS_TOKEN` সেট করলে API protected হবে। দুইভাবে app-এ token দেওয়া যায়:

1. Runtime settings: app-এ `0` চাপুন → Token লিখুন।
2. Premium hosted build: `static/config.js`-এ token/API defaults বসান।

```js
window.APP_CONFIG = {
  apiBase: '',
  token: 'YOUR_TOKEN',
  defaultQuality: 360,
  audioFormat: 'm4a',
  autoMode: 'ask',
  autoInfo: 'off',
  pollMode: 'normal'
};
```

যদি static app আলাদা domain-এ host করেন, `apiBase`-এ backend URL দিন। Same-origin হলে খালি রাখুন।

## 📡 API

### `GET /status`

সার্ভার health ও queue summary।

### `GET /api/manifest`

Loaded raw API manifest দেখায় — `api.raw.json` local/remote source সহ।

### `POST /api/yt/search`

InnerTube search। `type`: `video`, `channel`, `all`, `playlist`, `live`, `short`, `long`।

```json
{"query":"lofi music","type":"video","limit":8}
```

### `POST /api/yt/channel`

InnerTube browse/channel lookup। `channel_id`, `handle`, `url`, অথবা `channel` দিতে পারবেন।

```json
{"handle":"@example","limit":10}
```

### `POST /api/yt/player`

InnerTube player info। Direct playable URL থাকলে `include_urls:true` দিলে দেখাবে, তবে ciphered formats-এর জন্য yt-dlp extract বেশি reliable।

```json
{"url":"https://www.youtube.com/watch?v=VIDEO_ID","include_urls":false}
```

### `POST /api/extract`

yt-dlp দিয়ে link/format extract। `include_urls:false` default; true দিলে direct format URLs response-এ থাকবে।

```json
{"url":"https://example.com/video","include_urls":false}
```

### `POST /api/resolve`

Metadata/quality info আনুন। Body-তে shared URL দিন।

```json
{"url":"https://example.com/video"}
```

### `POST /api/jobs`

Download job তৈরি।

```json
{"url":"https://example.com/video","mode":"video","max_height":360}
```

Audio-only:

```json
{"url":"https://example.com/video","mode":"audio","audio_format":"m4a"}
```

### `GET /api/jobs/{JOB_ID}`

Progress/status। Done হলে `download_url` পাবেন।

### `GET /api/files/{JOB_ID}`

Final file download। Token enabled হলে `?token=...` ব্যবহার করুন।

## ⚙️ Env config

| Env | Default | কাজ |
|---|---:|---|
| `HOST` | `0.0.0.0` | bind address |
| `PORT` | `8080` | HTTP port |
| `DOWNLOAD_DIR` | `./downloads` | output/cache directory |
| `YTDLP_ACCESS_TOKEN` | empty | optional API auth |
| `YTDLP_BIN` | `yt-dlp` / Docker: `/app/bin/yt-dlp` | yt-dlp binary path |
| `YTDLP_AUTO_UPDATE` | Docker: `1` | yt-dlp self-update scheduler |
| `YTDLP_UPDATE_CHANNEL` | `stable` | stable/nightly/master |
| `YTDLP_UPDATE_INTERVAL_SECONDS` | `43200` | yt-dlp update interval |
| `API_MANIFEST_PATH` | `./api.raw.json` | local raw API manifest |
| `API_MANIFEST_URL` | empty | remote raw JSON URL for auto reload |
| `API_MANIFEST_REFRESH_SECONDS` | `3600` | remote/local manifest refresh interval |
| `INNERTUBE_BOOTSTRAP_TTL_SECONDS` | `3600` | InnerTube key/clientVersion refresh TTL |
| `FFMPEG_LOCATION` | empty | custom ffmpeg path |
| `MAX_CONCURRENT` | `2` | একসাথে download worker |
| `METADATA_TIMEOUT_SECONDS` | `45` | metadata timeout |
| `JOB_TIMEOUT_SECONDS` | `1800` | download timeout |
| `CLEANUP_AFTER_SECONDS` | `86400` | finished files cleanup |
| `CORS_ORIGIN` | `*` | API CORS |

## 🧪 টেস্ট

```bash
cd kaios-ytdlp
python3 -m json.tool api.raw.json >/dev/null
python3 -m json.tool static/manifest.webapp >/dev/null
node --check static/app.js
python3 -m py_compile server.py
python3 -m unittest discover -s tests -v
```
