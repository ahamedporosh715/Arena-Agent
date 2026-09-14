# Arena-Agent

Agent workspace repository.

## 🚂 One-Click Premium Railway Template

> ⚙️ **টেমপ্লেট কোড বসানো বাকি**: Railway ড্যাশবোর্ডে টেমপ্লেট পাবলিশ করলে একটি
> কোড পাবেন — নিচের `<TEMPLATE_CODE>` সেটি দিয়ে বসান ([TEMPLATE.md](TEMPLATE.md) → ধাপ ৩)।
> বসানোর আগে বাটনটি Railway ড্যাশবোর্ড লিংকে কাজ করে।

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template/<TEMPLATE_CODE>?utm_medium=integration&utm_source=button&utm_campaign=xtream-proxy)

ওয়ান-ক্লিক ডিপ্লয়ে যা যা পাবেন:

- ⚡ ক্লিক → প্রজেক্ট + সার্ভিস + Dockerfile বিল্ড + হেলথচেক — সব অটো
- 🧭 গাইডেড ফর্মে `XTREAM_*` ক্রেডেনশিয়াল (ফাঁকা রেখেও ডিপ্লয় সফল — `/status` সবসময় 200)
- 🔁 `main`-এ মার্জ হলেই টেমপ্লেট-ইউজারদের অটো আপডেট নোটিফিকেশন ([CHANGELOG.md](CHANGELOG.md))
- 🛡️ ALWAYS রিস্টার্ট, জিরো-ডাউনটাইম ডিপ্লয়, গ্রেসফুল শাটডাউন, নন-রুট রানটাইম, env-aware কনফিগ

📦 পাবলিশ কিট ও চেকলিস্ট: [TEMPLATE.md](TEMPLATE.md) · আইএসি কনফিগ: [.railway/railway.ts](.railway/railway.ts) · ডিপ্লয় গাইড: [.railway/README.md](.railway/README.md)

## প্রজেক্টসমূহ

- [`xtream-proxy/`](xtream-proxy/) — 🚀 Xtream All-in-One Streaming Proxy (Go): MPEG-TS ডিরেক্ট প্রক্সি, HLS (m3u8) রিরাইট প্রক্সি, 1-to-Many ফ্যান-আউট রেস্ট্রিমিং, লাইভ স্ট্যাটাস ড্যাশবোর্ড এবং 🐳 Docker/Compose ডিপ্লয়মেন্ট। বিস্তারিত: [xtream-proxy/README.md](xtream-proxy/README.md)
- [`kaios-ytdlp/`](kaios-ytdlp/) — 📱 KaiOS 2.5 Browser Share activity-ভিত্তিক yt-dlp ব্যাকএন্ড + lightweight premium app UI: video+audio MP4 job queue, audio-only export, premium settings, token auth এবং Docker/Compose ডিপ্লয়। বিস্তারিত: [kaios-ytdlp/README.md](kaios-ytdlp/README.md)
- [`xtream-proxy/` + 🚂 Railway](.railway/README.md) — Railway Infrastructure as Code (IaC): এক-কমান্ড PaaS ডিপ্লয় (`.railway/railway.ts`), `/status` হেলথচেক, জিরো-ডাউনটাইম + গ্রেসফুল শাটডাউন টিউনিং, এবং CI/CD plan/apply ওয়ার্কফ্লো ([.github/workflows/railway-deploy.yml](.github/workflows/railway-deploy.yml))
