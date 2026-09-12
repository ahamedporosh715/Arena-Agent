# 🚀 Xtream All-in-One Streaming Proxy (Golang)

একটি প্রোডাকশন-গ্রেড লাইভ স্ট্রিমিং প্রক্সি — **MPEG-TS ডিরেক্ট প্রক্সি**, **HLS (m3u8) রিরাইট প্রক্সি** এবং **1-to-Many ফ্যান-আউট রেস্ট্রিমিং** — সব এক সার্ভারে।

## ✨ ফিচার

- 🔁 **MPEG-TS ডিরেক্ট প্রক্সি** — জিরো-বাফার স্ট্রিমিং পাইপ, রিয়েল-টাইম ফ্লাশ
- 📺 **HLS প্রক্সি + URL রিরাইট** — m3u8-এর সব চাঙ্ক/কী URL লোকাল পাথে রিরাইট; CDN হোস্ট, সাবডিরেক্টরি ও কোয়েরি-স্ট্রিং সাপোর্ট
- 📡 **1-to-Many ফ্যান-আউট** — ১টি আপস্ট্রিম কানেকশন → N ক্লায়েন্ট (ব্যান্ডউইথ সেভিং)
- 🩹 **অটো-রিকানেক্ট** — আপস্ট্রিম ছিঁড়ে গেলে এক্সপোনেনশিয়াল ব্যাকঅফে (1s→15s) আবার সংযোগ
- ⚡ **স্লো-ক্লায়েন্ট প্রোটেকশন** — বাফার ফুল হলে স্কিপ, টানা ৬৪ চাঙ্ক স্কিপ হলে ক্লায়েন্ট কিক — বাকিদের স্ট্রিম অক্ষত
- 📊 **লাইভ ড্যাশবোর্ড** — `/status`-এ চ্যানেল/ভিউয়ার/রিলে-বাইট/রিকানেক্ট স্ট্যাটস
- 🧪 **বিল্ট-ইন সিমুলেটর** — রিয়েল Xtream সার্ভার ছাড়াই টেস্ট করার জন্য নকল আপস্ট্রিম
- 🛑 **গ্রেসফুল শাটডাউন** — SIGINT/SIGTERM-এ সব সংযোগ পরিষ্কারভাবে বন্ধ
- 🔐 **ক্রেডেনশিয়াল কোডে নয়** — env ভ্যারিয়েবল/ফ্ল্যাগ থেকে লোড হয়
- 🐳 **Docker রেডি** — মাল্টি-স্টেজ বিল্ড, নন-রুট ইউজার, হেলথচেক + এক-কমান্ড Compose ডিপ্লয়মেন্ট

## 📁 প্রজেক্ট স্ট্রাকচার

```
xtream-proxy/
├── main.go                  # এন্ট্রি পয়েন্ট, রাউটিং, গ্রেসফুল শাটডাউন
├── config.go                # ফ্ল্যাগ + env কনফিগারেশন
├── proxy.go                 # TS প্রক্সি + HLS রিরাইট + চাঙ্ক প্রক্সি
├── broadcaster.go           # 1-to-Many ফ্যান-আউট ইঞ্জিন + স্ট্যাটাস
├── proxy_test.go            # ইউনিট টেস্ট (m3u8 রিরাইট, ভ্যালিডেশন)
├── cmd/upstream-sim/main.go # টেস্টের জন্য নকল Xtream সার্ভার
├── Dockerfile               # মাল্টি-স্টেজ বিল্ড (proxy + sim টার্গেট)
├── docker-compose.yml       # এক-কমান্ড ডিপ্লয়মেন্ট + ডেমো স্ট্যাক
├── .dockerignore
├── .env.example             # কনফিগের নমুনা → কপি করে .env বানান
├── go.mod
└── README.md
```

## ⚙️ কনফিগারেশন

| ফ্ল্যাগ | Env ভ্যারিয়েবল | ডিফল্ট | বিবরণ |
|---|---|---|---|
| `-base` | `XTREAM_BASE_URL` | (খালি) | Xtream সার্ভারের বেস URL |
| `-user` | `XTREAM_USERNAME` | (খালি) | ইউজারনেম |
| `-pass` | `XTREAM_PASSWORD` | (খালি) | পাসওয়ার্ড |
| `-port` | `PORT` | `8000` | HTTP পোর্ট |

## 🎯 এন্ডপয়েন্ট

