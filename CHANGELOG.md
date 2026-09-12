# Changelog

Railway টেমপ্লেট-ইউজারদের জন্য: `main` ব্রাঞ্চে মার্জ হওয়া প্রতিটি রিলিজ
Railway-তে "আপডেট উপলব্ধ" নোটিফিকেশন হিসেবে যায়। নিচের ফরম্যাট ফলো করুন —
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) অনুসরণে, [SemVer](https://semver.org/)-এর সাথে।

## [Unreleased]

### Changed

- `.railway/railway.ts` env-aware হয়েছে (production ≠ preview)

## [0.3.0] — 2026-09-12 — One-Click Premium Template

### Added

- 🚂 **One-Click Railway টেমপ্লেট প্যাক**: `TEMPLATE.md` (পাবলিশ কিট + মার্কেটপ্লেস কপি + চেকলিস্ট), প্রিমিয়াম IaC কনফিগ, README-তে Deploy on Railway বাটন ব্লক
- 🧭 **গাইডেড ভ্যারিয়েবল ফর্ম**: `XTREAM_*` ভ্যারিয়েবলে description/defaultValue/isOptional মেটাডেটা — টেমপ্লেট ডিপ্লয়-ফ্লোতে ফর্ম হিসেবে দেখায়
- 🛡️ `preserveExisting` — IaC অ্যাপ্লাই ইউজারের সেট করা ভ্যালু কখনো মুছে দেয় না

### Changed

- `.railway/railway.ts`: `defineRailway((ctx) => ...)` — প্রোডাকশনে জিরো-ডাউনটাইম (overlap 20s) + পূর্ণ গ্রেসফুল শাটডাউন (draining 30s); প্রিভিউতে দ্রুততর (0s/10s)

### Fixed

- টেমপ্লেট-ফার্স্ট ডিজাইন: ক্রেডেনশিয়াল ছাড়াই ওয়ান-ক্লিক ডিপ্লয় সফল হয় (`/status` হেলথচেক সবসময় 200)

## [0.2.0] — 2026-09-12 — Railway Infrastructure as Code

### Added

- `.railway/railway.ts` — IaC স্পেক (DOCKERFILE বিল্ড, `xtream-proxy` root directory, `/status` হেলথচেক, ALWAYS রিস্টার্ট, ১ রেপ্লিকা)
- `.railway/README.md` — সম্পূর্ণ Railway ডিপ্লয় গাইড
- `.github/workflows/railway-deploy.yml` — PR-এ plan / মার্জে apply (পিন করা প্ল্যান); `RAILWAY_TOKEN` না থাকলে স্বয়ং-স্কিপ
- `package.json` + lockfile — `railway/iac` SDK (Node ≥ 22)

### Changed

- জিরো-ডাউনটাইম ডিপ্লয় (overlapSeconds) ও গ্রেসফুল শাটডাউন উইন্ডো (drainingSeconds) কনফিগ করা
- README-গুলোতে Railway সেকশন

## [0.1.0] — 2026-09-12 — Initial release

### Added

- 🚀 **Xtream All-in-One Streaming Proxy (Go)**:
  - MPEG-TS ডিরেক্ট প্রক্সি (`/ts/<id>`) — জিরো-বাফার স্ট্রিমিং পাইপ
  - HLS m3u8 রিরাইট প্রক্সি (`/hls/<id>.m3u8`) — CDN/কোয়েরি-স্ট্রিং সাপোর্ট, ক্রেডেনশিয়াল লিক-প্রুফ
  - 1-to-Many ফ্যান-আউট রেস্ট্রিমিং (`/live/<id>`) — অটো-রিকানেক্ট + স্লো-ক্লায়েন্ট প্রোটেকশন
  - লাইভ স্ট্যাটাস ড্যাশবোর্ড (`/status`)
- 🐳 Docker: মাল্টি-স্টেজ বিল্ড, নন-রুট রানটাইম, HEALTHCHECK, Compose ডেমো স্ট্যাক (`upstream-sim`)
- 🧪 CI: `go vet/test/build` + Docker স্মোক টেস্ট + Compose এন্ড-টু-এন্ড
