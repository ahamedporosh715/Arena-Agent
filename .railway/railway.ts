// .railway/railway.ts — Railway Infrastructure as Code (IaC)
//
// পুরো Railway প্রজেক্টের কনফিগ এক ফাইল থেকে ম্যানেজ হয়। Railway এখন
// এই ফরম্যাটকেই রেকমেন্ড করে — পুরনো `railway.json`/"Config as Code"
// ডেপ্রিকেটেড (২০২৬-১২-০১-এ সম্পূর্ণ বন্ধ)।
//
// ব্যবহার:
//   npm install                                  # railway SDK (একবার)
//   railway login && railway link                # Railway CLI-র সাথে লিংক
//   railway config plan                          # কী কী বদলাবে তার প্রিভিউ
//   railway config apply                         # প্রয়োগ
//
// বিস্তারিত গাইড: .railway/README.md
import { defineRailway, github, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  const proxy = service("xtream-proxy", {
    // সোর্স: এই রিপোজিটরির xtream-proxy/ সাবডিরেক্টরি (monorepo root directory)
    source: github("ahamedporosh715/Arena-Agent", {
      branch: "main",
      rootDirectory: "xtream-proxy",
    }),

    // Dockerfile বিল্ড — root directory-র গোড়ায় Dockerfile থাকায় Railway নিজেই
    // ডিটেক্ট করে; এখানে স্পষ্ট করেই দেওয়া হয়েছে।
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
    },

    deploy: {
      // /status ক্রেডেনশিয়াল ছাড়াই সবসময় 200 দেয় → নিখুঁত Railway হেলথচেক
      healthcheckPath: "/status",
      healthcheckTimeout: 180, // সেকেন্ড — ইমেজ পুল + কনটেইনার স্টার্টআপের সময়
      restartPolicyType: "ALWAYS",

      // ⚠️ ফ্যান-আউট হাব প্রতি-প্রসেস স্টেট (ভিউয়ার লিস্ট, আপস্ট্রিম কানেকশন) —
      // তাই রেপ্লিকা সবসময় ১ রাখুন; স্কেল দরকার হলে vertical (CPU/RAM) বাড়ান।
      numReplicas: 1,

      // জিরো-ডাউনটাইম ডিপ্লয়: নতুন ইন্সট্যান্স সুস্থ হওয়া পর্যন্ত পুরোনোটা চলতে থাকে
      overlapSeconds: 20,
      // SIGTERM পাওয়ার পর SIGKILL পর্যন্ত সময় — অ্যাপের ১০ সেকেন্ডের
      // গ্রেসফুল শাটডাউন (ভিউয়ার/আপস্ট্রিম সব পরিষ্কার বন্ধ) শেষ হওয়ার সুযোগ
      drainingSeconds: 30,

      // আপস্ট্রিম Xtream সার্ভারের সবচেয়ে কাছের রিজিয়ন বেছে নিতে কমেন্ট খুলুন,
      // যেমন: "us-west2", "europe-west4", "asia-southeast1"
      // region: "us-west2",
    },

    env: {
      // 🔐 গোপন ক্রেডেনশিয়াল ফাইল/কোডে না লিখে Railway-তেই রাখা হয়:
      //    Railway ড্যাশবোর্ড → Variables-এ ভ্যালু বসান (নিজে থেকেই রিডিপ্লয় হবে)।
      //    preserve() = Railway-তে যা সেট আছে সেটাই থাকবে — IaC কখনো ওভাররাইট করে না।
      XTREAM_BASE_URL: preserve(),
      XTREAM_USERNAME: preserve(),
      XTREAM_PASSWORD: preserve(),
      // PORT Railway নিজেই ইনজেক্ট করে — এখানে সেট করার দরকার নেই।
    },
  });

  return project("arena-agent", {
    resources: [proxy],
  });
});
