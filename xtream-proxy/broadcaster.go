// 1-to-Many ফ্যান-আউট রেস্ট্রিমিং ইঞ্জিন
// একটি সোর্স → অনেক ক্লায়েন্ট; অটো-রিকানেক্ট + স্লো-ক্লায়েন্ট প্রোটেকশন সহ
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	viewerQueueSize   = 256             // প্রতি ভিউয়ার চাঙ্ক বাফার
	upstreamReadBuf   = 32 * 1024       // আপস্ট্রিম রিড বাফার
	maxSlowDrops      = 64              // টানা এত চাঙ্ক স্কিপ হলে ভিউয়ার কিক
	reconnectBaseWait = 1 * time.Second // রিকানেক্ট ব্যাকঅফ শুরু
	reconnectMaxWait  = 15 * time.Second
)

// Viewer — একজন সংযুক্ত ক্লায়েন্ট
type Viewer struct {
	ch        chan []byte
	done      chan struct{} // হাব কিক/বন্ধ করলে বন্ধ হয়
	closeOnce sync.Once
	drops     int32 // atomic: টানা স্কিপ হওয়া চাঙ্ক সংখ্যা
}

// kick — ভিউয়ারকে বিচ্ছিন্ন করার সিগন্যাল (শুধু একবার বন্ধ হয়)
func (v *Viewer) kick() {
	v.closeOnce.Do(func() { close(v.done) })
}

// StreamChannel — একটি স্ট্রিমের সব ভিউয়ার + আপস্ট্রিম স্টেট
type StreamChannel struct {
	id           string
	cfg          *Config
	mu           sync.RWMutex
	viewers      map[*Viewer]struct{}
	cancelSource context.CancelFunc // চলমান আপস্ট্রিম রিকোয়েস্ট বাতিল

	sourceUp int32 // atomic: 1 = আপস্ট্রিম কানেক্টেড
	started  int32 // atomic: সুপারভাইজার চালু আছে কিনা
	stopped  int32 // atomic: চ্যানেল চিরতরে বন্ধ
	bytes    int64 // atomic: মোট রিলে হওয়া বাইট
	reconns  int64 // atomic: রিকানেক্ট সংখ্যা
	created  time.Time
}

func (sc *StreamChannel) viewerCount() int {
	sc.mu.RLock()
	defer sc.mu.RUnlock()
	return len(sc.viewers)
}

// BroadcasterHub — সব চ্যানেলের রেজিস্ট্রি
type BroadcasterHub struct {
	cfg      *Config
	mu       sync.RWMutex
	channels map[string]*StreamChannel
	closed   int32
}

func NewBroadcasterHub(cfg *Config) *BroadcasterHub {
	return &BroadcasterHub{cfg: cfg, channels: make(map[string]*StreamChannel)}
}

// Run — পিরিয়ডিক স্ট্যাটস লগার (ব্যাকগ্রাউন্ড)
func (h *BroadcasterHub) Run() {
	log.Println("📡 ব্রডকাস্টার হাব সক্রিয়")
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	for range t.C {
		if atomic.LoadInt32(&h.closed) == 1 {
			return
		}
		if ch, v := h.Stats(); ch > 0 {
			log.Printf("📊 হাব স্ট্যাটস: চ্যানেল=%d, ভিউয়ার=%d", ch, v)
		}
	}
}

// Stats — মোট চ্যানেল ও ভিউয়ার সংখ্যা
func (h *BroadcasterHub) Stats() (channels, viewers int) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, sc := range h.channels {
		channels++
		sc.mu.RLock()
		viewers += len(sc.viewers)
		sc.mu.RUnlock()
	}
	return
}

// AddViewer — নতুন ভিউয়ার যোগ; প্রথম ভিউয়ার হলে আপস্ট্রিম সুপারভাইজার চালু হয়
func (h *BroadcasterHub) AddViewer(streamID string) *Viewer {
	viewer := &Viewer{
		ch:   make(chan []byte, viewerQueueSize),
		done: make(chan struct{}),
	}

	h.mu.Lock()
	sc := h.channels[streamID]
	if sc == nil {
		sc = &StreamChannel{
			id:      streamID,
			cfg:     h.cfg,
			viewers: make(map[*Viewer]struct{}),
			created: time.Now(),
		}
		h.channels[streamID] = sc
	}
	sc.mu.Lock()
	sc.viewers[viewer] = struct{}{}
	count := len(sc.viewers)
	sc.mu.Unlock()
	first := atomic.CompareAndSwapInt32(&sc.started, 0, 1)
	h.mu.Unlock()

	if first {
		go h.supervise(sc)
	}

	log.Printf("👁️ নতুন ভিউয়ার: stream=%s | মোট ভিউয়ার: %d", streamID, count)
	return viewer
}