| ফিচার | URL | বিবরণ |
|---|---|---|
| **TS প্রক্সি** | `http://localhost:8000/ts/12345` | সরাসরি MPEG-TS পাইপিং |
| **HLS প্লেলিস্ট** | `http://localhost:8000/hls/12345.m3u8` | m3u8 রিরাইট + চাঙ্ক রাউটিং |
| **HLS চাঙ্ক** | `http://localhost:8000/hls/12345/1001_5.ts` | ফ্ল্যাট চাঙ্ক প্রক্সি |
| **HLS এনকোডেড URL** | `http://localhost:8000/hls/12345/u/<base64url>` | CDN/কোয়েরি-স্ট্রিং URL প্রক্সি |
| **রেস্ট্রিমিং** | `http://localhost:8000/live/12345` | ১ সোর্স → N ক্লায়েন্ট |
| **ড্যাশবোর্ড** | `http://localhost:8000/status` | লাইভ ভিউয়ার কাউন্ট ও স্ট্যাটস |

## 🏃 চালানো

```bash
cd xtream-proxy
go build -o bin/xtream-proxy .

export XTREAM_BASE_URL="http://source-server.com:8080"
export XTREAM_USERNAME="your_username"
export XTREAM_PASSWORD="your_password"

./bin/xtream-proxy             # পোর্ট 8000
./bin/xtream-proxy -port 9000  # অন্য পোর্ট
```

ভিডিও প্লেয়ারে (VLC) দিন: `http://localhost:8000/live/12345` বা `http://localhost:8000/ts/12345`

## 🐳 Docker

মাল্টি-স্টেজ বিল্ড: বিল্ড স্টেজে `golang:1.23-alpine`, রানটাইমে ছোট `alpine` — শুধু
স্ট্যাটিক বাইনারিটাই যায় (`CGO_ENABLED=0`, `-trimpath`, `-s -w`)। কনটেইনার চলে
**নন-রুট ইউজারে** এবং `/status`-এ **HEALTHCHECK** সেট করা।

```bash
cd xtream-proxy

# ইমেজ বিল্ড (ডিফল্ট টার্গেট = প্রোডাকশন প্রক্সি)
docker build -t xtream-proxy .

# রান — ক্রেডেনশিয়াল env-এ
docker run -d --name xtream-proxy -p 8000:8000 \
  -e XTREAM_BASE_URL="http://source-server.com:8080" \
  -e XTREAM_USERNAME="your_username" \
  -e XTREAM_PASSWORD="your_password" \
  xtream-proxy

curl http://localhost:8000/status        # হেলথ এন্ডপয়েন্ট
docker inspect --format '{{.State.Health.Status}}' xtream-proxy
```

### Docker Compose দিয়ে ডিপ্লয়মেন্ট

```bash
cd xtream-proxy
cp .env.example .env     # XTREAM_* ভ্যালু বসান (.env কমিট হয় না)
docker compose up -d --build

docker compose logs -f
docker compose down
```

প্রক্সি কনটেইনারের ভিতরে সবসময় পোর্ট **8000**; হোস্টের দিকের পোর্ট বদলাতে `.env`-এ
`XTREAM_HOST_PORT` সেট করুন।

### ডেমো স্ট্যাক — নকল আপস্ট্রিমসহ, রিয়েল সার্ভার ছাড়াই

`demo` প্রোফাইল `upstream-sim` (পোর্ট 9000) চালু করে আর `proxy-demo` (পোর্ট 8100)
তাকে `http://upstream-sim:9000`-এ পয়েন্ট করে — পুরো পাইপলাইন এন্ড-টু-এন্ড টেস্ট:

```bash
cd xtream-proxy
docker compose --profile demo up -d --build

curl http://localhost:8100/status                            # ড্যাশবোর্ড
curl http://localhost:8100/hls/1001.m3u8                     # রিরাইট করা প্লেলিস্ট
curl -N -m 3 http://localhost:8100/live/1001 >/dev/null      # ফ্যান-আউট স্ট্রিম

docker compose --profile demo down -v
```

| Env ভ্যারিয়েবল | ডিফল্ট | বিবরণ |
|---|---|---|
| `XTREAM_BASE_URL` | (খালি) | Xtream সার্ভারের বেস URL |
| `XTREAM_USERNAME` / `XTREAM_PASSWORD` | (খালি) | ক্রেডেনশিয়াল |
| `XTREAM_HOST_PORT` | `8000` | প্রক্সির হোস্ট পোর্ট |
| `XTREAM_DEMO_HOST_PORT` | `8100` | ডেমো প্রক্সির হোস্ট পোর্ট |
| `XTREAM_SIM_HOST_PORT` | `9000` | সিমুলেটরের হোস্ট পোর্ট |

