// TS ডিরেক্ট প্রক্সি + HLS প্লেলিস্ট রিরাইট + চাঙ্ক প্রক্সি
package main

import (
	"encoding/base64"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strings"
	"time"
)

// অপ্টিমাইজড HTTP ক্লায়েন্ট — কানেকশন পুলিং, কম্প্রেশন বন্ধ
var streamClient = &http.Client{
	Transport: &http.Transport{
		Proxy:               http.ProxyFromEnvironment,
		MaxIdleConns:        5000,
		MaxIdleConnsPerHost: 500,
		IdleConnTimeout:     90 * time.Second,
		DialContext: (&net.Dialer{
			Timeout:   10 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 15 * time.Second,
		ExpectContinueTimeout: time.Second,
		DisableCompression:    true, // স্ট্রিমে জিপ ডিকম্প্রেশনের CPU খরচ বাঁচে
	},
	// লাইভ স্ট্রিমিংয়ে সামগ্রিক টাইমআউট নেই — শুধু কানেকশন/হেডারে টাইমআউট আছে
	Timeout: 0,
}

const defaultUserAgent = "xtream-proxy/1.0"

var (
	safeNameRe = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)
	uriAttrRe  = regexp.MustCompile(`URI="([^"]+)"`)

	// হপ-বাই-হপ হেডার — ক্লায়েন্টে ফরোয়ার্ড করা যাবে না
	hopByHopHeaders = map[string]struct{}{
		"Connection":          {},
		"Proxy-Connection":    {},
		"Keep-Alive":          {},
		"TE":                  {},
		"Trailer":             {},
		"Transfer-Encoding":   {},
		"Upgrade":             {},
		"Proxy-Authenticate":  {},
		"Proxy-Authorization": {},
	}
)

// isSafeName — পাথ ট্রাভার্সাল ঠেকাতে stream id / ফাইলনেম ভ্যালিডেশন
func isSafeName(s string) bool {
	return len(s) > 0 && len(s) <= 256 && !strings.Contains(s, "..") && safeNameRe.MatchString(s)
}

func userAgentOf(r *http.Request) string {
	if ua := r.UserAgent(); ua != "" {
		return ua
	}
	return defaultUserAgent
}

func notConfigured(w http.ResponseWriter) {
	http.Error(w, "Xtream ক্রেডেনশিয়াল কনফিগার করা নেই (-base/-user/-pass বা XTREAM_* env)", http.StatusServiceUnavailable)
}

// =============================================
// ১. MPEG-TS ডিরেক্ট প্রক্সি — /ts/<stream_id>
// =============================================
func TSProxyHandler(w http.ResponseWriter, r *http.Request, cfg *Config) {
	if !cfg.Configured() {
		notConfigured(w)
		return
	}
	id := strings.TrimSuffix(strings.Trim(strings.TrimPrefix(r.URL.Path, "/ts/"), "/"), ".ts")
	if !isSafeName(id) {
		http.Error(w, "সঠিক Stream ID দরকার", http.StatusBadRequest)
		return
	}
	proxyStream(w, r, cfg.LiveURL(id+".ts"), "video/mp2t")
}

// =============================================
// ২. HLS প্রক্সি
//   /hls/<id>.m3u8          → প্লেলিস্ট ডাউনলোড + URL রিরাইট
//   /hls/<id>/<chunk>.ts    → ফ্ল্যাট চাঙ্ক প্রক্সি
//   /hls/<id>/u/<base64url> → এনকোডেড আপস্ট্রিম URL প্রক্সি (CDN/কোয়েরি-স্ট্রিং সহ)
// =============================================
func HLSProxyHandler(w http.ResponseWriter, r *http.Request, cfg *Config) {
	if !cfg.Configured() {
		notConfigured(w)
		return
	}
	rest := strings.Trim(strings.TrimPrefix(r.URL.Path, "/hls/"), "/")
	if rest == "" {
		http.Error(w, "Stream ID দরকার", http.StatusBadRequest)
		return
	}

	switch {
	case !strings.Contains(rest, "/") && strings.HasSuffix(rest, ".m3u8"):
		id := strings.TrimSuffix(rest, ".m3u8")
		if !isSafeName(id) {
			http.Error(w, "সঠিক Stream ID দরকার", http.StatusBadRequest)
			return
		}
		hlsPlaylist(w, r, cfg, id)

	case strings.Contains(rest, "/u/"):
		parts := strings.SplitN(rest, "/u/", 2)
		if !isSafeName(parts[0]) {
			http.Error(w, "সঠিক Stream ID দরকার", http.StatusBadRequest)
			return
		}
		raw, err := base64.RawURLEncoding.DecodeString(parts[1])
		if err != nil {
			http.Error(w, "অবৈধ এনকোডেড URL", http.StatusBadRequest)
			return
		}
		target, err := url.Parse(string(raw))
		if err != nil || (target.Scheme != "http" && target.Scheme != "https") {
			http.Error(w, "অনুমোদিত নয়", http.StatusForbidden)
			return
		}
		proxyStream(w, r, target.String(), contentTypeFor(target.Path))

	default:
		idx := strings.LastIndex(rest, "/")
		if idx < 0 {
			http.Error(w, "অজানা HLS পাথ (সঠিক ফরম্যাট: /hls/<id>.m3u8)", http.StatusNotFound)
			return
		}
		id, name := rest[:idx], rest[idx+1:]
		if !isSafeName(id) || !isSafeName(name) {
			http.Error(w, "অবৈধ HLS পাথ", http.StatusBadRequest)
			return
		}
		proxyStream(w, r, cfg.LiveURL(name), contentTypeFor(name))
	}
}

// hlsPlaylist — আপস্ট্রিম m3u8 নিয়ে প্রতিটি URL লোকাল প্রক্সি পাথে রিরাইট করে
func hlsPlaylist(w http.ResponseWriter, r *http.Request, cfg *Config, id string) {
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, cfg.LiveURL(id+".m3u8"), nil)
	if err != nil {
		http.Error(w, "অভ্যন্তরীণ ত্রুটি", http.StatusInternalServerError)
		return
	}
	req.Header.Set("User-Agent", userAgentOf(r))

	resp, err := streamClient.Do(req)
	if err != nil {
		log.Printf("⚠️ HLS আপস্ট্রিম এরর: stream=%s %v", id, err)
		http.Error(w, "প্লেলিস্ট পাওয়া যায়নি", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("⚠️ HLS প্লেলিস্ট: stream=%s আপস্ট্রিম HTTP %d", id, resp.StatusCode)
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(resp.StatusCode)
		return
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20)) // সর্বোচ্চ ৪ MB
	if err != nil {
		http.Error(w, "প্লেলিস্ট পড়া যায়নি", http.StatusBadGateway)
		return
	}

	// রিডাইরেক্ট হলে শেষ ইফেক্টিভ URL থেকে রেজলভ করতে হবে
	base := resp.Request.URL

	w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
	w.Header().Set("Cache-Control", "no-cache, no-store")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(rewritePlaylist(string(body), base, cfg, id)))

	log.Printf("✅ HLS প্লেলিস্ট রিরাইট: stream=%s", id)
}

