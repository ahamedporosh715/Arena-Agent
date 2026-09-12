// .railway/railway.ts — Railway Infrastructure as Code (IaC) — প্রিমিয়াম টেমপ্লেট কনফিগ
//
// এই ফাইলটিই One-Click Railway টেমপ্লেটের মেরুদণ্ড: Railway ড্যাশবোর্ডে এই
// প্রজেক্ট থেকে "Create Template" করলে নিচের সব সেটিংস টেমপ্লেটে বেক হয়ে যায়,
// আর টেমপ্লেট থেকে ডিপ্লয় করা প্রতিটি ইউজার একই প্রিমিয়াম সেটআপ পায়।
//
// প্রিমিয়াম ফিচার:
//   • env-aware কনফিগ (ctx) — production ≠ preview
//   • গাইডেড ভ্যারিয়েবল ফর্ম — description/defaultValue/isOptional মেটাডেটা
//     টেমপ্লেট ডিপ্লয়ের "Configure" স্টেপে ভ্যারিয়েবল ফর্ম হিসেবে দেখায়
//   • preserveExisting — IaC অ্যাপ্লাই কখনো ইউজারের সেট করা ভ্যালু মুছে দেয় না
//   • জিরো-ডাউনটাইম ডিপ্লয় + পূর্ণ গ্রেসফুল শাটডাউন
//
// টেমপ্লেট পাবলিশ গাইড: /TEMPLATE.md
import { defineRailway, github, project, service } from "railway/iac";

export default defineRailway((ctx) => {
  const production = ctx.environment === "production";

  const proxy = service("xtream-proxy", {
    // টেমপ্লেট সোর্স = এই রিপোজিটরি। টেমপ্লেট-ডিপ্লয়াররা এখান থেকেই কোড পায়,
    // আর main ব্রাঞ্চে মার্জ হলে Railway নিজেই তাদের "আপডেট আছে" নোটিফিকেশন দেখায়।
    source: github("ahamedporosh715/Arena-Agent", {
      branch: "main",
      rootDirectory: "xtream-proxy",
    }),

    // Dockerfile বিল্ড — rootDirectory-র গোড়ার Dockerfile Railway নিজেই ডিটেক্ট করে;
    // এখানে স্পষ্ট করেই দেওয়া হয়েছে (মাল্টি-স্টেজ, স্ট্যাটিক Go, নন-রুট রানটাইম)।
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
    },

    deploy: {
      // /status ক্রেডেনশিয়াল ছাড়াই সবসময় 200 দেয় → নিখুঁত হেলথচেক।
      // ফলে ভ্যারিয়েবল ফাঁকা থাকলেও এক-ক্লিক ডিপ্লয় সফল হয়; ইউজার পরে
      // ক্রেডেনশিয়াল বসালেই স্ট্রিম চালু (লগে স্পষ্ট গাইডেন্স মেসেজ থাকে)।
      healthcheckPath: "/status",
      healthcheckTimeout: 180,
      restartPolicyType: "ALWAYS",

      // ⚠️ ফ্যান-আউট হাব প্রতি-প্রসেস স্টেট (ভিউয়ার লিস্ট, আপস্ট্রিম কানেকশন) —
      // তাই রেপ্লিকা সবসময় ১। ভিউয়ার বাড়লে vertical স্কেল (CPU/RAM) করুন।
      numReplicas: 1,

      // জিরো-ডাউনটাইম শুধু প্রোডাকশনে; প্রিভিউ/PR এনভায়রনমেন্ট দ্রুত ওভারল্যাপে
      overlapSeconds: production ? 20 : 0,
      // SIGTERM → SIGKILL উইন্ডো; অ্যাপের ১০ সেকেন্ডের গ্রেসফুল শাটডাউন শেষ হওয়ার সুযোগ
      drainingSeconds: production ? 30 : 10,

      // আপস্ট্রিম Xtream সার্ভারের সবচেয়ে কাছের রিজিয়ন বেছে নিতে কমেন্ট খুলুন,
      // যেমন: "us-west2", "europe-west4", "asia-southeast1"
      // region: "us-west2",
    },

    env: {
      // 🔐 গাইডেড সেটআপ: টেমপ্লেট ডিপ্লয়ের সময় Railway ভ্যারিয়েবল ফর্মে
      //    নিচের description দেখায়। ফাঁকা রেখে ডিপ্লয় করলেও চলে (হেলথচেক ঠিক থাকে),
      //    পরে ড্যাশবোর্ড → Variables-এ বসালেই লাইভ। preserveExisting গ্যারান্টি দেয়
      //    যে পরের `railway config apply` ইউজারের ভ্যালু কখনো মুছবে/ওভাররাইট করবে না।
      XTREAM_BASE_URL: {
        description:
          "Xtream সার্ভারের বেস URL, যেমন: http://source-server.com:8080 (ট্রেইলিং স্ল্যাশ ছাড়া)",
        defaultValue: "",
        isOptional: true,
        preserveExisting: true,
      },
      XTREAM_USERNAME: {
        description: "Xtream অ্যাকাউন্টের ইউজারনেম",
        defaultValue: "",
        isOptional: true,
        preserveExisting: true,
      },
      XTREAM_PASSWORD: {
        description: "Xtream অ্যাকাউন্টের পাসওয়ার্ড (ডিপ্লয়ের পর Variables-এ sealed করা যায়)",
        defaultValue: "",
        isOptional: true,
        preserveExisting: true,
      },
      // PORT Railway নিজেই ইনজেক্ট করে — সেট করবেন না।
    },
  });

  return project("arena-agent", {
    resources: [proxy],
  });
});
