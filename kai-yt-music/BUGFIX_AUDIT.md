# kai-yt-music — Bug Audit & Fix Log (2026-09-20)

উৎস: <https://github.com/arma7x/kai-yt-music> (upstream HEAD `342cdfc`, v2.1.5, Unlicense).
এই ডকুমেন্টে প্রতিটি bug → root cause → fix, আর যেসব external endpoint-এর উপর
অ্যাপটা নির্ভর করত তাদের বর্তমান অবস্থা লেখা আছে। Verification: `npm run check`,
`npm test` (37 unit tests), `npm run test:smoke` (jsdom-এ পুরো অ্যাপ, ৩টা scenario)।

> সীমাবদ্ধতা: আসল KaiOS ডিভাইসে (Gecko 48) চালিয়ে দেখা যায়নি — sandbox-এ device নেই।
> Gecko-specific API (`mozSystem` XHR, `navigator.getDeviceStorages`, `volumeManager`,
> `fastSeek`) সব guard করা হয়েছে যাতে desktop/jsdom-এও অ্যাপ crash না করে।

---

## 1. External endpoint reality check (upstream যেগুলোর উপর নির্ভর করত)

| Endpoint / service | Upstream ব্যবহার | অবস্থা (2026-09) | সিদ্ধান্ত |
|---|---|---|---|
| `vid.puffyan.us` (default Invidious) | stream + playlist | **বন্ধ** (2024) | default → `invidious.f5.si`, stored instance restore + failover |
| `noembed.com/embed?url=…` | `execute()` — `player_response` আশা করত | oEmbed only, কখনোই `player_response` দেয়নি → সবসময় throw | সরানো হয়েছে |
| `onecompiler.com/api/code/exec` | signature decipher (remote JS eval) | third-party, unreliable, player-JS marker গুলো obsolete | সরানো হয়েছে |
| `web-sms-kaios.herokuapp.com/decrypt` | legacy decipher | Heroku free tier বন্ধ (2022) | সরানো হয়েছে |
| `malaysiaapi-arma7x.koyeb.app/youtube/playlist` | playlist import (PR #6) | dead → issue #7/#8 “always Empty” | সরানো, Invidious playlists API ফিরিয়ে আনা (arma7x-এর 59aeb54 fix, যা PR #6 revert করেছিল) |
| `youtube.com/watch?v=` HTML scrape (`;var meta = …` delimiter) | `fallback()` | delimiter আর নেই; playback-এর জন্য PO token লাগে (2025+) | playback scrape বাদ; `ytInitialData` regex-free brace-matching parser শুধু search/playlist-এ |
| `youtube.com/results` + `youtubei/v1/search` | search + next page | কাজ করে (consent/bot-wall হলে ব্যর্থ) | রাখা হয়েছে, client version page থেকে extract, Invidious `/api/v1/search` fallback |
| `api.invidious.io/instances.json` | instance list | কাজ করে; shape `[name, {api, type, monitor…}]`; **শুধু `invidious.f5.si` এর `api: true`** | নতুন shape parse, `api:false`/`down` বাদ, `/api/v1/stats` probe |
| Invidious `/api/v1/videos/:id?local=true` | — (upstream `local` ছাড়া host replace করত) | `invidious.f5.si` মাঝে মাঝে companion error দেয় (`{"error": …}`) | error JSON → reject → পরের instance; `local=true` proxied stream |
| Invidious `/latest_version?id=&itag=&local=true` | — | 302 → playable stream | last-resort URL (`<audio>` নিজে redirect follow করে) |

**বাস্তবতা:** YouTube 2025 থেকে datacenter IP-তে stream throttle/403 করে; `api.invidious.io`-এর
playback stats অনুযায়ী অনেক instance-এ success ratio ~0। অ্যাপ এখন যা করা সম্ভব সবটাই করে
(failover, proxied URL, `latest_version`, error retry, স্পষ্ট toast) — কিন্তু stream আসলে বাজবে কিনা
সেটা instance-এর উপর নির্ভর করে। Search / playlist import / library — এগুলো নির্ভরযোগ্যভাবে কাজ করে।

---

## 2. `js/yt-extractor.js` (পুরো rewrite)

| # | Bug (upstream) | Fix |
|---|---|---|
| E1 | `_INVIDIOUS_INSTANCE_` hardcoded `vid.puffyan.us` (dead); menu-তে সিলেক্ট করা instance `localStorage`-এ লিখত কিন্তু boot-এ কখনো পড়ত না | boot-এ `localStorage._INVIDIOUS_INSTANCE_` restore, default `invidious.f5.si`, `setInvidiousInstance()` API |
| E2 | `xhr()` timeout `setTimeout` দিয়ে reject করত কিন্তু request abort হত না; `data={}` হলে POST-এ body যেত না (InnerTube continuation সবসময় fail); URL-এ trailing `?`; non-2xx resolve হত | `xhttp.timeout` + `ontimeout`, object body → JSON + `Content-Type`, `URL.searchParams`, non-2xx → reject `{raw,response,status}` |
| E3 | `parse_str` `.replace('+',' ')` শুধু প্রথম `+` বদলাত | `/\+/g` + `decodeURIComponent` guard |
| E4 | `decryptSignatureV2`: `document.body.length` (undefined → NaN), onecompiler remote eval, brittle marker | সরানো — Invidious format-এ signatureCipher থাকে না |
| E5 | `fallbackV2` blocking `alert()`; Invidious `{error:"…"}` JSON-কে success ধরত → `adaptiveFormats` undefined → TypeError | `invidiousGet` `response.error` → reject; `withInstanceFailover()` পরের instance চেষ্টা করে; কোনো `alert` নেই |
| E6 | `getVideoLinks` host replace (`p.host = instance`) → googlevideo URL instance-এর IP-তে lock থাকায় 403 | `?local=true` (instance proxy) যখন Audio Source = Invidious; direct mode-এ `local=false` |
| E7 | Invidious `adaptiveFormats` shape (`type`, string `bitrate`) map করা হত না | `formatFromInvidious()` → `{mimeType, codecs, bitrate, url, container, audioQuality, muxed, instance, local}`; audio-only না থাকলে muxed itag 18 → `audio/mp4` fallback |
| E8 | `getPlaylistVideos` dead API + `publishedAt` sort; issue #5/#7/#8 “Empty” | Invidious `/api/v1/playlists/:id?page=N` pagination (videoCount পর্যন্ত), YouTube playlist page + `youtubei/v1/browse` continuation fallback; খালি list + `videoCount>0` → পরের instance; `{id,title,videos,source}` resolve |
| E9 | Playlist ID শুধু bare ID | `extractPlaylistId()` — URL (`list=`), music.youtube, Invidious URL, whitespace |
| E10 | Live stream-এর জন্য format নেই → confusing error | `liveNow` → `'Live streams are not supported'` |
| E11 | কোনো last-resort নেই | `getLatestVersionURL(id, itag=140)` (`/latest_version?local=true`) |
| E12 | error object → `[object Object]` toast | `errorToString()` |

## 3. `js/yt-scrapper.js` (rewrite, একই result shape)

| # | Bug | Fix |
|---|---|---|
| S1 | implicit global `sectionLists` | `const` |
| S2 | `json.key` regex null → TypeError; `start === -1` → promise কখনো settle হয় না (loading spinner চিরকাল, KaiKit সব key block করে) | `extractInitialData()` brace-matching parser, না পেলে reject → Invidious fallback |
| S3 | clientVersion `2.20201022.01.01` hardcoded (2020) | page থেকে `INNERTUBE_CLIENT_VERSION`/`API_KEY`/`VISITOR_DATA`, fallback `2.20250312.04.00` |
| S4 | `renderer.ownerText`, `data.contents` undefined → crash | null-safe (`ownerText`/`shortBylineText`/`longBylineText`), `runsToText` |
| S5 | live/upcoming item → playable ধরে নিত | filter |
| S6 | `shelfRenderer` (“People also watched”) parse হত না | parse |
| S7 | next page: `searchVideo("", key, token)` legacy signature | back-compat + নতুন `json.continuation` object (`youtube`/`invidious` type) |
| S8 | YouTube একেবারে fail করলে কিছুই নেই | `invidiousSearch(q, page)` — Invidious result → একই `{video, uploader}` shape |

## 4. `js/utils.js`

| # | Bug | Fix |
|---|---|---|
| U1 | `checkDomainAvailability`: খালি list → `result` TDZ `ReferenceError` | early callback |
| U2 | `getInstance` পুরনো instances.json shape; `api:false`/down instance দেখাত; `console.clear()` | নতুন shape, `type==='https' && api!==false && !monitor.down`, uptime desc |
| U3 | availability check শুধু landing page (HTML দিলেই “up”) | `/api/v1/stats` JSON probe, top-10 → `localStorage._INVIDIOUS_AVAILABLE_` (failover candidate) |
| U4 | `readableFileSize` non-numeric → `false` (UI-তে “false”) | `'0 Byte'`; numeric string ok |
| U5 | `convertTime(NaN/undefined)` → `NaN:NaN` | `'00:00'`; `"m:ss"` string pass-through |
| U6 | MIME map-এ `audio/mp4`→`m4a`, `audio/webm`, `video/mp4` ছিল না → download extension ভুল | যোগ করা |

## 5. `js/datastorage.js`

| # | Bug | Fix |
|---|---|---|
| D1 | `navigator.getDeviceStorages` না থাকলে script load-এই TypeError → পুরো অ্যাপ dead | `deviceStorageApi()` detection, `AVAILABLE` flag, সব method `Storage not available` reject |
| D2 | `enumerate` recursion-এ `cards` বদলে global `SDCARDS` | `cards` |
| D3 | cursor `result.name === null` হলে `continue()` কল হত না → enumeration hang | সবসময় `continue()` |
| D4 | `newFolder` `onsuccess/onerror` storage object-এ বসাত, request-এ নয় → promise কখনো settle হয় না | request-এ handler |
| D5 | `getFile`/`addFile`/`copyFile`/`deleteFile`/`copyFolder`/`deleteFolder` — `getSDCard()` undefined হলে TypeError | guard + reject |
| D6 | `indexingStorage` `onReady(true)` দুইবার | একবার |
| D7 | deleted-event: registry/group `splice(indexOf)` — `-1` হলে শেষ item মুছে যেত | index guard |
| D8 | `groupByType` খালি list → callback কখনো নয়; getFile error → counter আটকে যেত | দুটোই handle |

## 6. `app.js`

| # | Bug | Fix |
|---|---|---|
| A1 | `getAudioStreamURL`: preferred mime match না হলে `obj` null → TypeError | `pickAudioFormat()` (mime fallback) → না থাকলে reject `'No audio stream'`; cipher path সরানো |
| A2 | `playMainAudioFallback`: stream fail হলে শুধু `console.log` | `getLatestVersionURL()` last resort, না হলে toast |
| A3 | Object URL কখনো revoke হত না (memory leak); `.play()` promise rejection unhandled | `setMainPlayerSource()` — revoke + `.play().catch` |
| A4 | `home.onerror`: `evt.target.error` null হলে TypeError; ভুল icon path `/icons/play.png`; সীমাহীন error→retry loop | null-safe, সঠিক icon, `MAX_PLAY_RETRY=2` (re-armed by new track / `loadedmetadata` / play key), cache purge, স্পষ্ট toast |
| A5 | `home.onratechange` `this.$router.stack.bottomSheet` (undefined) | `this.$router.bottomSheet` |
| A6 | Keypad shortcuts (1/2/3/5/8/*/#) dialog/input-এর ভিতরেও fire করত | bottomSheet/loading/input focus হলে ignore |
| A7 | Menu-তে “Disable Equalizer” → `changeEqStatus` undefined → ReferenceError | branch সরানো |
| A8 | Invidious instance menu: `_INVIDIOUS_INSTANCE_` কেবল localStorage-এ; custom instance দেওয়া যেত না | `setInvidiousInstance()`, uptime subtext, “Custom instance…” text prompt, URL cache clear |
| A9 | Settings: `INVIDIOUS` toggle `data['AUTOPLAY'] != null` (copy-paste); softkey text legacy index 2/3 (“Clear/SET/Show”, item নেই) | `data['INVIDIOUS']`, `setInvidiousProxy()`, TOGGLE/SELECT |
| A10 | Cached stream URL proxied/direct mode মনে রাখত না → mode বদলালে ভুল URL; expiry margin নেই | `local` flag + 60s margin |
| A11 | Playlist import শুধু QR camera; `result.forEach` (নতুন shape নয়); নাম = ID | text prompt (ID/URL), QR আলাদা entry, `remote.title`, `Already imported` guard, `persistTracks()` (Promise.all) |
| A12 | Sync: `_selected.collections.indexOf(v.id)` — API item-এ `id` নেই → সব track আবার যোগ (duplicate); `'No track selected'` চেক ভুল; `DB[v]` undefined হলে Tracklist crash | `videoId` dedupe, `added` counter, guards, `.catch` toast |
| A13 | `audioMetadataEditor` Track field `metadata.year`-এ লিখত | `metadata.track` |
| A14 | `database.dbStateListener` index −1 → `Object.assign(undefined)`; `backKeyListener` `perPage = 9` (আসল 50); `cur[['local_stream']]` | guards, 50, সঠিক key |
| A15 | “Remove Audio”: ফাইল আগে থেকে না থাকলে DB reference stale থেকে যেত | delete fail হলেও detach |
| A16 | `downloadAudio`: 403/HTML response “SUCCESS”; `Content-Length` নেই → NaN speed; promise কখনো reject/resolve নয়; `requestWakeLock` নেই → crash; storage নেই → crash | status/size check, `elapsed` guard, resolve on failure, wakeLock/DS guards, sheet বন্ধ হলে abort |
| A17 | `qrReader`: getUserMedia fail → unmounted-এ `srcObject.getTracks` TypeError; callback প্রতি সেকেন্ডে বারবার; Cancel key নেই | guards, single-shot, `Cancel` softkey, camera না থাকলে toast |
| A18 | `miniPlayer`: seeking `showLoading` → error হলে overlay আটকে থাকত; `fastSeek` Chromium-এ নেই | `hideLoading` on error, `seekTo()` helper |
| A19 | Boot: প্রতি track-এ `state.setState('DATABASE')` (O(n²) re-render); `T_PLAYLIST` load শেষে state set নয়; invalid record crash | batch set, validation |
| A20 | `playDefaultPlaylist`/`playPlaylistById` খালি হলেও `playMainAudio(0)`; `shuffling()` current track না থাকলে TypeError | guards |
| A21 | `localforage.setDriver(INDEXEDDB)` reject হলে default instance চিরতরে dead (unhandled rejection) | `[INDEXEDDB, LOCALSTORAGE]` + catch |
| A22 | `playlistEditor(this, '', Date.now())` → নতুন playlist-এ dialog title “Edit Playlist” | `null` → “Add Playlist” |
| A23 | `navigator.volumeManager`/`mozAudioChannelManager` guard অসম্পূর্ণ | `hasVolumeManager()` |
| A24 | Home play key: tracklist খালি/src নেই → `play()` NotSupportedError | toast / lazy load |
| A25 | `Service Worker Registered` `console.error` | `console.log` |

## 7. KaiKit (bundled framework)

| # | Bug | Fix |
|---|---|---|
| K1 | `handleLocalKeydown`: `e.preventDefault()` — `e` undefined (param `evt`) → Backspace-এ ReferenceError | `evt` |
| K2 | `removeKeydownListener` listener remove না করে নতুন `stopPropagation` listener **add** করত → প্রতি unmount-এ leak, key block | bound reference রেখে `removeEventListener` |
| K3 | `for (f in …)` implicit global ×4 | `var f` |
| K4 | `render()`: `verticalNavIndex >= listNav.length` হলে `cur.focus()` TypeError (list ছোট হলে) | clamp |
| K5 | `handleClick`: text node target-এ `attributes` undefined | guard |
| K6 | `querySelectorAll("[tabIndex")` (unclosed selector, ৬ জায়গায়) — Gecko tolerate করে, spec-strict engine-এ SyntaxError | `"[tabIndex]"` |
| K7 | single/multi selector cancel: `cancelCb(data)` — `data` undefined → ReferenceError | `cancelCb(this.data)` |
| K8 | multi selector `findIndex(text===)` — একই title দুটো item হলে ভুলটা toggle হত | index-based |
| K9 | `selectText.toUpperCase()` — undefined হলে crash | `(selectText || 'SELECT')` |
| K10 | router `hideBottomSheet`/`onInputFocus`/`onInputBlur` stack খালি হলে TypeError | guards |

## 8. অন্যান্য

| ফাইল | Fix |
|---|---|
| `sw.js` | `.then(self.skipWaiting())` (তৎক্ষণাৎ call) → `.then(() => self.skipWaiting())`; non-200/opaque response cache নয়; cache name bump |
| `templates/home.html` | `width="15xp"` ×6 → `15px` |
| `templates/search.html` | `padding:right:5px` → `padding-right:5px` |
| `templates/downloaderPopup.html` | `justify-content:evenly` → `space-evenly` |
| `index.html` | script order: `yt-extractor.js` (shared helpers) আগে; unused `deparam.umd.js`/`x2js.js` বাদ |
| `manifest.webapp` | version `2.2.0` |

## 9. Verification

```
npm run check        # node --check সব JS + manifest JSON
npm test             # 37 unit tests (fake XHR, vm sandbox)
npm run test:smoke   # jsdom: fresh install → import/DB/mini player/sync/search/instances;
                     #        relaunch → boot playback with failover, bounded media-error retry, sync delta;
                     #        offline → readable toasts, no stuck loading overlay
```