// rewritePlaylist — m3u8-এর প্রতিটি লাইন রিরাইট করে (ট্যাগ/URL/খালি লাইন)
func rewritePlaylist(body string, base *url.URL, cfg *Config, id string) string {
	var b strings.Builder
	for _, line := range strings.Split(body, "\n") {
		line = strings.TrimRight(line, "\r")
		switch {
		case line == "":
			b.WriteByte('\n')
		case line[0] == '#':
			b.WriteString(rewriteTagLine(line, base, cfg, id))
			b.WriteByte('\n')
		default:
			b.WriteString(rewriteRefLine(line, base, cfg, id))
			b.WriteByte('\n')
		}
	}
	return b.String()
}

// rewriteRefLine — সাধারণ (কমেন্ট-বিহীন) লাইনের URL রেজলভ করে রিরাইট করে
func rewriteRefLine(line string, base *url.URL, cfg *Config, id string) string {
	ref, err := url.Parse(strings.TrimSpace(line))
	if err != nil {
		return line
	}
	return localRefFor(base.ResolveReference(ref), cfg, id)
}

// rewriteTagLine — #EXT-X-KEY / #EXT-X-MAP ইত্যাদির URI="..." অ্যাট্রিবিউট রিরাইট করে
func rewriteTagLine(line string, base *url.URL, cfg *Config, id string) string {
	if !strings.Contains(line, `URI="`) {
		return line
	}
	return uriAttrRe.ReplaceAllStringFunc(line, func(m string) string {
		sub := uriAttrRe.FindStringSubmatch(m)
		ref, err := url.Parse(strings.TrimSpace(sub[1]))
		if err != nil {
			return m
		}
		return `URI="` + localRefFor(base.ResolveReference(ref), cfg, id) + `"`
	})
}

