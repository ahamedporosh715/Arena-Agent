# KaiOS 2.5 + InnerTube/ytdlp Compatibility Research Audit

তারিখ: 2026-09-12

## সিদ্ধান্ত

এই build **KaiOS 2.5-only**। Target flow:

```text
KaiOS 2.5 Browser → Options → Share → Premium Downloader → Backend APIs → Final download
```

Copy-paste, ৬-ডিজিট code bridge, KaiOS 3.x `manifest.webmanifest`/`sw.js`—কিছুই নেই।

## Raw JSON design

সব API compatibility data এক raw JSON ফাইলে রাখা হয়েছে:

```text
api.raw.json
```

এতে আছে:

- InnerTube endpoints: `/search`, `/browse`, `/player`, `/next`
- InnerTube dynamic bootstrap regex: `INNERTUBE_API_KEY`, `INNERTUBE_CLIENT_VERSION`, `VISITOR_DATA`
- InnerTube client profiles: `WEB`, `WEB_EMBEDDED_PLAYER`, `ANDROID`
- Search filter params: video/channel/playlist/live/short/long
- yt-dlp common/extract/download args
- KaiOS-friendly MP4/M4A format selectors
- ffmpeg preferred container/codec notes
- backend endpoint map
- safety policy

## রিসার্চ থেকে রাখা/ফিক্স করা বিষয়

1. **KaiOS 2.5 Web Activities**
   - `manifest.webapp`-এ `activities.share` এবং `activities.view` রাখা হয়েছে।
   - `messages`-এ `{ "activity": "/index.html" }` রাখা হয়েছে।
   - Window-side handler: `navigator.mozSetMessageHandler('activity', ...)`।
   - Vendor fallback হিসেবে `share`/`view` handler try করা হয়, fail করলে ignored।

2. **Manifest completeness**
   - `version`, `subtitle`, `categories`, `icons`, `developer`, `default_locale`, `locales`, `cursor:false`, `fullscreen:true`, `orientation` আছে।
   - `/manifest.webapp` সঠিক MIME type `application/x-web-app-manifest+json` দিয়ে serve হয়।

3. **InnerTube compatibility**
   - Hard-coded weekly `WEB` clientVersion-এর ওপর নির্ভর না করে YouTube HTML থেকে runtime bootstrap করা হয়।
   - Search endpoint video/channel/all filters support করে।
   - Channel endpoint `UC...`, `@handle`, `/channel/...`, `/@handle` normalize করে।
   - Player endpoint simplified streaming info দেয়; ciphered streams/format URLs-এর জন্য yt-dlp extractor final authority।

4. **yt-dlp/ffmpeg compatibility**
   - `/api/extract` yt-dlp `--dump-single-json --skip-download` দিয়ে format/link extract করে।
   - `/api/jobs` download/merge করে।
   - MP4 video + M4A audio আগে prefer করা হয়, তারপর fallback।
   - `ffmpeg` সহ MP4 merge/remux।
   - Docker image standalone `/app/bin/yt-dlp` ব্যবহার করে যাতে `yt-dlp -U` self-update scheduler কাজ করতে পারে।

5. **Low-resource KaiOS 2.5 UI**
   - কোনো React/Vue/large framework নেই।
   - ES5-style JS + `XMLHttpRequest` ব্যবহার করা হয়েছে।
   - QVGA 240×320 screen মাথায় রেখে compact UI।
   - D-pad/softkey navigation আছে।
   - Default recommended quality 360p; 240p/480p/720p option আছে।

6. **Premium settings কিন্তু lightweight**
   - Default quality cycle
   - Audio format cycle
   - Share mode: Ask / Auto Video / Auto Audio
   - Auto metadata info
   - Poll speed: Eco / Normal / Fast
   - Server health check
   - InnerTube video/channel search
   - Search result → download link select
   - Last shared link restore + local clear
   - API base + token config
   - সব setting `localStorage`-এ; extra backend DB নেই।

## যাচাই করা কমান্ড

```bash
python3 -m json.tool api.raw.json
python3 -m json.tool static/manifest.webapp
node --check static/app.js
python3 -m py_compile server.py
python3 -m unittest discover -s tests -v
```

ফলাফল: সব unit/static checks pass।

## রেফারেন্স

- KaiOS Web Activities: https://kaios.dev/2023/02/web-activities-on-kaios/
- KaiOS manifest docs: https://developer.kaiostech.com/docs/getting-started/main-concepts/manifest/
- KaiOS complete manifest guide: https://kaios.dev/2023/03/complete-manifest.webapp-guide/
- KaiOS optimization notes: https://kaios.dev/2023/04/kaios-app-optimization-tips/
- InnerTube dynamic extraction notes: YouTube HTML commonly exposes `INNERTUBE_API_KEY` and `INNERTUBE_CLIENT_VERSION`; continuation calls use `/youtubei/v1/search`, `/browse`, `/next` with `context.client`.
- yt-dlp format/merge notes: `bestvideo+bestaudio` merge requires ffmpeg; MP4/M4A selectors are preferred for compatibility.