// RemoveViewer — ভিউয়ার সরানো; শেষ ভিউয়ার গেলে চ্যানেল ও আপস্ট্রিম বন্ধ
func (h *BroadcasterHub) RemoveViewer(streamID string, v *Viewer) {
	h.mu.Lock()
	sc := h.channels[streamID]
	if sc == nil {
		h.mu.Unlock()
		return
	}
	sc.mu.Lock()
	if _, ok := sc.viewers[v]; ok {
		delete(sc.viewers, v)
		v.kick()
	}
	count := len(sc.viewers)
	empty := count == 0
	if empty {
		delete(h.channels, streamID)
		atomic.StoreInt32(&sc.stopped, 1)
		if sc.cancelSource != nil {
			sc.cancelSource()
		}
	}
	sc.mu.Unlock()
	h.mu.Unlock()

	log.Printf("🚪 ভিউয়ার বিদায়: stream=%s | বাকি ভিউয়ার: %d", streamID, count)
	if empty {
		log.Printf("🛑 চ্যানেল বন্ধ: stream=%s (মোট রিলে: %.1f MB)",
			streamID, float64(atomic.LoadInt64(&sc.bytes))/(1024*1024))
	}
}

// supervise — ভিউয়ার থাকা পর্যন্ত আপস্ট্রিম সংযোগ রক্ষা করে (এক্সপোনেনশিয়াল ব্যাকঅফ রিকানেক্ট)
func (h *BroadcasterHub) supervise(sc *StreamChannel) {
	wait := reconnectBaseWait
	for {
		if atomic.LoadInt32(&sc.stopped) == 1 {
			return
		}
		if sc.viewerCount() == 0 {
			// RemoveViewer-এর সাথে রেস এড়াতে হাব লকের ভেতরে পরীক্ষা + ডিলিট
			h.mu.Lock()
			if atomic.LoadInt32(&sc.stopped) != 1 && sc.viewerCount() == 0 {
				delete(h.channels, sc.id)
				atomic.StoreInt32(&sc.stopped, 1)
				log.Printf("🛑 চ্যানেল বন্ধ: stream=%s (আর কোনো ভিউয়ার নেই)", sc.id)
			}
			h.mu.Unlock()
			return
		}

		start := time.Now()
		err := sc.pump()
		if atomic.LoadInt32(&sc.stopped) == 1 {
			return
		}
		if time.Since(start) > 30*time.Second {
			wait = reconnectBaseWait // দীর্ঘ সফল সংযোগের পরে ব্যাকঅফ রিসেট
		}
		if sc.viewerCount() == 0 {
			continue // লুপের শুরুতে ক্লিনআপ হবে
		}

		atomic.AddInt64(&sc.reconns, 1)
		log.Printf("🔁 আপস্ট্রিম বিচ্ছিন্ন: stream=%s (%v) — %s পরে আবার চেষ্টা", sc.id, err, wait)
		select {
		case <-time.After(wait):
		}
		wait *= 2
		if wait > reconnectMaxWait {
			wait = reconnectMaxWait
		}
	}
}

// pump — আপস্ট্রিম থেকে ডেটা এনে সব ভিউয়ারে বিতরণ করে
func (sc *StreamChannel) pump() error {
	ctx, cancel := context.WithCancel(context.Background())
	sc.mu.Lock()
	sc.cancelSource = cancel
	sc.mu.Unlock()
	defer cancel()

	target := sc.cfg.LiveURL(sc.id + ".ts")
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", defaultUserAgent)

	resp, err := streamClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("আপস্ট্রিম HTTP %d", resp.StatusCode)
	}

	atomic.StoreInt32(&sc.sourceUp, 1)
	defer atomic.StoreInt32(&sc.sourceUp, 0)
	log.Printf("📡 আপস্ট্রিম কানেক্টেড: stream=%s", sc.id)

	buf := make([]byte, upstreamReadBuf)
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			// গোরুটিন-সেফ কপি — প্রতিটি ভিউয়ার নিজের স্লাইস পায়
			data := make([]byte, n)
			copy(data, buf[:n])
			atomic.AddInt64(&sc.bytes, int64(n))
			sc.broadcast(data)
		}
		if readErr != nil {
			if errors.Is(readErr, io.EOF) {
				return io.EOF
			}
			return readErr
		}
	}
}

