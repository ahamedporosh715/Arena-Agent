// Xtream All-in-One Streaming Proxy — এন্ট্রি পয়েন্ট ও রাউটিং
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

var startedAt = time.Now()

func main() {
	cfg := LoadConfig()
	cfg.LogStartup()

	// ব্রডকাস্টার হাব ইনিশিয়ালাইজ
	hub := NewBroadcasterHub(cfg)
	go hub.Run()

	// ====== রাউটিং ======
	mux := http.NewServeMux()

	// ১. MPEG-TS ডিরেক্ট প্রক্সি — /ts/<stream_id>
	mux.HandleFunc("/ts/", func(w http.ResponseWriter, r *http.Request) {
		TSProxyHandler(w, r, cfg)
	})

	// ২. HLS প্রক্সি — /hls/<id>.m3u8, /hls/<id>/<chunk>.ts, /hls/<id>/u/<encoded>
	mux.HandleFunc("/hls/", func(w http.ResponseWriter, r *http.Request) {
		HLSProxyHandler(w, r, cfg)
	})

	// ৩. 1-to-Many রেস্ট্রিমিং (Fan-out) — /live/<stream_id>
	mux.HandleFunc("/live/", func(w http.ResponseWriter, r *http.Request) {
		FanOutStreamHandler(w, r, hub)
	})

	// ৪. স্ট্যাটাস ড্যাশবোর্ড — /status
	mux.HandleFunc("/status", func(w http.ResponseWriter, r *http.Request) {
		StatusHandler(w, r, hub)
	})

	// ল্যান্ডিং পেজ
	mux.HandleFunc("/", indexHandler)

	server := &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.Port),
		Handler:           mux,
		IdleTimeout:       120 * time.Second,
		ReadHeaderTimeout: 10 * time.Second,
		// লাইভ স্ট্রিম আনলিমিটেড — ReadTimeout/WriteTimeout ইচ্ছাকৃতভাবে নেই
	}

	// গ্রেসফুল শাটডাউন (SIGINT/SIGTERM)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		<-ctx.Done()
		log.Println("🛑 শাটডাউন সিগন্যাল পাওয়া গেছে — বন্ধ করা হচ্ছে...")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Printf("শাটডাউন এরর: %v", err)
		}
		hub.Close()
	}()

	log.Printf("🚀 Xtream All-in-One Proxy চলছে: http://localhost:%d", cfg.Port)
	log.Println("   /ts/<id>       → MPEG-TS ডিরেক্ট প্রক্সি")
	log.Println("   /hls/<id>.m3u8 → HLS m3u8 রিরাইট প্রক্সি")
	log.Println("   /live/<id>     → 1-to-Many রেস্ট্রিমিং")
	log.Println("   /status        → লাইভ ড্যাশবোর্ড")

	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("❌ সার্ভার ফেইল: %v", err)
	}
	log.Println("✅ সার্ভার পরিষ্কারভাবে বন্ধ হয়েছে")
}

func indexHandler(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprint(w, indexHTML)
}

const indexHTML = `<!doctype html>
<html lang="bn">
<head>
<meta charset="utf-8">
<title>Xtream All-in-One Proxy</title>
<style>
 body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;line-height:1.6;color:#222}
 code{background:#f2f2f2;padding:2px 6px;border-radius:4px}
 table{border-collapse:collapse;width:100%}
 td,th{border:1px solid #ddd;padding:8px;text-align:left}
 th{background:#f7f7f7}
 a{color:#0366d6}
</style>
</head>
<body>
<h1>🚀 Xtream All-in-One Streaming Proxy</h1>
<p>লাইভ স্ট্যাটাস দেখুন: <a href="/status">/status</a></p>
<table>
<tr><th>ফিচার</th><th>URL</th></tr>
<tr><td>MPEG-TS ডিরেক্ট প্রক্সি</td><td><code>/ts/&lt;stream_id&gt;</code></td></tr>
<tr><td>HLS প্লেলিস্ট (রিরাইট)</td><td><code>/hls/&lt;stream_id&gt;.m3u8</code></td></tr>
<tr><td>1-to-Many রেস্ট্রিমিং</td><td><code>/live/&lt;stream_id&gt;</code></td></tr>
<tr><td>স্ট্যাটাস ড্যাশবোর্ড</td><td><code>/status</code></td></tr>
</table>
</body>
</html>
`
