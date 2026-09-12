# 🚂 One-Click Premium Railway Template — Publish Kit

এই রিপোজিটরিতে **Railway টেমপ্লেটের জন্য প্রিমিয়াম ডিপ্লয় প্যাক** রেডি করা আছে —
শুধু Railway ড্যাশবোর্ডে ২–৩ মিনিটের পাবলিশ স্টেপটি করে নিলেই এটি
**ওয়ান-ক্লিক ডিপ্লয়যোগ্য টেমপ্লেট** হয়ে যায় (মার্কেটপ্লেস + "Deploy on Railway" বাটন)।

টেমপ্লেট যা যা দেয় (প্রতি ডিপ্লয়ারকে):

- ⚡ **ওয়ান-ক্লিক ডিপ্লয়** — `railway.com/new/template/<CODE>` লিংক/বাটনে ক্লিক
  করলেই প্রজেক্ট + সার্ভিস তৈরি, Dockerfile বিল্ড, হেলথচেক চালু
- 🧭 **গাইডেড সেটআপ ফর্ম** — ডিপ্লয়ের সময় Railway `XTREAM_BASE_URL` /
  `XTREAM_USERNAME` / `XTREAM_PASSWORD`-এর জন্য description-সহ ফর্ম দেখায়
  (ফাঁকা রেখেও ডিপ্লয় চলে — `/status` হেলথচেক ক্রেডেনশিয়াল ছাড়াই 200)
- 🔁 **অটো-আপডেট** — `main` ব্রাঞ্চে মার্জ হলেই Railway টেমপ্লেট-ইউজারদের
  "আপডেট উপলব্ধ" নোটিফিকেশন দেখায় (অপ্ট-ইন) — সাথে রাখুন [`CHANGELOG.md`](CHANGELOG.md)
- 🛡️ **প্রোডাকশন-গ্রেড ডিফল্ট** — ALWAYS রিস্টার্ট, ১ রেপ্লিকা (ফ্যান-আউট হাব),
  জিরো-ডাউনটাইম ডিপ্লয় (overlap 20s), গ্রেসফুল শাটডাউন (draining 30s),
  নন-রুট রানটাইম, স্ট্যাটিক Go বাইনারি
- 🌍 **Env-aware কনফিগ** — প্রোডাকশন ≠ প্রিভিউ/PR এনভায়রনমেন্ট (`.railway/railway.ts`)

---

## 🪜 ধাপ ১ — Railway-তে প্রজেক্ট তৈরি ও টেমপ্লেট তৈরি

1. **GitHub থেকে ডিপ্লয়**: Railway ড্যাশবোর্ড → `New Project` → `Deploy from
   GitHub repo` → `ahamedporosh715/Arena-Agent` বেছে নিন।
2. সার্ভিস সেটিংসে **Root Directory = `xtream-proxy`** দিন (Railway নিজেই
   `xtream-proxy/Dockerfile` ডিটেক্ট করবে)।
3. **Settings → Networking → Healthcheck Path** = `/status` (Timeout 180) —
   `.railway/railway.ts`-এর IaC সেটিংসও এটিই মিরর করে; IaC-টাই না করলেও চলবে।
4. **Variables**-এ `XTREAM_BASE_URL` / `XTREAM_USERNAME` / `XTREAM_PASSWORD`
   ফাঁকা প্লেসহোল্ডার হিসেবে রেখে দিন (আসল সিক্রেট নয়!) — এগুলোই টেমপ্লেটের
   ডিফল্ট হয়ে যাবে এবং ডিপ্লয়-ফর্মে দেখাবে।
5. সার্ভিস রান হয়ে `/status` 200 দিলে প্রজেক্ট → **`...` মেনু → Create Template**।
   (কিংবা Workspace Settings → Templates থেকে Create।)

## 🎨 ধাপ ২ — পাবলিশ ফর্ম (মার্কেটপ্লেস কপি)

টেমপ্লেট তৈরির পর **Publish** বাটনে ক্লিক করে নিচের কপি ব্যবহার করুন:

| ফিল্ড | সাজেশন |
|---|---|
| **নাম** | `Xtream Streaming Proxy` |
| **ট্যাগলাইন** | `Xtream IPTV-র জন্য All-in-One স্ট্রিমিং প্রক্সি — এক ক্লিকে ডিপ্লয়` |
| **ক্যাটাগরি** | Streaming / Media |
| **আইকন** | Go: `https://devicons.railway.com/i/go.svg` (Gin টেমপ্লেটের মতো) |
| **ডেমো প্রজেক্ট** | পাবলিশের পর নিজের চলমান ডিপ্লয়টা ডেমো হিসেবে যোগ করুন (মার্কেটপ্লেসে "Live Demo" বাটন) |

**Description:**

> One-click deployable MPEG-TS + HLS streaming proxy for Xtream servers.
> Direct TS piping, m3u8 URL rewriting (credentials never leak to clients),
> 1-to-Many fan-out restreaming with auto-reconnect & slow-client protection,
> and a live `/status` dashboard. Multi-stage Go build, non-root runtime,
> zero-downtime deploys, graceful shutdown. Fill in your Xtream credentials
> at deploy time (or later in Variables) — deploy succeeds instantly either way.

পাবলিশ হয়ে গেলেই একটি **টেমপ্লেট কোড** পাবেন (যেমন `ZweBXA`) — এটিই ওয়ান-ক্লিক লিংক:

