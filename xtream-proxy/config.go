// কনফিগারেশন — ফ্ল্যাগ ও এনভায়রনমেন্ট ভ্যারিয়েবল সাপোর্ট সহ
package main

import (
	"flag"
	"fmt"
	"log"
	"net/url"
	"os"
	"strconv"
	"strings"
)

// Config — সার্ভারের সব কনফিগ এক জায়গায়
type Config struct {
	BaseURL  string // যেমন: http://source-server.com:8080
	Username string
	Password string
	Port     int

	base *url.URL // পার্স করা বেস URL (internal)
}

// LoadConfig — ফ্ল্যাগ > এনভায়রনমেন্ট ভ্যারিয়েবল প্রায়োরিটিতে কনফিগ লোড করে
func LoadConfig() *Config {
	cfg := &Config{}
	flag.StringVar(&cfg.BaseURL, "base", envOr("XTREAM_BASE_URL", ""),
		"Xtream সার্ভারের বেস URL (যেমন: http://host:8080)")
	flag.StringVar(&cfg.Username, "user", envOr("XTREAM_USERNAME", ""), "Xtream ইউজারনেম")
	flag.StringVar(&cfg.Password, "pass", envOr("XTREAM_PASSWORD", ""), "Xtream পাসওয়ার্ড")
	flag.IntVar(&cfg.Port, "port", envIntOr("PORT", 8000), "HTTP সার্ভার পোর্ট")
	flag.Parse()

	c, err := newConfig(cfg.BaseURL, cfg.Username, cfg.Password, cfg.Port)
	if err != nil {
		log.Fatalf("❌ কনফিগ এরর: %v", err)
	}
	return c
}

func newConfig(base, user, pass string, port int) (*Config, error) {
	c := &Config{BaseURL: strings.TrimRight(base, "/"), Username: user, Password: pass, Port: port}
	if c.BaseURL != "" {
		u, err := url.Parse(c.BaseURL)
		if err != nil || u.Scheme == "" || u.Host == "" {
			return nil, fmt.Errorf("অবৈধ বেস URL: %q", base)
		}
		c.base = u
	}
	return c, nil
}

// Configured — Xtream ক্রেডেনশিয়াল সেট আছে কিনা
func (c *Config) Configured() bool {
	return c.base != nil && c.Username != "" && c.Password != ""
}

// LiveURL — Xtream লাইভ এন্ডপয়েন্ট তৈরি করে: <base>/live/<user>/<pass>/<file>
func (c *Config) LiveURL(file string) string {
	u := *c.base
	u.Path = "/live/" + c.Username + "/" + c.Password + "/" + file
	u.RawQuery = ""
	return u.String()
}

// liveEscapedPath — তুলনার জন্য /live/<user>/<pass>/<file> এর escaped পাথ
func (c *Config) liveEscapedPath(file string) string {
	u := *c.base
	u.Path = "/live/" + c.Username + "/" + c.Password + "/" + file
	return u.EscapedPath()
}

// LogStartup — স্টার্টআপে কনফিগ সামারি প্রিন্ট করে (পাসওয়ার্ড মাস্ক করা)
func (c *Config) LogStartup() {
	if !c.Configured() {
		log.Println("⚠️ Xtream ক্রেডেনশিয়াল সেট করা নেই!")
		log.Println("   ফ্ল্যাগ: -base/-user/-pass  অথবা  env: XTREAM_BASE_URL / XTREAM_USERNAME / XTREAM_PASSWORD")
		return
	}
	masked := c.Password
	if len(masked) > 2 {
		masked = masked[:1] + strings.Repeat("*", len(masked)-1)
	}
	log.Printf("🔧 আপস্ট্রিম: %s | ইউজার: %s | পাস: %s", c.BaseURL, c.Username, masked)
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envIntOr(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}