> 🔐 `.env` ফাইলে ক্রেডেনশিয়াল রাখুন — ফাইলটি `.gitignore`-এ আছে, কমিট করবেন না।
> শুধু `.env.example` (ভ্যালু ছাড়া) কমিট হয়।
>
> ⚠️ পাবলিকলি এক্সপোজ করার আগে "নিরাপত্তা নোট" অংশটি পড়ুন — `/hls/<id>/u/<base64>`
> পাথ SSRF-প্রবণ, তাই ফায়ারওয়াল/অথেন্টিকেশনের পেছনে রাখুন।

### 🚂 Railway ডিপ্লয়মেন্ট (রেকমেন্ডেড PaaS)

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template/<TEMPLATE_CODE>?utm_medium=integration&utm_source=button&utm_campaign=xtream-proxy)

> ⚙️ ওয়ান-ক্লিক বাটন: টেমপ্লেট পাবলিশ করার পর `<TEMPLATE_CODE>` বসান
> (গাইড: [TEMPLATE.md](../TEMPLATE.md))। কমান্ড-লাইন বিকল্প:
> `railway deploy --template <CODE> --variable XTREAM_BASE_URL=http://host:8080 ...`

রিপোজিটরি রুটে **Railway Infrastructure as Code** রেডি করা আছে — এক কমান্ডে
প্রজেক্ট + সার্ভিস তৈরি হয়, Railway-টিউন করা সেটিংসহ:

```bash
npm install                    # Railway SDK (একবার)
railway login && railway link
railway config plan            # কী বদলাবে তার প্রিভিউ (নিরাপদ)
railway config apply           # ডিপ্লয়!
```

তারপর Railway ড্যাশবোর্ড → **Variables**-এ `XTREAM_BASE_URL` / `XTREAM_USERNAME` /
`XTREAM_PASSWORD` বসান — রিডিপ্লয় নিজে থেকেই হবে। Railway নিজের `PORT` env
ইনজেক্ট করে এবং `/status` হেলথচেক + SIGTERM গ্রেসফুল শাটডাউন আগে থেকেই রেলওয়ে-রেডি
— কোডে কোনো পরিবর্তন লাগেনি। ইমেজের নন-রুট ইউজার, `HEALTHCHECK` ও ছোট স্ট্যাটিক
বিল্ডও Railway-তে কাজে আসে। জিরো-ডাউনটাইম ডিপ্লয় (`overlapSeconds`) এবং পূর্ণ
গ্রেসফুল শাটডাউন (`drainingSeconds`) কনফিগ করা।

- কনফিগ ফাইল: [`.railway/railway.ts`](../.railway/railway.ts)
- সম্পূর্ণ গাইড: [`.railway/README.md`](../.railway/README.md)
- ওয়ান-ক্লিক টেমপ্লেট পাবলিশ কিট: [`TEMPLATE.md`](../TEMPLATE.md) (+ [`CHANGELOG.md`](../CHANGELOG.md) — অটো-আপডেট নোটিফিকেশনে এটিই দেখায়)
- CI/CD: [`.github/workflows/railway-deploy.yml`](../.github/workflows/railway-deploy.yml) — PR-এ plan, মার্জে apply (`RAILWAY_TOKEN` সিক্রেট লাগে)

> ℹ️ পুরনো `railway.json`/"Config as Code" Railway ডেপ্রিকেট করেছে — তাই সরাসরি
> IaC (`.railway/railway.ts`) ব্যবহার করা হয়েছে।

## 🧪 সিমুলেটর দিয়ে টেস্ট (রিয়েল সার্ভার লাগবে না)

```bash
# টার্মিনাল ১ — নকল আপস্ট্রিম
go run ./cmd/upstream-sim -port 9000

# টার্মিনাল ২ — প্রক্সি
XTREAM_BASE_URL=http://127.0.0.1:9000 XTREAM_USERNAME=test XTREAM_PASSWORD=test go run .

# টার্মিনাল ৩ — চেক
curl -N -m 3 http://localhost:8000/live/1001 >/dev/null   # ফ্যান-আউট স্ট্রিম
curl http://localhost:8000/hls/1001.m3u8                  # রিরাইট করা প্লেলিস্ট
curl http://localhost:8000/status                         # ড্যাশবোর্ড
```

ইউনিট টেস্ট: `go test ./...`