```
https://railway.com/new/template/<TEMPLATE_CODE>?utm_medium=integration&utm_source=button&utm_campaign=xtream-proxy
```

## 🔘 ধাপ ৩ — "Deploy on Railway" বাটন বসানো

README-তে (রিপো রুট ও `xtream-proxy/README.md`-তে বাটন ব্লক রেডি আছে — কোডটা
বসালেই হয়ে যাবে):

**Markdown:**

```markdown
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template/<TEMPLATE_CODE>?utm_medium=integration&utm_source=button&utm_campaign=xtream-proxy)
```

**HTML (ওয়েবসাইটে এমবেড):**

```html
<a href="https://railway.com/new/template/<TEMPLATE_CODE>?utm_medium=integration&utm_source=button&utm_campaign=xtream-proxy">
  <img src="https://railway.com/button.svg" alt="Deploy on Railway"/>
</a>
```

`utm_campaign=xtream-proxy` রাখলে ট্র্যাফিক অ্যাট্রিবিউশন/কিকব্যাকে টেমপ্লেট-নাম ট্র্যাক হয়।

## ✅ পাবলিশ চেকলিস্ট

- [ ] `main` ব্রাঞ্চে এই ফাইলগুলো আছে: `.railway/railway.ts`, `xtream-proxy/Dockerfile`
- [ ] টেমপ্লেট প্রজেক্টে XTREAM_* ভ্যারিয়েবল **ফাঁকা প্লেসহোল্ডার** (কোনো রিয়েল সিক্রেট নয়)
- [ ] মার্কেটপ্লেস কপি (উপরের) পূরণ করা
- [ ] টেমপ্লেট কোড পেয়ে README-র `<TEMPLATE_CODE>` বসানো
- [ ] ডেমো প্রজেক্ট লিংক করা
- [ ] [`CHANGELOG.md`](CHANGELOG.md) আপডেট রাখা (টেমপ্লেট-আপডেট নোটিফিকেশনে ইউজাররা এটিই দেখে)
- [ ] (ঐচ্ছিক, ওপেন-সোর্স মেইনটেইনারদের জন্য) [Railway Kickback প্রোগ্রাম](https://docs.railway.com/templates/kickbacks) —
      সাপোর্ট এনগেজমেন্টের ভিত্তিতে টেমপ্লেট ব্যবহারে ২৫% পর্যন্ত কমিশন; ভেরিফাইড
      টেমপ্লেটের জন্য [Partner Program](https://railway.com/partners)-এ আবেদন

## 🔄 টেমপ্লেট আপডেট ফ্লো

- টেমপ্লেট **এই রিপোজিটরির উপর ভিত্তি করে** — `main` ব্রাঞ্চে মার্জ করা যেকোনো
  পরিবর্তন Railway স্বয়ংক্রিয়ভাবে ডিটেক্ট করে; টেমপ্লেট-ডিপ্লয়াররা
  **অপ্ট-ইন আপডেট নোটিফিকেশন** পায়।
- তাই: `CHANGELOG.md` আপডেট করেই মার্জ করুন, ব্রেকিং চেঞ্জ স্পষ্ট লিখুন।
- Docker-ইমেজ-ভিত্তিক টেমপ্লেটে এই অটো-আপডেট চলে না — GitHub-রিপো-ভিত্তিক
  বলেই আমাদেরটি আপডেটেবল।

## ❓ FAQ

**Q: ইউজার এক ক্লিকে ডিপ্লয় করলে ক্রেডেনশিয়াল কোথা থেকে আসবে?**
A: টেমপ্লেট ডিপ্লয়-ফ্লোতে Railway ভ্যারিয়েবল ফর্ম দেখায় (IaC-তে সেট করা
description/defaultValue থেকে) — ইউজার নিজের Xtream অ্যাকাউন্টের ক্রেডেনশিয়াল দেয়।
ফাঁকা রাখলেও ডিপ্লয় সফল হয় (`/status` হেলথচেক), পরে Variables-এ বসানো যায়।

**Q: টেমপ্লেট-ডিপ্লয়ারের সার্ভিস কোন কোড চালায়?**
A: এই রিপোজিটরির `main` ব্রাঞ্চ থেকে বিল্ড হয় — তাই কোডের উন্নতি সবাই পায়
(আপডেট নোটিফিকেশনসহ), আর প্রত্যেকের ক্রেডেনশিয়াল আলাদা থাকে।

**Q: IaC (`railway config apply`) আর টেমপ্লেট একসাথে চলবে?**
A: হ্যাঁ — `.railway/railway.ts` টেমপ্লেটের প্রজেক্ট-কনফিগ ডিফাইন করে;
পাবলিশ করার পর টেমপ্লেট-ডিপ্লয়ারদের নিজস্ব প্রজেক্টে এটি অ্যাপ্লাই হয় না
(তাদের সার্ভিস কনফিগ টেমপ্লেট স্ন্যাপশট থেকে ক্লোন হয়)। কনফিগ বদলাতে
IaC আপডেট করে `main`-এ মার্জ করুন — আপডেট ফ্লো বাকিটা সামলাবে।

**Q: রেপ্লিকা বাড়ালে কী হয়?**
A: বাড়াবেন না — `/live/<id>` ফ্যান-আউট হাব প্রতি-প্রসেস স্টেট; ২ রেপ্লিকা মানে
২টি আলাদা আপস্ট্রিম কানেকশন ও আলাদা ড্যাশবোর্ড। স্কেলিং দরকার হলে CPU/RAM (vertical)।
