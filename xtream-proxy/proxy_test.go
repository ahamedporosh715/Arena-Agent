package main

import (
	"encoding/base64"
	"net/url"
	"strings"
	"testing"
)

func testConfig(t *testing.T) *Config {
	t.Helper()
	cfg, err := newConfig("http://src.example:8080", "user1", "pass1", 8000)
	if err != nil {
		t.Fatalf("কনফিগ তৈরি ব্যর্থ: %v", err)
	}
	return cfg
}

func TestLiveURL(t *testing.T) {
	cfg := testConfig(t)
	got := cfg.LiveURL("1001.ts")
	want := "http://src.example:8080/live/user1/pass1/1001.ts"
	if got != want {
		t.Errorf("LiveURL = %q, want %q", got, want)
	}
}

func TestIsSafeName(t *testing.T) {
	cases := map[string]bool{
		"1001":                   true,
		"1001_5.ts":              true,
		"abc-def.m3u8":           true,
		"":                       false,
		"../etc":                 false,
		"a/b":                    false,
		"a b":                    false,
		"a%2fb":                  false,
		strings.Repeat("x", 300): false,
	}
	for in, want := range cases {
		if got := isSafeName(in); got != want {
			t.Errorf("isSafeName(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestLocalRefForFlatChunk(t *testing.T) {
	cfg := testConfig(t)
	base, _ := url.Parse(cfg.LiveURL("1001.m3u8"))
	got := rewriteRefLine("1001_5.ts", base, cfg, "1001")
	want := "/hls/1001/1001_5.ts"
	if got != want {
		t.Errorf("rewriteRefLine = %q, want %q", got, want)
	}
}

func TestLocalRefForChunkWithQuery(t *testing.T) {
	cfg := testConfig(t)
	base, _ := url.Parse(cfg.LiveURL("1001.m3u8"))
	got := rewriteRefLine("seg.ts?token=abc", base, cfg, "1001")
	if !strings.HasPrefix(got, "/hls/1001/u/") {
		t.Errorf("কোয়েরি-স্ট্রিং চাঙ্ক এনকোডেড হওয়ার কথা, পেয়েছি: %q", got)
	}
}

func TestLocalRefForForeignCDNURL(t *testing.T) {
	cfg := testConfig(t)
	base, _ := url.Parse(cfg.LiveURL("1001.m3u8"))
	orig := "http://cdn.example.com/x/y/seg1.ts?tok=abc"
	got := rewriteRefLine(orig, base, cfg, "1001")
	if !strings.HasPrefix(got, "/hls/1001/u/") {
		t.Fatalf("বিদেশি CDN URL এনকোডেড হওয়ার কথা, পেয়েছি: %q", got)
	}
	enc := strings.TrimPrefix(got, "/hls/1001/u/")
	raw, err := base64.RawURLEncoding.DecodeString(enc)
	if err != nil {
		t.Fatalf("ডিকোড ব্যর্থ: %v", err)
	}
	if string(raw) != orig {
		t.Errorf("রাউন্ড-ট্রিপ মেলেনি: %q != %q", string(raw), orig)
	}
}

func TestRewriteTagLineKeyURI(t *testing.T) {
	cfg := testConfig(t)
	base, _ := url.Parse(cfg.LiveURL("1001.m3u8"))
	line := `#EXT-X-KEY:METHOD=AES-128,URI="http://src.example:8080/live/user1/pass1/keys/k.key",IV=0x1`
	got := rewriteTagLine(line, base, cfg, "1001")
	if !strings.Contains(got, `URI="/hls/1001/u/`) {
		t.Errorf("KEY URI রিরাইট হয়নি: %q", got)
	}
	if strings.Contains(got, "pass1") {
		t.Errorf("রিরাইট করা লাইনে ক্রেডেনশিয়াল লিক: %q", got)
	}
}

func TestRewritePlaylistNoCredentialLeak(t *testing.T) {
	cfg := testConfig(t)
	base, _ := url.Parse(cfg.LiveURL("1001.m3u8"))
	body := "#EXTM3U\r\n#EXT-X-TARGETDURATION:2\r\n#EXTINF:2.0,\r\n1001_1.ts\r\n\r\n"
	out := rewritePlaylist(body, base, cfg, "1001")
	if !strings.Contains(out, "/hls/1001/1001_1.ts") {
		t.Errorf("চাঙ্ক রিরাইট হয়নি:\n%s", out)
	}
	if strings.Contains(out, "user1") || strings.Contains(out, "pass1") {
		t.Errorf("প্লেলিস্টে ক্রেডেনশিয়াল লিক:\n%s", out)
	}
}