Docker দিয়ে এন্ড-টু-এন্ড (রিয়েল সার্ভারও লাগবে না):

```bash
docker compose --profile demo up -d --build
curl http://localhost:8100/status
docker compose --profile demo down -v
```

CI (`.github/workflows/ci.yml`): `go vet` + `go test` + `go build`, ইমেজ বিল্ড ও
কনটেইনার স্মোক টেস্ট, এবং কম্পোজ ডেমো স্ট্যাকের এন্ড-টু-এন্ড চেক।

## 🏗️ আর্কিটেকচার নোট

- **ফ্যান-আউট হাব**: প্রতি স্ট্রিমে একটি `StreamChannel`; প্রথম ভিউয়ার এলেই একটি সুপারভাইজার গোরুটিন আপস্ট্রিম খোলে এবং ভিউয়ার থাকা পর্যন্ত রিকানেক্ট করে চলে। শেষ ভিউয়ার গেলে আপস্ট্রিম সাথে সাথে বন্ধ।
- **স্লো ক্লায়েন্ট**: প্রতি ভিউয়ারের ২৫৬-চাঙ্ক বাফার ফুল হলে চাঙ্ক স্কিপ হয়; টানা ৬৪ স্কিপে ক্লায়েন্ট কিক — একজন ধীর দর্শক বাকিদের স্ট্রিম ভাঙতে পারে না।
- **HLS রাউটিং**: প্লেলিস্টের প্রতিটি লাইন আপস্ট্রিম m3u8-এর ইফেক্টিভ URL-এর সাথে রেজলভ করা হয়। ফ্ল্যাট ফাইল হলে ছোট পাথ (`/hls/<id>/<name>`), CDN/কোয়েরি-স্ট্রিং হলে base64url এনকোডেড পাথ (`/hls/<id>/u/<enc>`) — ফলে যেকোনো প্রোভাইডারের প্লেলিস্ট কাজ করে। `#EXT-X-KEY`/`#EXT-X-MAP`-এর `URI="..."` অ্যাট্রিবিউটও রিরাইট হয়।

## ⚡ পারফরম্যান্স টিপস

| বিষয় | সমাধান |
|---|---|
| **RAM** | 32KB চাঙ্ক রিড + সরাসরি পাইপ → প্রায় ০ বাফার |
| **CPU** | `DisableCompression: true` → সিপিইউ সেভ |
| **কানেকশন** | `MaxIdleConnsPerHost: 500` → রি-ইউজ |
| **লেটেন্সি** | `http.Flusher` → রিয়েল-টাইম ফ্লাশ |
| **ব্যান্ডউইথ** | ফ্যান-আউট → ১ সোর্স কানেকশন, N ভিউয়ার |

## 🔐 নিরাপত্তা নোট

- `/hls/<id>/u/<base64>` পাথ যেকোনো http(s) URL প্রক্সি করতে পারে — পাবলিকলি এক্সপোজ করলে SSRF ঝুঁকি; ফায়ারওয়াল/অথেন্টিকেশনের পেছনে রাখুন।
- base64 কোনো এনক্রিপশন নয় — আপস্ট্রিম URL-এর ক্রেডেনশিয়াল শুধু ক্যাজুয়াল চোখ থেকে ঢাকা থাকে।
- প্রক্সি শুধু নিজে আপস্ট্রিমে ক্রেডেনশিয়াল ব্যবহার করে; রিরাইট করা প্লেলিস্টে ক্রেডেনশিয়াল কখনো ক্লায়েন্টে যায় না (টেস্টে ভেরিফাইড)।

## 📌 রোডম্যাপ

1. ⬜ JWT টোকেন অথেন্টিকেশন
2. ⬜ Redis ক্যাশিং (m3u8 প্লেলিস্ট)
3. ✅ ~~Docker + Docker Compose ডিপ্লয়মেন্ট~~ — **সম্পন্ন**: মাল্টি-স্টেজ ইমেজ, নন-রুট রানটাইম, হেলথচেক, কম্পোজ স্ট্যাক ও CI এন্ড-টু-এন্ড টেস্ট
4. ✅ ~~Railway PaaS ডিপ্লয়মেন্ট~~ — **সম্পন্ন**: Infrastructure as Code (`.railway/railway.ts`), হেলথচেক + গ্রেসফুল শাটডাউন টিউনিং, CI/CD plan/apply ওয়ার্কফ্লো
5. ⬜ Prometheus মেট্রিক্স মনিটরিং
6. ⬜ FFmpeg ট্রান্সকোডিং পাইপলাইন
