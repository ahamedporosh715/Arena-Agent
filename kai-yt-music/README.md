# YT Music (KaiOS 2.5) — fixed fork

[arma7x/kai-yt-music](https://github.com/arma7x/kai-yt-music) (v2.1.5, Unlicense)-এর
bug-fixed সংস্করণ — **v2.2.0**। KaiOS 2.5 (Gecko 48) ফিচার ফোনের জন্য YouTube অডিও
প্লেয়ার: search, local audio database, playlist import/sync, ডাউনলোড, sleep timer।

Upstream-এর সব stream/playlist backend (vid.puffyan.us, noembed, onecompiler, herokuapp,
koyeb) মরে যাওয়ায় অ্যাপটা কার্যত অচল ছিল (issue #7/#8 “playlist always Empty”, search spinner
আটকে থাকা, playback ব্যর্থ)। বিস্তারিত bug → fix তালিকা: [BUGFIX_AUDIT.md](BUGFIX_AUDIT.md)।

## কী বদলেছে (সংক্ষেপে)

- **Stream source:** Invidious REST API, user-selectable instance (persisted), স্বাস্থ্য-পরীক্ষা
  (`/api/v1/stats`) ও স্বয়ংক্রিয় fail-over; `local=true` proxied stream (Settings → Audio Source);
  last resort `/latest_version` redirect। Remote-eval signature decipher পুরোপুরি বাদ।
- **Playlist import:** ID **বা** URL টাইপ করে (`Import Youtube Playlist ID`) অথবা QR code দিয়ে;
  Invidious playlists API (pagination) → YouTube page + InnerTube continuation fallback।
  Sync এখন `videoId` দিয়ে dedupe করে, duplicate তৈরি হয় না।
- **Search:** YouTube `ytInitialData` parser (brace-matching, regex-free) + InnerTube continuation
  (client version page থেকে) → ব্যর্থ হলে Invidious `/api/v1/search`; live stream filter।
- **Robustness:** সব async path `hideLoading()` করে (KaiKit loading অবস্থায় সব key block করে),
  media error-এ bounded retry (২ বার, cache purge), object URL revoke, `.play()` rejection handle,
  KaiOS-only API (`getDeviceStorages`, `volumeManager`, `requestWakeLock`, `fastSeek`) guard।
- **KaiKit framework fixes:** Backspace-এ `ReferenceError`, keydown listener leak, unclosed
  `[tabIndex` selector, selector cancel callback crash, ইত্যাদি।
- **Tests:** 37 unit tests + jsdom end-to-end smoke test (৩ scenario), CI job `kai-yt-music`।

## চালানো / প্যাকেজ করা

অ্যাপ plain browser JS — কোনো build step নেই। KaiOS-এ install করতে
[WebIDE / gdeploy](https://github.com/arma7x/kaios-utility) দিয়ে ফোল্ডারটা push করুন, অথবা:

```bash
cd kai-yt-music
npm run package      # ../kai-yt-music-2.2.0.zip (tests/, node_modules/, docs বাদ)
```

`manifest.webapp` privileged (`systemXHR`, `device-storage:sdcard`, `video-capture`) — তাই
sideload/OmniSD দরকার, সাধারণ browser tab-এ CORS-এর জন্য বাইরের API কাজ করবে না।

## টেস্ট

```bash
cd kai-yt-music
npm install          # শুধু jsdom (devDependency)
npm run check        # node --check + manifest JSON
npm test             # unit tests (node:test, fake XMLHttpRequest, vm sandbox)
npm run test:smoke   # jsdom: fresh install / relaunch+playback / offline
```

## Settings গাইড

| Menu | কাজ |
|---|---|
| Settings → Audio Source | **Invidious** = instance-এর মাধ্যমে proxied stream (default, বেশি নির্ভরযোগ্য); **Youtube** = googlevideo direct URL (instance-এর IP-তে lock থাকায় প্রায়ই 403) |
| Invidious Instances | api.invidious.io + built-in list থেকে live instance (uptime সহ) বাছাই, বা `Custom instance…` |
| Preferred Mime | `audio` (best bitrate), `audio/mp4` (m4a, KaiOS-এ সবচেয়ে compatible), `audio/webm` (opus) |
| Clear Caches | resolved stream URL cache মুছে ফেলা (instance/mode বদলালে স্বয়ংক্রিয় হয়) |

> ⚠️ বাস্তবতা (2026): YouTube datacenter IP থেকে playback ব্যাপকভাবে throttle করে; public Invidious
> instance-গুলোর মধ্যে বর্তমানে শুধু `invidious.f5.si` API চালু রেখেছে এবং সেটাও মাঝে মাঝে
> “companion” error দেয়। Search, playlist import, library management নির্ভরযোগ্য; playback
> instance-এর অবস্থার উপর নির্ভর করে — নিজের Invidious instance চালালে সবচেয়ে ভালো ফল।

## Licence

[Unlicense](LICENSE.txt) — upstream-এর মতোই।