// localRefFor — রেজলভ করা আপস্ট্রিম URL-কে লোকাল প্রক্সি পাথে রূপান্তর করে।
// ফ্ল্যাট ফাইল (<base>/live/<user>/<pass>/<name>) হলে ছোট পাথ,
// নাহলে (CDN হোস্ট/সাবডিরেক্টরি/কোয়েরি-স্ট্রিং) base64url এনকোডেড ফর্ম।
func localRefFor(abs *url.URL, cfg *Config, id string) string {
	name := path.Base(abs.EscapedPath())
	if abs.RawQuery == "" && isSafeName(name) && abs.EscapedPath() == cfg.liveEscapedPath(name) {
		return "/hls/" + id + "/" + name
	}
	return "/hls/" + id + "/u/" + base64.RawURLEncoding.EncodeToString([]byte(abs.String()))
}

// proxyStream — জিরো-বাফার স্ট্রিমিং পাইপ (RAM-এ পুরো ফাইল ধরে না)
func proxyStream(w http.ResponseWriter, r *http.Request, targetURL, contentType string) {
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, targetURL, nil)
	if err != nil {
		http.Error(w, "অভ্যন্তরীণ ত্রুটি", http.StatusInternalServerError)
		return
	}
	req.Header.Set("User-Agent", userAgentOf(r))
	if rangeHdr := r.Header.Get("Range"); rangeHdr != "" {
		req.Header.Set("Range", rangeHdr)
	}

	resp, err := streamClient.Do(req)
	if err != nil {
		log.Printf("⚠️ আপস্ট্রিম এরর: %v (%s)", err, targetURL)
		http.Error(w, "স্ট্রিম অনুপলব্ধ", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	// হেডার কপি (হপ-বাই-হপ বাদে)
	for key, vals := range resp.Header {
		if _, skip := hopByHopHeaders[key]; skip {
			continue
		}
		for _, v := range vals {
			w.Header().Add(key, v)
		}
	}
	if contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(resp.StatusCode)

	if r.Method == http.MethodHead {
		return
	}

	// জিরো-কপি স্ট্রিমিং — 32KB চাঙ্কে রিয়েল-টাইম ফ্লাশ
	flusher, canFlush := w.(http.Flusher)
	buf := make([]byte, 32*1024)
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := w.Write(buf[:n]); werr != nil {
				return // ক্লায়েন্ট চলে গেছে
			}
			if canFlush {
				flusher.Flush()
			}
		}
		if readErr != nil {
			if readErr != io.EOF {
				log.Printf("স্ট্রিম রিড এরর: %v", readErr)
			}
			return
		}
	}
}

func contentTypeFor(name string) string {
	switch {
	case strings.HasSuffix(name, ".ts"):
		return "video/mp2t"
	case strings.HasSuffix(name, ".m4s"):
		return "video/iso.segment"
	case strings.HasSuffix(name, ".vtt"):
		return "text/vtt"
	case strings.HasSuffix(name, ".m3u8"):
		return "application/vnd.apple.mpegurl"
	default:
		return "application/octet-stream"
	}
}
