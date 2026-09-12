# syntax=docker/dockerfile:1

# ============================================================
#  Stage 1 — build (multi-stage)
# ============================================================
FROM golang:1.23-alpine AS build

WORKDIR /src

# শুধু go.mod আগে কপি — ডিপেন্ডেন্সি লেয়ার ক্যাশে থাকবে, সোর্স বদলালে
# আবার ডাউনলোড লাগবে না।
COPY go.mod ./
RUN go mod download

COPY . .

# স্ট্যাটিক বাইনারি (CGO_ENABLED=0) → alpine/distroless/scratch সবখানেই চলবে।
# trimpath + -s -w → বিল্ড পাথ বাদ, ডিবাগ সিম্বল বাদ (ছোট ইমেজ)।
# GOOS/GOARCH আলাদা দিতে হয় না — কনটেইনারের প্ল্যাটফর্ম অনুযায়ী Go নিজেই বেছে নেয়।
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/xtream-proxy . \
 && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/upstream-sim ./cmd/upstream-sim

# ============================================================
#  Stage 2 — shared runtime base (কমন লেয়ার)
# ============================================================
FROM alpine:3.20 AS base

# ca-certificates: HTTPS আপস্ট্রিম (CDN) ভেরিফাই করার জন্য জরুরি।
# হেলথচেকের wget হলো Alpine-এর বিল্ট-ইন busybox applet — আলাদা ইনস্টল লাগে না।
RUN apk add --no-cache ca-certificates \
 && adduser -D -H -u 10001 appuser

# ============================================================
#  Stage 3 — upstream-sim (লোকাল/কম্পোজ ডেমো টেস্টিং)
# ============================================================
FROM base AS sim

COPY --from=build /out/upstream-sim /usr/local/bin/upstream-sim

USER appuser
EXPOSE 9000

ENTRYPOINT ["/usr/local/bin/upstream-sim"]

# ============================================================
#  Stage 4 — প্রোডাকশন প্রক্সি
#  ⚠️ এটিই শেষ স্টেজ, তাই ডিফল্ট বিল্ড টার্গেট (`docker build .`)।
# ============================================================
FROM base AS proxy

COPY --from=build /out/xtream-proxy /usr/local/bin/xtream-proxy

# নন-রুট ইউজার — কনটেইনার এস্কেপের ব্লাস্ট রেডিয়াস কমায়
USER appuser

ENV PORT=8000
EXPOSE 8000

# /status কখনো ক্রেডেনশিয়াল ছাড়াই 200 দেয় → ভালো হেলথ এন্ডপয়েন্ট
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/status" || exit 1

# ENTRYPOINT বাইনারি — ফ্ল্যাগ পাস করতে: docker run xtream-proxy -port 9000
ENTRYPOINT ["/usr/local/bin/xtream-proxy"]