// broadcast — এক চাঙ্ক সব ভিউয়ারে পাঠায়; বাফার ফুল ধীর ভিউয়ারকে স্কিপ/কিক করে
func (sc *StreamChannel) broadcast(data []byte) {
	sc.mu.RLock()
	defer sc.mu.RUnlock()
	for v := range sc.viewers {
		select {
		case v.ch <- data:
			atomic.StoreInt32(&v.drops, 0)
		default:
			// ভিউয়ারের বাফার ফুল — ধীর ক্লায়েন্ট
			if d := atomic.AddInt32(&v.drops, 1); d >= maxSlowDrops {
				log.Printf("⚠️ ধীর ভিউয়ার কিক: stream=%s (টানা %d চাঙ্ক স্কিপ)", sc.id, d)
				v.kick() // হ্যান্ডলার বেরিয়ে যাবে, defer RemoveViewer পরিষ্কার করবে
			}
		}
	}
}

// =============================================
// ফ্যান-আউট HTTP হ্যান্ডলার — /live/<stream_id>
// =============================================
func FanOutStreamHandler(w http.ResponseWriter, r *http.Request, hub *BroadcasterHub) {
	streamID := strings.Trim(strings.TrimPrefix(r.URL.Path, "/live/"), "/")
	if streamID == "" {
		http.Error(w, "Stream ID দরকার", http.StatusBadRequest)
		return
	}
	if atomic.LoadInt32(&hub.closed) == 1 {
		http.Error(w, "সার্ভার বন্ধ হচ্ছে", http.StatusServiceUnavailable)
		return
	}
	if !hub.cfg.Configured() {
		notConfigured(w)
		return
	}

	viewer := hub.AddViewer(streamID)
	defer hub.RemoveViewer(streamID, viewer)

	w.Header().Set("Content-Type", "video/mp2t")
	w.Header().Set("Cache-Control", "no-cache, no-store")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("X-Accel-Buffering", "no") // nginx-এর পেছনে বাফারিং অফ
	w.WriteHeader(http.StatusOK)

	flusher, canFlush := w.(http.Flusher)

	for {
		select {
		case <-r.Context().Done():
			return // ক্লায়েন্ট প্লেয়ার বন্ধ করেছে
		case <-viewer.done:
			return // হাব কিক করেছে (ধীর ক্লায়েন্ট/শাটডাউন)
		case data := <-viewer.ch:
			if _, err := w.Write(data); err != nil {
				return
			}
			if canFlush {
				flusher.Flush() // রিয়েল-টাইম ফ্লাশ
			}
		}
	}
}

// =============================================
// স্ট্যাটাস ড্যাশবোর্ড — /status
// =============================================
func StatusHandler(w http.ResponseWriter, r *http.Request, hub *BroadcasterHub) {
	hub.mu.RLock()
	defer hub.mu.RUnlock()

	ids := make([]string, 0, len(hub.channels))
	for id := range hub.channels {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	var b strings.Builder
	b.WriteString("=== Xtream Proxy স্ট্যাটাস ===\n")
	b.WriteString(fmt.Sprintf("সার্ভার আপটাইম: %s\n\n", time.Since(startedAt).Round(time.Second)))

	if len(ids) == 0 {
		b.WriteString("কোনো সক্রিয় স্ট্রিম নেই।\n")
	}
	total := 0
	for _, id := range ids {
		sc := hub.channels[id]
		sc.mu.RLock()
		viewers := len(sc.viewers)
		up := atomic.LoadInt32(&sc.sourceUp) == 1
		bytes := atomic.LoadInt64(&sc.bytes)
		reconns := atomic.LoadInt64(&sc.reconns)
		created := sc.created
		sc.mu.RUnlock()

		total += viewers
		status := "🔴 বন্ধ"
		if up {
			status = "🟢 সক্রিয়"
		}
		fmt.Fprintf(&b, "Stream: %s | ভিউয়ার: %d | আপস্ট্রিম: %s | রিলে: %.1f MB | রিকানেক্ট: %d | চালু হয়েছে: %s আগে\n",
			id, viewers, status, float64(bytes)/(1024*1024), reconns, time.Since(created).Round(time.Second))
	}
	fmt.Fprintf(&b, "\nমোট চ্যানেল: %d | মোট ভিউয়ার: %d\n", len(ids), total)

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Write([]byte(b.String()))
}

// Close — সব চ্যানেল ও ভিউয়ার বন্ধ (গ্রেসফুল শাটডাউন)
func (h *BroadcasterHub) Close() {
	atomic.StoreInt32(&h.closed, 1)
	h.mu.Lock()
	defer h.mu.Unlock()
	for id, sc := range h.channels {
		atomic.StoreInt32(&sc.stopped, 1)
		sc.mu.Lock()
		if sc.cancelSource != nil {
			sc.cancelSource()
		}
		for v := range sc.viewers {
			v.kick()
		}
		sc.mu.Unlock()
		log.Printf("🛑 চ্যানেল বন্ধ: stream=%s", id)
	}
}
