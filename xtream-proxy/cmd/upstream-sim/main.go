// upstream-sim — লোকাল টেস্টের জন্য নকল Xtream সার্ভার
//
// ব্যবহার:
//
//	go run ./cmd/upstream-sim -port 9000
//
// এরপর প্রক্সি চালান:
//
//	XTREAM_BASE_URL=http://127.0.0.1:9000 XTREAM_USERNAME=test XTREAM_PASSWORD=test go run .
package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

var (
	simUser = flag.String("user", "test", "প্রত্যাশিত ইউজারনেম")
	simPass = flag.String("pass", "test", "প্রত্যাশিত পাসওয়ার্ড")
	simPort = flag.Int("port", 9000, "HTTP পোর্ট")
)

func main() {
	flag.Parse()
	mux := http.NewServeMux()
	mux.HandleFunc("/live/", handleLive)
	mux.HandleFunc("/keys/", handleKey)
	addr := fmt.Sprintf("0.0.0.0:%d", *simPort)
	log.Printf("🎥 upstream-sim চলছে: http://%s (user=%s pass=%s)", addr, *simUser, *simPass)
	log.Fatal(http.ListenAndServe(addr, mux))
}

func credentials(r *http.Request) (user, pass, file string, ok bool) {
	rest := strings.TrimPrefix(r.URL.Path, "/live/")
	parts := strings.Split(rest, "/")
	if len(parts) < 3 {
		return "", "", "", false
	}
	return parts[0], parts[1], parts[len(parts)-1], true
}

func handleLive(w http.ResponseWriter, r *http.Request) {
	user, pass, file, ok := credentials(r)
	if !ok {
		http.Error(w, "bad path", http.StatusNotFound)
		return
	}
	if user != *simUser || pass != *simPass {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	switch {
	case strings.HasSuffix(file, ".m3u8"):
		writePlaylist(w, r, strings.TrimSuffix(file, ".m3u8"))
	case strings.HasSuffix(file, ".ts"):
		base := strings.TrimSuffix(file, ".ts")
		if i := strings.LastIndex(base, "_"); i > 0 {
			writeChunk(w, base[i+1:])
		} else {
			writeInfiniteStream(w, r, base)
		}
	default:
		http.NotFound(w, r)
	}
}

// writePlaylist — ৪ সেগমেন্টের স্লাইডিং-উইন্ডো HLS প্লেলিস্ট (২ সেকেন্ড করে)
func writePlaylist(w http.ResponseWriter, r *http.Request, id string) {
	w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
	w.Header().Set("Cache-Control", "no-cache")
	start := uint64(time.Now().UnixNano()/int64(2*time.Second)) - 4

	var b strings.Builder
	b.WriteString("#EXTM3U\n")
	b.WriteString("#EXT-X-VERSION:3\n")
	b.WriteString("#EXT-X-TARGETDURATION:2\n")
	b.WriteString("#EXT-X-MEDIA-SEQUENCE:" + strconv.FormatUint(start, 10) + "\n")
	fmt.Fprintf(&b, "#EXT-X-KEY:METHOD=AES-128,URI=\"http://%s/keys/%s.key\",IV=0x00000000000000000000000000000001\n", r.Host, id)
	for i := uint64(0); i < 4; i++ {
		fmt.Fprintf(&b, "#EXTINF:2.0,\n%s_%d.ts\n", id, start+i)
	}
	w.Write([]byte(b.String()))
}

// writeChunk — একটি HLS চাঙ্ক: ১০০টি TS প্যাকেট (188 বাইট করে), সিকোয়েন্স নম্বর এমবেড করা
func writeChunk(w http.ResponseWriter, seqStr string) {
	w.Header().Set("Content-Type", "video/mp2t")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	seq, _ := strconv.ParseUint(seqStr, 10, 64)
	pkt := make([]byte, 188)
	pkt[0] = 0x47
	pkt[1] = byte(seq >> 8)
	pkt[2] = byte(seq)
	for i := 3; i < 188; i++ {
		pkt[i] = byte(i)
	}
	buf := make([]byte, 0, 188*100)
	for i := 0; i < 100; i++ {
		buf = append(buf, pkt...)
	}
	w.Write(buf)
}

// writeInfiniteStream — অবিরাম TS স্ট্রিম (প্রায় ১৫০ KB/s), রিয়েল-টাইম ফ্লাশ সহ
func writeInfiniteStream(w http.ResponseWriter, r *http.Request, id string) {
	log.Printf("▶️ অবিরাম স্ট্রিম খোলা হলো: %s (from %s)", id, r.RemoteAddr)
	w.Header().Set("Content-Type", "video/mp2t")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	flusher, _ := w.(http.Flusher)

	var seq uint64
	pkt := make([]byte, 188)
	pkt[0] = 0x47 // MPEG-TS sync byte
	batch := make([]byte, 0, 188*50)
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			log.Printf("⏹️ অবিরাম স্ট্রিম বন্ধ: %s", id)
			return
		case <-ticker.C:
			seq++
			pkt[1] = byte(seq >> 8)
			pkt[2] = byte(seq)
			batch = batch[:0]
			for i := 0; i < 50; i++ {
				batch = append(batch, pkt...)
			}
			if _, err := w.Write(batch); err != nil {
				return
			}
			if flusher != nil {
				flusher.Flush()
			}
		}
	}
}

func handleKey(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Write([]byte("0123456789abcdef")) // 16 বাইট নকল AES কী
}
