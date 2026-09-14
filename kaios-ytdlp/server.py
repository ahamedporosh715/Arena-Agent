#!/usr/bin/env python3
"""KaiOS 2.5-friendly yt-dlp backend server.

The app flow is optimized for KaiOS 2.5 capabilities: the phone's built-in
Browser shares a page/URL to this app via MozActivity/WebActivity, then this
backend runs `yt-dlp` and serves the final file. No copy-paste bridge is required.

A single raw JSON manifest (`api.raw.json`) describes the compatible InnerTube,
yt-dlp and ffmpeg API/CLI surfaces. The backend can reload that manifest from a
local file or a remote raw JSON URL and it bootstraps YouTube InnerTube web
client details at runtime instead of relying on a hard-coded weekly version.

Use it only for content you own, have permission to download, or that is
licensed for downloading. The server does not bypass DRM and does not use
cookies by default.
"""
from __future__ import annotations

import contextlib
import dataclasses
import datetime as dt
import html
import ipaddress
import json
import mimetypes
import os
import posixpath
import re
import secrets
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, BinaryIO

ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
DEFAULT_API_MANIFEST_PATH = ROOT / "api.raw.json"

JOB_ID_RE = re.compile(r"^[a-f0-9]{16}$")
PERCENT_RE = re.compile(r"(?P<pct>\d{1,3}(?:\.\d+)?)%")
ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
URL_RE = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)
VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
CHANNEL_ID_RE = re.compile(r"^UC[A-Za-z0-9_-]{22}$")

DEFAULT_CORS = "*"
MAX_BODY_BYTES = 32 * 1024
MAX_URL_LEN = 2048
PRIVATE_HOSTNAMES = {"localhost", "localhost.localdomain", "0.0.0.0"}
SAFE_AUDIO_FORMATS = {"m4a", "mp3", "opus", "ogg", "wav"}
SAFE_HEIGHTS = {0, 144, 240, 360, 480, 720, 1080}
DEFAULT_VIDEO_SELECTOR_HEIGHT = (
    "bestvideo[height<={height}][ext=mp4]+bestaudio[ext=m4a]/"
    "best[height<={height}][ext=mp4]/"
    "bestvideo[height<={height}]+bestaudio/"
    "best[height<={height}]/best"
)
DEFAULT_VIDEO_SELECTOR_BEST = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/bestvideo+bestaudio/best"
DEFAULT_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0"


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def iso(ts: dt.datetime | None) -> str | None:
    return ts.isoformat().replace("+00:00", "Z") if ts else None


def env_int(name: str, default: int, minimum: int | None = None, maximum: int | None = None) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    if minimum is not None:
        value = max(minimum, value)
    if maximum is not None:
        value = min(maximum, value)
    return value


def env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def body_int(payload: dict[str, Any], name: str, default: int) -> int:
    raw = payload.get(name)
    if raw in (None, ""):
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        raise APIError(400, f"{name} সংখ্যা হতে হবে")


@dataclasses.dataclass(frozen=True)
class Config:
    host: str
    port: int
    download_dir: Path
    ytdlp_bin: str
    ffmpeg_location: str
    access_token: str
    cors_origin: str
    max_concurrent: int
    metadata_timeout: int
    job_timeout: int
    cleanup_after: int
    api_manifest_path: Path
    api_manifest_url: str
    api_manifest_refresh: int
    innertube_bootstrap_ttl: int
    ytdlp_auto_update: bool
    ytdlp_update_channel: str
    ytdlp_update_interval: int

    @classmethod
    def from_env(cls) -> "Config":
        return cls(
            host=os.getenv("HOST", "0.0.0.0"),
            port=env_int("PORT", 8080, minimum=1, maximum=65535),
            download_dir=Path(os.getenv("DOWNLOAD_DIR", str(ROOT / "downloads"))).expanduser().resolve(),
            ytdlp_bin=os.getenv("YTDLP_BIN", "yt-dlp"),
            ffmpeg_location=os.getenv("FFMPEG_LOCATION", ""),
            access_token=os.getenv("YTDLP_ACCESS_TOKEN", ""),
            cors_origin=os.getenv("CORS_ORIGIN", DEFAULT_CORS),
            max_concurrent=env_int("MAX_CONCURRENT", 2, minimum=1, maximum=8),
            metadata_timeout=env_int("METADATA_TIMEOUT_SECONDS", 45, minimum=10, maximum=180),
            job_timeout=env_int("JOB_TIMEOUT_SECONDS", 1800, minimum=60, maximum=21600),
            cleanup_after=env_int("CLEANUP_AFTER_SECONDS", 86400, minimum=600, maximum=604800),
            api_manifest_path=Path(os.getenv("API_MANIFEST_PATH", str(DEFAULT_API_MANIFEST_PATH))).expanduser().resolve(),
            api_manifest_url=os.getenv("API_MANIFEST_URL", "").strip(),
            api_manifest_refresh=env_int("API_MANIFEST_REFRESH_SECONDS", 3600, minimum=60, maximum=86400),
            innertube_bootstrap_ttl=env_int("INNERTUBE_BOOTSTRAP_TTL_SECONDS", 3600, minimum=60, maximum=86400),
            ytdlp_auto_update=env_bool("YTDLP_AUTO_UPDATE", False),
            ytdlp_update_channel=os.getenv("YTDLP_UPDATE_CHANNEL", "stable").strip().lower() or "stable",
            ytdlp_update_interval=env_int("YTDLP_UPDATE_INTERVAL_SECONDS", 43200, minimum=3600, maximum=604800),
        )


class APIError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


class APISpecStore:
    """Thread-safe local/remote raw JSON manifest loader."""

    def __init__(self, path: Path, remote_url: str = "", refresh_seconds: int = 3600):
        self.path = path
        self.remote_url = remote_url
        self.refresh_seconds = refresh_seconds
        self._lock = threading.Lock()
        self._data: dict[str, Any] = {}
        self._source = str(path)
        self._loaded_at: dt.datetime | None = None
        self._last_remote_check = 0.0
        self._last_mtime = 0.0
        self.reload(force=True)

    def get(self) -> dict[str, Any]:
        self.reload(force=False)
        with self._lock:
            return json.loads(json.dumps(self._data))

    def public(self) -> dict[str, Any]:
        with self._lock:
            return {
                "source": self._source,
                "loaded_at": iso(self._loaded_at),
                "manifest": json.loads(json.dumps(self._data)),
            }

    def reload(self, force: bool = False) -> None:
        now = time.monotonic()
        data: dict[str, Any] | None = None
        source = ""

        if self.remote_url and (force or now - self._last_remote_check >= self.refresh_seconds):
            self._last_remote_check = now
            try:
                req = urllib.request.Request(self.remote_url, headers={"User-Agent": DEFAULT_USER_AGENT, "Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=12) as resp:
                    raw = resp.read(1024 * 1024)
                candidate = json.loads(raw.decode("utf-8"))
                if isinstance(candidate, dict) and candidate.get("schema"):
                    data = candidate
                    source = self.remote_url
            except Exception as exc:
                print(f"⚠️ API_MANIFEST_URL reload ব্যর্থ: {exc}", flush=True)

        if data is None:
            try:
                mtime = self.path.stat().st_mtime
            except OSError:
                mtime = 0.0
            if force or (mtime and mtime != self._last_mtime):
                try:
                    candidate = json.loads(self.path.read_text(encoding="utf-8"))
                    if isinstance(candidate, dict) and candidate.get("schema"):
                        data = candidate
                        source = str(self.path)
                        self._last_mtime = mtime
                except Exception as exc:
                    print(f"⚠️ local api.raw.json reload ব্যর্থ: {exc}", flush=True)

        if data is not None:
            with self._lock:
                self._data = data
                self._source = source
                self._loaded_at = utcnow()


# ----------------------------- InnerTube helpers -----------------------------

def dig(data: Any, *keys: str) -> Any:
    cur = data
    for key in keys:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(key)
    return cur


def text_of(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        if isinstance(value.get("simpleText"), str):
            return value["simpleText"]
        runs = value.get("runs")
        if isinstance(runs, list):
            return "".join(str(run.get("text", "")) for run in runs if isinstance(run, dict)).strip()
        label = dig(value, "accessibility", "accessibilityData", "label")
        if isinstance(label, str):
            return label
    return ""


def best_thumbnail(value: Any) -> str:
    thumbs = value if isinstance(value, list) else dig(value, "thumbnails")
    if isinstance(thumbs, list) and thumbs:
        last = thumbs[-1]
        if isinstance(last, dict):
            return str(last.get("url") or "")
    return ""


def iter_renderer(obj: Any, names: set[str]):
    if isinstance(obj, dict):
        for name in names:
            child = obj.get(name)
            if isinstance(child, dict):
                yield name, child
        for value in obj.values():
            yield from iter_renderer(value, names)
    elif isinstance(obj, list):
        for value in obj:
            yield from iter_renderer(value, names)


def find_continuation(obj: Any) -> str:
    if isinstance(obj, dict):
        token = dig(obj, "continuationCommand", "token")
        if isinstance(token, str) and token:
            return token
        for value in obj.values():
            token = find_continuation(value)
            if token:
                return token
    elif isinstance(obj, list):
        for value in obj:
            token = find_continuation(value)
            if token:
                return token
    return ""


def video_id_from_url(raw: str) -> str:
    value = (raw or "").strip()
    if VIDEO_ID_RE.match(value):
        return value
    with contextlib.suppress(Exception):
        parsed = urllib.parse.urlparse(value)
        qs_id = urllib.parse.parse_qs(parsed.query).get("v", [""])[0]
        if VIDEO_ID_RE.match(qs_id):
            return qs_id
        parts = [p for p in parsed.path.split("/") if p]
        if parsed.netloc.endswith("youtu.be") and parts and VIDEO_ID_RE.match(parts[0]):
            return parts[0]
        for marker in ("shorts", "embed", "live"):
            if marker in parts:
                idx = parts.index(marker) + 1
                if idx < len(parts) and VIDEO_ID_RE.match(parts[idx]):
                    return parts[idx]
    match = re.search(r"(?:v=|youtu\.be/|shorts/|embed/)([A-Za-z0-9_-]{11})", value)
    if match:
        return match.group(1)
    raise APIError(400, "YouTube video id/URL সঠিক নয়")


def channel_ref_from_value(raw: str) -> tuple[str, str]:
    value = (raw or "").strip()
    if CHANNEL_ID_RE.match(value):
        return "id", value
    if value.startswith("@") and len(value) > 1:
        return "handle", value
    if value.startswith("http://") or value.startswith("https://"):
        parsed = urllib.parse.urlparse(value)
        parts = [p for p in parsed.path.split("/") if p]
        if len(parts) >= 2 and parts[0] == "channel" and CHANNEL_ID_RE.match(parts[1]):
            return "id", parts[1]
        if parts and parts[0].startswith("@"):
            return "handle", parts[0]
        if len(parts) >= 2 and parts[0] in {"c", "user"}:
            return "query", parts[1]
    return "query", value.lstrip("@")


def parse_video_renderer(renderer: dict[str, Any]) -> dict[str, Any] | None:
    video_id = renderer.get("videoId")
    if not isinstance(video_id, str) or not VIDEO_ID_RE.match(video_id):
        return None
    channel_id = ""
    for key in ("ownerText", "longBylineText", "shortBylineText"):
        runs = dig(renderer, key, "runs")
        if isinstance(runs, list) and runs:
            endpoint = runs[0].get("navigationEndpoint") if isinstance(runs[0], dict) else None
            browse_id = dig(endpoint, "browseEndpoint", "browseId")
            if isinstance(browse_id, str):
                channel_id = browse_id
                break
    return {
        "type": "video",
        "id": video_id,
        "video_id": video_id,
        "title": text_of(renderer.get("title")),
        "url": f"https://www.youtube.com/watch?v={video_id}",
        "channel": text_of(renderer.get("ownerText") or renderer.get("longBylineText") or renderer.get("shortBylineText")),
        "channel_id": channel_id,
        "duration": text_of(renderer.get("lengthText")),
        "views": text_of(renderer.get("viewCountText") or renderer.get("shortViewCountText")),
        "published": text_of(renderer.get("publishedTimeText")),
        "thumbnail": best_thumbnail(renderer.get("thumbnail")),
    }


def parse_channel_renderer(renderer: dict[str, Any]) -> dict[str, Any] | None:
    channel_id = renderer.get("channelId") or dig(renderer, "navigationEndpoint", "browseEndpoint", "browseId")
    if not isinstance(channel_id, str) or not channel_id:
        return None
    handle = text_of(renderer.get("subscriberCountText"))
    return {
        "type": "channel",
        "id": channel_id,
        "channel_id": channel_id,
        "title": text_of(renderer.get("title")),
        "url": f"https://www.youtube.com/channel/{channel_id}",
        "handle": handle if handle.startswith("@") else "",
        "subscribers": text_of(renderer.get("subscriberCountText")),
        "video_count": text_of(renderer.get("videoCountText")),
        "description": text_of(renderer.get("descriptionSnippet")),
        "thumbnail": best_thumbnail(renderer.get("thumbnail")),
    }


def parse_search_response(data: dict[str, Any], limit: int = 10) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for name, renderer in iter_renderer(data, {"videoRenderer", "channelRenderer"}):
        item = parse_video_renderer(renderer) if name == "videoRenderer" else parse_channel_renderer(renderer)
        if not item:
            continue
        key = (item["type"], item["id"])
        if key in seen:
            continue
        seen.add(key)
        items.append(item)
        if len(items) >= limit:
            break
    return {"items": items, "continuation": find_continuation(data)}


def parse_player_response(data: dict[str, Any], include_urls: bool = False) -> dict[str, Any]:
    status = data.get("playabilityStatus") or {}
    details = data.get("videoDetails") or {}
    formats: list[dict[str, Any]] = []
    streaming = data.get("streamingData") or {}
    for fmt in (streaming.get("formats") or []) + (streaming.get("adaptiveFormats") or []):
        if not isinstance(fmt, dict):
            continue
        item = {
            "itag": fmt.get("itag"),
            "mimeType": fmt.get("mimeType"),
            "bitrate": fmt.get("bitrate"),
            "width": fmt.get("width"),
            "height": fmt.get("height"),
            "qualityLabel": fmt.get("qualityLabel"),
            "quality": fmt.get("quality"),
            "audioQuality": fmt.get("audioQuality"),
            "contentLength": fmt.get("contentLength"),
            "fps": fmt.get("fps"),
            "has_url": bool(fmt.get("url")),
            "has_signature_cipher": bool(fmt.get("signatureCipher") or fmt.get("cipher")),
        }
        if include_urls and fmt.get("url"):
            item["url"] = fmt.get("url")
        formats.append(item)
    return {
        "video_id": details.get("videoId"),
        "title": details.get("title"),
        "author": details.get("author"),
        "length_seconds": details.get("lengthSeconds"),
        "is_live": details.get("isLiveContent"),
        "playability_status": status.get("status"),
        "playability_reason": status.get("reason"),
        "formats": formats,
    }


def parse_channel_browse_response(data: dict[str, Any], limit: int = 20) -> dict[str, Any]:
    meta = dig(data, "metadata", "channelMetadataRenderer") or {}
    header = data.get("header") or {}
    channel_id = meta.get("externalId") or ""
    title = meta.get("title") or text_of(header)
    channel = {
        "type": "channel",
        "id": channel_id,
        "channel_id": channel_id,
        "title": title,
        "url": meta.get("channelUrl") or (f"https://www.youtube.com/channel/{channel_id}" if channel_id else ""),
        "description": meta.get("description") or "",
        "rss_url": meta.get("rssUrl") or "",
        "thumbnail": best_thumbnail(meta.get("avatar") or dig(header, "c4TabbedHeaderRenderer", "avatar")),
    }
    videos: list[dict[str, Any]] = []
    seen: set[str] = set()
    for name, renderer in iter_renderer(data, {"videoRenderer", "gridVideoRenderer"}):
        item = parse_video_renderer(renderer)
        if not item or item["video_id"] in seen:
            continue
        seen.add(item["video_id"])
        videos.append(item)
        if len(videos) >= limit:
            break
    return {"channel": channel, "videos": videos, "continuation": find_continuation(data)}


class InnerTubeClient:
    def __init__(self, spec_store: APISpecStore, bootstrap_ttl: int = 3600):
        self.spec_store = spec_store
        self.bootstrap_ttl = bootstrap_ttl
        self._lock = threading.Lock()
        self._api_key = ""
        self._client_version = ""
        self._visitor_data = ""
        self._bootstrapped_at = 0.0
        self._last_error = ""

    def state(self) -> dict[str, Any]:
        with self._lock:
            return {
                "api_key_bootstrapped": bool(self._api_key),
                "client_version": self._client_version,
                "visitor_data": bool(self._visitor_data),
                "bootstrapped_at": self._bootstrapped_at,
                "last_error": self._last_error,
            }

    def _manifest(self) -> dict[str, Any]:
        return self.spec_store.get()

    def _headers(self, spec: dict[str, Any]) -> dict[str, str]:
        headers = dict(dig(spec, "innertube", "headers") or {})
        headers.setdefault("Content-Type", "application/json")
        headers.setdefault("User-Agent", DEFAULT_USER_AGENT)
        return {str(k): str(v) for k, v in headers.items()}

    def _bootstrap(self, force: bool = False) -> None:
        now = time.monotonic()
        with self._lock:
            if not force and self._client_version and now - self._bootstrapped_at < self.bootstrap_ttl:
                return
        spec = self._manifest()
        innertube = spec.get("innertube") or {}
        regexes = innertube.get("bootstrap_regex") or {}
        api_re = re.compile(regexes.get("api_key") or r'"INNERTUBE_API_KEY":"([^"]+)"')
        ver_re = re.compile(regexes.get("client_version") or r'"INNERTUBE_CLIENT_VERSION":"([^"]+)"')
        visitor_re = re.compile(regexes.get("visitor_data") or r'"VISITOR_DATA":"([^"]+)"')
        headers = self._headers(spec)
        last_error = ""
        for url in innertube.get("bootstrap_urls") or ["https://www.youtube.com/"]:
            try:
                req = urllib.request.Request(str(url), headers=headers)
                with urllib.request.urlopen(req, timeout=12) as resp:
                    page = resp.read(2 * 1024 * 1024).decode("utf-8", "ignore")
                api_key = api_re.search(page)
                version = ver_re.search(page)
                visitor = visitor_re.search(page)
                with self._lock:
                    if api_key:
                        self._api_key = api_key.group(1)
                    if version:
                        self._client_version = version.group(1)
                    if visitor:
                        self._visitor_data = visitor.group(1)
                    self._bootstrapped_at = now
                    self._last_error = ""
                if version:
                    return
            except Exception as exc:
                last_error = str(exc)
        with self._lock:
            self._last_error = last_error or "bootstrap data not found"
            self._bootstrapped_at = now

    def _context(self, client_key: str = "web") -> dict[str, Any]:
        self._bootstrap(force=False)
        spec = self._manifest()
        clients = dig(spec, "innertube", "clients") or {}
        client = dict(clients.get(client_key) or clients.get("web") or {})
        if not client:
            client = {"clientName": "WEB", "clientVersion": "AUTO", "hl": "en", "gl": "US"}
        with self._lock:
            dynamic_version = self._client_version
            visitor_data = self._visitor_data
        if client.get("clientVersion") == "AUTO":
            client["clientVersion"] = dynamic_version or "2.20240101.00.00"
        client.setdefault("clientName", "WEB")
        client.setdefault("clientVersion", "2.20240101.00.00")
        client.setdefault("hl", "en")
        client.setdefault("gl", "US")
        if visitor_data:
            client.setdefault("visitorData", visitor_data)
        return {"client": client, "request": {"useSsl": True}, "user": {"lockedSafetyMode": False}}

    def call(self, endpoint_key: str, body: dict[str, Any], client_key: str = "web") -> dict[str, Any]:
        spec = self._manifest()
        innertube = spec.get("innertube") or {}
        raw_base_urls = innertube.get("base_urls") or [innertube.get("base_url") or "https://www.youtube.com/youtubei/v1"]
        base_urls = [str(x).rstrip("/") for x in raw_base_urls if x]
        endpoints = innertube.get("endpoints") or {}
        endpoint = str(endpoints.get(endpoint_key) or f"/{endpoint_key}")
        if not endpoint.startswith("/"):
            endpoint = "/" + endpoint
        with self._lock:
            api_key = self._api_key
        payload = dict(body)
        payload.setdefault("context", self._context(client_key))
        raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        last_error = ""
        for base_url in base_urls:
            query = {"prettyPrint": "false"}
            if api_key:
                query["key"] = api_key
            url = base_url + endpoint + "?" + urllib.parse.urlencode(query)
            req = urllib.request.Request(url, data=raw, headers=self._headers(spec), method="POST")
            try:
                with urllib.request.urlopen(req, timeout=20) as resp:
                    return json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                detail = exc.read(4096).decode("utf-8", "ignore")
                last_error = f"HTTP {exc.code}: {detail[:300]}"
                continue
            except urllib.error.URLError as exc:
                last_error = f"network error: {exc}"
                continue
            except json.JSONDecodeError:
                last_error = "invalid JSON"
                continue
        raise APIError(502, f"InnerTube {endpoint_key} ব্যর্থ: {last_error or 'unknown error'}")

    def search(self, query: str, result_type: str = "video", limit: int = 10) -> dict[str, Any]:
        query = (query or "").strip()
        if not query:
            raise APIError(400, "search query দিতে হবে")
        result_type = (result_type or "video").lower()
        params_map = dig(self._manifest(), "innertube", "search_params") or {}
        if result_type not in params_map:
            result_type = "video"
        body: dict[str, Any] = {"query": query}
        if params_map.get(result_type):
            body["params"] = params_map[result_type]
        data = self.call("search", body, client_key="web")
        parsed = parse_search_response(data, limit=max(1, min(limit, 50)))
        parsed["query"] = query
        parsed["result_type"] = result_type
        return parsed

    def player(self, video_id_or_url: str, include_urls: bool = False) -> dict[str, Any]:
        video_id = video_id_from_url(video_id_or_url)
        try:
            data = self.call("player", {"videoId": video_id}, client_key="web")
        except APIError:
            data = self.call("player", {"videoId": video_id}, client_key="android")
        parsed = parse_player_response(data, include_urls=include_urls)
        parsed["video_id"] = parsed.get("video_id") or video_id
        parsed["webpage_url"] = f"https://www.youtube.com/watch?v={video_id}"
        return parsed

    def channel(self, ref: str, limit: int = 20) -> dict[str, Any]:
        kind, value = channel_ref_from_value(ref)
        if not value:
            raise APIError(400, "channel id/handle/query দিতে হবে")
        resolved: dict[str, Any] | None = None
        if kind == "id":
            channel_id = value
        else:
            search = self.search(value, result_type="channel", limit=5)
            channels = [item for item in search.get("items", []) if item.get("type") == "channel"]
            if not channels:
                return {"resolved": False, "query": value, "channels": [], "videos": []}
            resolved = channels[0]
            channel_id = resolved["channel_id"]
        data = self.call("browse", {"browseId": channel_id}, client_key="web")
        parsed = parse_channel_browse_response(data, limit=max(1, min(limit, 50)))
        parsed["resolved"] = True
        parsed["requested"] = {"kind": kind, "value": value}
        if resolved and not parsed.get("channel", {}).get("title"):
            parsed["channel"] = resolved
        return parsed


@dataclasses.dataclass
class Job:
    id: str
    url: str
    mode: str
    max_height: int
    audio_format: str
    status: str = "queued"
    progress: float = 0.0
    title: str = ""
    filename: str = ""
    file_path: str = ""
    file_size: int = 0
    error: str = ""
    log_tail: list[str] = dataclasses.field(default_factory=list)
    created_at: dt.datetime = dataclasses.field(default_factory=utcnow)
    updated_at: dt.datetime = dataclasses.field(default_factory=utcnow)
    finished_at: dt.datetime | None = None

    def public(self, include_log: bool = False) -> dict[str, Any]:
        data: dict[str, Any] = {
            "id": self.id,
            "status": self.status,
            "mode": self.mode,
            "max_height": self.max_height,
            "audio_format": self.audio_format,
            "progress": round(self.progress, 2),
            "title": self.title,
            "filename": self.filename,
            "file_size": self.file_size,
            "error": self.error,
            "created_at": iso(self.created_at),
            "updated_at": iso(self.updated_at),
            "finished_at": iso(self.finished_at),
        }
        if self.status == "done":
            data["download_url"] = f"/api/files/{self.id}"
        if include_log:
            data["log_tail"] = self.log_tail[-25:]
        return data


class JobStore:
    def __init__(self, download_dir: Path, cleanup_after: int):
        self.download_dir = download_dir
        self.cleanup_after = cleanup_after
        self._lock = threading.Lock()
        self._jobs: dict[str, Job] = {}

    def create(self, url: str, mode: str, max_height: int, audio_format: str) -> Job:
        job = Job(id=secrets.token_hex(8), url=url, mode=mode, max_height=max_height, audio_format=audio_format)
        with self._lock:
            self._purge_locked()
            self._jobs[job.id] = job
        return dataclasses.replace(job)

    def get(self, job_id: str) -> Job:
        if not JOB_ID_RE.match(job_id):
            raise APIError(400, "অবৈধ job id")
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                raise APIError(404, "job পাওয়া যায়নি")
            return dataclasses.replace(job, log_tail=list(job.log_tail))

    def mutate(self, job_id: str, **changes: Any) -> None:
        with self._lock:
            job = self._jobs[job_id]
            for key, value in changes.items():
                setattr(job, key, value)
            job.updated_at = utcnow()

    def append_log(self, job_id: str, line: str) -> None:
        cleaned = ANSI_RE.sub("", line).strip()
        if not cleaned:
            return
        with self._lock:
            job = self._jobs[job_id]
            job.log_tail.append(cleaned[-500:])
            del job.log_tail[:-40]
            job.updated_at = utcnow()

    def counts(self) -> dict[str, int]:
        with self._lock:
            self._purge_locked()
            counts = {"queued": 0, "running": 0, "done": 0, "error": 0}
            for job in self._jobs.values():
                counts[job.status] = counts.get(job.status, 0) + 1
            counts["total"] = len(self._jobs)
            return counts

    def file_for(self, job_id: str) -> tuple[Path, str, int]:
        job = self.get(job_id)
        if job.status != "done" or not job.file_path:
            raise APIError(404, "ফাইল এখনো তৈরি হয়নি")
        path = Path(job.file_path)
        if not path.exists() or not path.is_file():
            raise APIError(404, "ফাইলটি সার্ভারে নেই বা মেয়াদ শেষ")
        return path, job.filename or path.name, path.stat().st_size

    def _purge_locked(self) -> None:
        now = utcnow()
        old_ids: list[str] = []
        for job_id, job in self._jobs.items():
            finished = job.finished_at or job.updated_at
            if job.status in {"done", "error"} and (now - finished).total_seconds() > self.cleanup_after:
                old_ids.append(job_id)
        for job_id in old_ids:
            job = self._jobs.pop(job_id, None)
            if job and job.file_path:
                with contextlib.suppress(OSError):
                    Path(job.file_path).unlink()


def is_forbidden_host(host: str) -> bool:
    normalized = host.strip("[]").strip().lower().rstrip(".")
    if not normalized or normalized in PRIVATE_HOSTNAMES or normalized.endswith(".local"):
        return True
    try:
        ip = ipaddress.ip_address(normalized)
    except ValueError:
        return False
    return any(
        [
            ip.is_private,
            ip.is_loopback,
            ip.is_link_local,
            ip.is_multicast,
            ip.is_reserved,
            ip.is_unspecified,
        ]
    )


def first_url_from_text(text: str) -> str:
    match = URL_RE.search(text or "")
    if not match:
        raise APIError(400, "শেয়ার করা ডাটায় কোনো http/https URL পাওয়া যায়নি")
    return match.group(0).rstrip(".,)];")


def validate_media_url(raw: Any) -> str:
    if not isinstance(raw, str):
        raise APIError(400, "URL দিতে হবে")
    url = raw.strip()
    if not url:
        raise APIError(400, "URL খালি রাখা যাবে না")
    if not url.lower().startswith(("http://", "https://")):
        url = first_url_from_text(url)
    if len(url) > MAX_URL_LEN:
        raise APIError(400, "URL খুব বড়")
    if "\r" in url or "\n" in url:
        raise APIError(400, "URL-এ অবৈধ অক্ষর আছে")
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise APIError(400, "শুধু http/https ভিডিও URL সাপোর্টেড")
    if is_forbidden_host(parsed.hostname or ""):
        raise APIError(400, "লোকাল/প্রাইভেট নেটওয়ার্ক URL অনুমোদিত নয়")
    return url


def sanitize_filename(value: str, fallback: str = "download") -> str:
    value = html.unescape(value or "").strip()
    value = re.sub(r"[\\/:*?\"<>|\x00-\x1f]+", "_", value)
    value = re.sub(r"\s+", " ", value).strip(" ._")
    if not value:
        value = fallback
    return value[:120]


def ascii_filename(value: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", value or "download")
    safe = safe.strip("._") or "download"
    return safe[:120]


def parse_json_bytes(raw: bytes) -> dict[str, Any]:
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise APIError(400, "JSON body সঠিক নয়")
    if not isinstance(data, dict):
        raise APIError(400, "JSON object দিতে হবে")
    return data


def ytdlp_common_args(config: Config, spec: dict[str, Any] | None = None) -> list[str]:
    args = [config.ytdlp_bin]
    manifest_args = dig(spec or {}, "ytdlp", "common_args")
    if isinstance(manifest_args, list) and manifest_args:
        args.extend(str(x) for x in manifest_args)
    else:
        args.extend(["--no-playlist", "--no-warnings", "--socket-timeout", "20"])
    if config.ffmpeg_location:
        args.extend(["--ffmpeg-location", config.ffmpeg_location])
    return args


def summarize_formats(info: dict[str, Any]) -> dict[str, Any]:
    heights: set[int] = set()
    combined: list[dict[str, Any]] = []
    audio_only = False
    for fmt in info.get("formats") or []:
        if not isinstance(fmt, dict):
            continue
        vcodec = fmt.get("vcodec")
        acodec = fmt.get("acodec")
        height = fmt.get("height")
        if isinstance(height, int) and vcodec and vcodec != "none":
            heights.add(height)
        if vcodec and vcodec != "none" and acodec and acodec != "none":
            combined.append(
                {
                    "format_id": fmt.get("format_id"),
                    "height": height,
                    "ext": fmt.get("ext"),
                    "filesize": fmt.get("filesize") or fmt.get("filesize_approx"),
                    "note": fmt.get("format_note") or fmt.get("resolution"),
                }
            )
        if (not vcodec or vcodec == "none") and acodec and acodec != "none":
            audio_only = True
    suggested = [h for h in (144, 240, 360, 480, 720, 1080) if h in heights]
    if heights and not suggested:
        suggested = sorted(heights)[:8]
    return {"heights": sorted(heights), "suggested_heights": suggested, "combined_formats": combined[:20], "audio_only_available": audio_only}


def sanitize_ytdlp_format(fmt: dict[str, Any], include_urls: bool = False) -> dict[str, Any]:
    allowed = [
        "format_id",
        "format_note",
        "ext",
        "protocol",
        "acodec",
        "vcodec",
        "width",
        "height",
        "fps",
        "tbr",
        "abr",
        "vbr",
        "filesize",
        "filesize_approx",
        "resolution",
        "dynamic_range",
        "audio_ext",
        "video_ext",
    ]
    item = {key: fmt.get(key) for key in allowed if fmt.get(key) is not None}
    if include_urls and isinstance(fmt.get("url"), str) and fmt["url"].startswith(("http://", "https://")):
        item["url"] = fmt["url"]
        item["http_headers"] = fmt.get("http_headers") or {}
    return item


def sanitize_ytdlp_info(info: dict[str, Any], include_urls: bool = False) -> dict[str, Any]:
    formats = [sanitize_ytdlp_format(fmt, include_urls=include_urls) for fmt in (info.get("formats") or []) if isinstance(fmt, dict)]
    return {
        "id": info.get("id"),
        "title": info.get("title"),
        "uploader": info.get("uploader") or info.get("channel"),
        "channel_id": info.get("channel_id"),
        "duration": info.get("duration"),
        "thumbnail": info.get("thumbnail"),
        "webpage_url": info.get("webpage_url"),
        "extractor": info.get("extractor_key") or info.get("extractor"),
        "availability": info.get("availability"),
        "is_live": bool(info.get("is_live")),
        "formats": formats[:120],
        "summary": summarize_formats(info),
    }


def run_ytdlp_extract(url: str, config: Config, spec: dict[str, Any] | None = None, include_urls: bool = False) -> dict[str, Any]:
    extract_args = dig(spec or {}, "ytdlp", "extract_args")
    cmd = ytdlp_common_args(config, spec) + ([str(x) for x in extract_args] if isinstance(extract_args, list) else ["--dump-single-json", "--skip-download"]) + [url]
    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=config.metadata_timeout)
    except FileNotFoundError:
        raise APIError(503, "yt-dlp ইনস্টল করা নেই বা YTDLP_BIN ভুল")
    except subprocess.TimeoutExpired:
        raise APIError(504, "মেটাডাটা/লিংক extract করতে টাইমআউট হয়েছে")
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "yt-dlp ব্যর্থ হয়েছে").strip().splitlines()[-1]
        raise APIError(502, err[:500])
    try:
        info = json.loads(proc.stdout)
    except json.JSONDecodeError:
        raise APIError(502, "yt-dlp থেকে অপ্রত্যাশিত JSON এসেছে")
    return sanitize_ytdlp_info(info, include_urls=include_urls)


def run_ytdlp_search(query: str, config: Config, spec: dict[str, Any] | None = None, limit: int = 10) -> dict[str, Any]:
    query = (query or "").strip()
    if not query:
        raise APIError(400, "search query দিতে হবে")
    limit = max(1, min(limit, 25))
    search_args = dig(spec or {}, "ytdlp", "search_args")
    cmd = ytdlp_common_args(config, spec) + ([str(x) for x in search_args] if isinstance(search_args, list) else ["--dump-json", "--skip-download"]) + [f"ytsearch{limit}:{query}"]
    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=config.metadata_timeout)
    except FileNotFoundError:
        raise APIError(503, "yt-dlp ইনস্টল করা নেই বা YTDLP_BIN ভুল")
    except subprocess.TimeoutExpired:
        raise APIError(504, "yt-dlp search টাইমআউট হয়েছে")
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "yt-dlp search ব্যর্থ হয়েছে").strip().splitlines()[-1]
        raise APIError(502, err[:500])
    items = []
    for line in proc.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        with contextlib.suppress(json.JSONDecodeError):
            info = json.loads(line)
            video_id = info.get("id")
            if isinstance(video_id, str) and VIDEO_ID_RE.match(video_id):
                items.append(
                    {
                        "type": "video",
                        "id": video_id,
                        "video_id": video_id,
                        "title": info.get("title"),
                        "url": info.get("webpage_url") or f"https://www.youtube.com/watch?v={video_id}",
                        "channel": info.get("uploader") or info.get("channel"),
                        "channel_id": info.get("channel_id"),
                        "duration": info.get("duration"),
                        "views": info.get("view_count"),
                        "thumbnail": info.get("thumbnail"),
                    }
                )
    return {"items": items, "continuation": "", "query": query, "result_type": "video", "fallback": "yt-dlp"}


def run_metadata(url: str, config: Config, spec: dict[str, Any] | None = None) -> dict[str, Any]:
    info = run_ytdlp_extract(url, config, spec=spec, include_urls=False)
    return {
        "id": info.get("id"),
        "title": info.get("title"),
        "uploader": info.get("uploader"),
        "duration": info.get("duration"),
        "thumbnail": info.get("thumbnail"),
        "webpage_url": info.get("webpage_url") or url,
        "extractor": info.get("extractor"),
        "availability": info.get("availability"),
        "is_live": bool(info.get("is_live")),
        "formats": info.get("summary"),
    }


def build_download_command(job: Job, config: Config, spec: dict[str, Any] | None = None) -> list[str]:
    output_template = str(config.download_dir / f"{job.id}.%(ext)s")
    download_args = dig(spec or {}, "ytdlp", "download_args")
    args = ytdlp_common_args(config, spec) + ([str(x) for x in download_args] if isinstance(download_args, list) else ["--newline", "--restrict-filenames", "--no-part"])
    args.extend(["--paths", str(config.download_dir), "-o", output_template])
    if job.mode == "audio":
        audio_quality = str(dig(spec or {}, "ytdlp", "audio_quality") or "0")
        args.extend(["-x", "--audio-format", job.audio_format, "--audio-quality", audio_quality])
    else:
        selectors = dig(spec or {}, "ytdlp", "format_selectors") or {}
        if job.max_height > 0:
            selector_template = selectors.get("kaios_video_mp4_height") or DEFAULT_VIDEO_SELECTOR_HEIGHT
            selector = str(selector_template).replace("{height}", str(job.max_height))
        else:
            selector = selectors.get("kaios_video_mp4_best") or DEFAULT_VIDEO_SELECTOR_BEST
        merge_format = str(dig(spec or {}, "ytdlp", "merge_output_format") or "mp4")
        remux_video = str(dig(spec or {}, "ytdlp", "remux_video") or "mp4")
        args.extend(["-f", selector, "--merge-output-format", merge_format, "--remux-video", remux_video])
    args.append(job.url)
    return args


def infer_public_filename(job: Job, path: Path) -> str:
    base = sanitize_filename(job.title, f"download-{job.id}")
    ext = path.suffix or (".mp3" if job.mode == "audio" else ".mp4")
    if not ext.startswith("."):
        ext = "." + ext
    if not base.lower().endswith(ext.lower()):
        base += ext
    return base


def find_output_file(download_dir: Path, job_id: str) -> Path | None:
    candidates = []
    for path in download_dir.glob(f"{job_id}.*"):
        if path.suffix in {".part", ".ytdl", ".temp"}:
            continue
        if path.is_file():
            candidates.append(path)
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


def parse_range_header(header: str, size: int) -> tuple[int, int] | None:
    """Parse a single HTTP byte range and return (start, end) inclusive."""
    if not header or not header.startswith("bytes=") or size <= 0:
        return None
    spec = header[6:].strip()
    if "," in spec or "-" not in spec:
        return None
    start_s, end_s = spec.split("-", 1)
    try:
        if start_s == "":
            suffix = int(end_s)
            if suffix <= 0:
                return None
            return max(0, size - suffix), size - 1
        start = int(start_s)
        end = int(end_s) if end_s else size - 1
    except ValueError:
        return None
    if start < 0 or end < start or start >= size:
        return None
    return start, min(end, size - 1)


def copy_bytes(src: BinaryIO, dst: BinaryIO, count: int, chunk_size: int = 256 * 1024) -> None:
    remaining = count
    while remaining > 0:
        chunk = src.read(min(chunk_size, remaining))
        if not chunk:
            break
        dst.write(chunk)
        remaining -= len(chunk)


class DownloadWorker:
    def __init__(self, config: Config, jobs: JobStore, spec_store: APISpecStore):
        self.config = config
        self.jobs = jobs
        self.spec_store = spec_store
        self.semaphore = threading.BoundedSemaphore(config.max_concurrent)

    def enqueue(self, job: Job) -> None:
        thread = threading.Thread(target=self._run, args=(job.id,), name=f"ytdlp-job-{job.id}", daemon=True)
        thread.start()

    def _run(self, job_id: str) -> None:
        acquired = False
        proc: subprocess.Popen[str] | None = None
        try:
            self.semaphore.acquire()
            acquired = True
            job = self.jobs.get(job_id)
            self.jobs.mutate(job_id, status="running", progress=0.0)
            cmd = build_download_command(job, self.config, self.spec_store.get())
            started = time.monotonic()
            try:
                proc = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1,
                    cwd=str(ROOT),
                    start_new_session=True,
                )
            except FileNotFoundError:
                raise APIError(503, "yt-dlp ইনস্টল করা নেই বা YTDLP_BIN ভুল")

            assert proc.stdout is not None
            title_candidates: list[str] = []
            for line in proc.stdout:
                self.jobs.append_log(job_id, line)
                if "[download] Destination:" in line or "[Merger] Merging formats into" in line:
                    title_candidates.append(line.rsplit(":", 1)[-1].strip().strip('"'))
                match = PERCENT_RE.search(line)
                if match:
                    pct = max(0.0, min(100.0, float(match.group("pct"))))
                    self.jobs.mutate(job_id, progress=pct)
                if time.monotonic() - started > self.config.job_timeout:
                    with contextlib.suppress(ProcessLookupError):
                        os.killpg(proc.pid, signal.SIGTERM)
                    raise APIError(504, "ডাউনলোড টাইমআউট হয়েছে")
            rc = proc.wait(timeout=5)
            if rc != 0:
                latest = self.jobs.get(job_id).log_tail[-1:] or ["yt-dlp ডাউনলোড ব্যর্থ হয়েছে"]
                raise APIError(502, latest[0][:500])
            path = find_output_file(self.config.download_dir, job_id)
            if not path:
                raise APIError(502, "ডাউনলোড শেষ হলেও আউটপুট ফাইল পাওয়া যায়নি")
            title = Path(title_candidates[-1]).stem if title_candidates else f"download-{job_id}"
            public_name = infer_public_filename(dataclasses.replace(job, title=title), path)
            self.jobs.mutate(
                job_id,
                status="done",
                progress=100.0,
                title=title,
                filename=public_name,
                file_path=str(path),
                file_size=path.stat().st_size,
                finished_at=utcnow(),
            )
        except APIError as exc:
            self.jobs.mutate(job_id, status="error", error=exc.message, finished_at=utcnow())
        except Exception as exc:  # pragma: no cover - safety net for production workers
            self.jobs.mutate(job_id, status="error", error=str(exc)[:500], finished_at=utcnow())
        finally:
            if proc and proc.poll() is None:
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(proc.pid, signal.SIGTERM)
            if acquired:
                self.semaphore.release()


class KaiOSYTDLPHandler(BaseHTTPRequestHandler):
    server_version = "KaiOSYTDLP/1.3"

    # These attributes are attached by make_handler().
    config: Config
    api_spec: APISpecStore
    innertube: InnerTubeClient
    jobs: JobStore
    worker: DownloadWorker

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("%s - - [%s] %s\n" % (self.client_address[0], self.log_date_time_string(), fmt % args))

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", self.config.cors_origin)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        try:
            self.route_get(head_only=False)
        except APIError as exc:
            self.send_json({"ok": False, "error": exc.message}, exc.status)
        except Exception as exc:  # pragma: no cover - production guard
            self.send_json({"ok": False, "error": str(exc)}, 500)

    def do_HEAD(self) -> None:  # noqa: N802
        try:
            self.route_get(head_only=True)
        except APIError as exc:
            self.send_json({"ok": False, "error": exc.message}, exc.status, head_only=True)
        except Exception as exc:  # pragma: no cover - production guard
            self.send_json({"ok": False, "error": str(exc)}, 500, head_only=True)

    def do_POST(self) -> None:  # noqa: N802
        try:
            self.route_post()
        except APIError as exc:
            self.send_json({"ok": False, "error": exc.message}, exc.status)
        except Exception as exc:  # pragma: no cover - production guard
            self.send_json({"ok": False, "error": str(exc)}, 500)

    def route_get(self, head_only: bool = False) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path == "/status":
            spec_public = self.api_spec.public()
            manifest = spec_public.get("manifest") or {}
            self.send_json(
                {
                    "ok": True,
                    "service": "kaios-ytdlp",
                    "version": "1.3",
                    "target_kaios": "2.5",
                    "time": iso(utcnow()),
                    "auth_enabled": bool(self.config.access_token),
                    "jobs": self.jobs.counts(),
                    "yt_dlp_found": shutil.which(self.config.ytdlp_bin) is not None,
                    "ffmpeg_found": shutil.which("ffmpeg") is not None,
                    "flow": "kaios-2.5-browser-share",
                    "api_manifest_version": manifest.get("version"),
                    "api_manifest_source": spec_public.get("source"),
                    "innertube": self.innertube.state(),
                    "ytdlp_auto_update": self.config.ytdlp_auto_update,
                },
                head_only=head_only,
            )
            return
        if path == "/api/manifest":
            self.require_auth(parsed)
            self.send_json({"ok": True, **self.api_spec.public()}, head_only=head_only)
            return
        if path.startswith("/api/jobs/"):
            self.require_auth(parsed)
            job_id = path.rsplit("/", 1)[-1]
            include_log = urllib.parse.parse_qs(parsed.query).get("log", [""])[0] == "1"
            self.send_json({"ok": True, "job": self.jobs.get(job_id).public(include_log=include_log)}, head_only=head_only)
            return
        if path.startswith("/api/files/"):
            self.require_auth(parsed, allow_query_token=True)
            job_id = path.rsplit("/", 1)[-1]
            self.send_file(job_id, head_only=head_only)
            return
        self.serve_static(path, head_only=head_only)

    def route_post(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        allowed = {"/api/resolve", "/api/jobs", "/api/extract", "/api/yt/search", "/api/yt/channel", "/api/yt/player"}
        if parsed.path not in allowed:
            raise APIError(404, "রুট পাওয়া যায়নি")
        self.require_auth(parsed)
        payload = self.read_json()

        if parsed.path == "/api/yt/search":
            query = str(payload.get("query") or "").strip()
            result_type = str(payload.get("type") or payload.get("result_type") or "video").strip().lower()
            limit = max(1, min(body_int(payload, "limit", 10), 50))
            try:
                results = self.innertube.search(query, result_type=result_type, limit=limit)
            except APIError as inner_exc:
                if result_type not in {"video", "all"}:
                    raise
                try:
                    results = run_ytdlp_search(query, self.config, self.api_spec.get(), limit=limit)
                    results["innertube_error"] = inner_exc.message
                except APIError as ytdlp_exc:
                    raise APIError(502, f"{inner_exc.message}; yt-dlp fallback: {ytdlp_exc.message}")
            self.send_json({"ok": True, "results": results})
            return

        if parsed.path == "/api/yt/channel":
            ref = str(payload.get("channel") or payload.get("channel_id") or payload.get("handle") or payload.get("url") or "").strip()
            limit = max(1, min(body_int(payload, "limit", 20), 50))
            self.send_json({"ok": True, "results": self.innertube.channel(ref, limit=limit)})
            return

        if parsed.path == "/api/yt/player":
            ref = str(payload.get("video_id") or payload.get("url") or "").strip()
            include_urls = bool(payload.get("include_urls"))
            self.send_json({"ok": True, "info": self.innertube.player(ref, include_urls=include_urls)})
            return

        url = validate_media_url(payload.get("url"))
        if parsed.path == "/api/extract":
            include_urls = bool(payload.get("include_urls"))
            self.send_json({"ok": True, "info": run_ytdlp_extract(url, self.config, self.api_spec.get(), include_urls=include_urls)})
            return
        if parsed.path == "/api/resolve":
            self.send_json({"ok": True, "info": run_metadata(url, self.config, self.api_spec.get())})
            return
        if parsed.path == "/api/jobs":
            mode = str(payload.get("mode") or "video").lower()
            if mode not in {"video", "audio"}:
                raise APIError(400, "mode video বা audio হতে হবে")
            max_height = body_int(payload, "max_height", 360)
            if max_height not in SAFE_HEIGHTS:
                raise APIError(400, "max_height: 144/240/360/480/720/1080 অথবা 0 দিন")
            audio_format = str(payload.get("audio_format") or "m4a").lower()
            spec_formats = dig(self.api_spec.get(), "ytdlp", "safe_audio_formats")
            safe_formats = set(spec_formats) if isinstance(spec_formats, list) else SAFE_AUDIO_FORMATS
            if audio_format not in safe_formats:
                raise APIError(400, "audio_format m4a/mp3/opus/ogg/wav হতে হবে")
            job = self.jobs.create(url, mode, max_height, audio_format)
            self.worker.enqueue(job)
            self.send_json({"ok": True, "job": job.public()}, 202)
            return

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length") or "0")
        if length <= 0:
            raise APIError(400, "JSON body দিতে হবে")
        if length > MAX_BODY_BYTES:
            raise APIError(413, "রিকোয়েস্ট body খুব বড়")
        return parse_json_bytes(self.rfile.read(length))

    def require_auth(self, parsed: urllib.parse.ParseResult, allow_query_token: bool = False) -> None:
        if not self.config.access_token:
            return
        expected = self.config.access_token
        auth = self.headers.get("Authorization", "")
        if auth == f"Bearer {expected}":
            return
        if allow_query_token:
            token = urllib.parse.parse_qs(parsed.query).get("token", [""])[0]
            if token == expected:
                return
        raise APIError(401, "Authorization token প্রয়োজন")

    def send_json(self, data: dict[str, Any], status: int = 200, head_only: bool = False) -> None:
        raw = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        if not head_only:
            self.wfile.write(raw)

    def send_file(self, job_id: str, head_only: bool = False) -> None:
        path, filename, size = self.jobs.file_for(job_id)
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        byte_range = parse_range_header(self.headers.get("Range", ""), size)
        if self.headers.get("Range") and byte_range is None:
            self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
            self.send_header("Content-Range", f"bytes */{size}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        start, end = byte_range if byte_range else (0, size - 1)
        length = max(0, end - start + 1)
        self.send_response(HTTPStatus.PARTIAL_CONTENT if byte_range else HTTPStatus.OK)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        if byte_range:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        disposition = 'attachment; filename="%s"; filename*=UTF-8\'\'%s' % (ascii_filename(filename), urllib.parse.quote(filename))
        self.send_header("Content-Disposition", disposition)
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        if head_only:
            return
        with path.open("rb") as fh:
            fh.seek(start)
            copy_bytes(fh, self.wfile, length)

    def serve_static(self, request_path: str, head_only: bool = False) -> None:
        if request_path in {"", "/"}:
            request_path = "/index.html"
        if request_path == "/manifest.webapp":
            local = STATIC_DIR / "manifest.webapp"
        else:
            normalized = posixpath.normpath(urllib.parse.unquote(request_path)).lstrip("/")
            if normalized.startswith("../") or normalized == "..":
                raise APIError(404, "ফাইল পাওয়া যায়নি")
            local = STATIC_DIR / normalized
        try:
            resolved = local.resolve()
        except OSError:
            raise APIError(404, "ফাইল পাওয়া যায়নি")
        if not str(resolved).startswith(str(STATIC_DIR.resolve())) or not resolved.is_file():
            raise APIError(404, "ফাইল পাওয়া যায়নি")
        if resolved.name == "manifest.webapp":
            ctype = "application/x-web-app-manifest+json"
        else:
            ctype = mimetypes.guess_type(resolved.name)[0] or "application/octet-stream"
        raw = resolved.read_bytes()
        add_charset = ctype.startswith("text/") or ctype in {"application/javascript", "application/json", "application/x-web-app-manifest+json"}
        self.send_response(200)
        self.send_header("Content-Type", ctype + ("; charset=utf-8" if add_charset else ""))
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        if not head_only:
            self.wfile.write(raw)


def make_handler(config: Config, api_spec: APISpecStore, innertube: InnerTubeClient, jobs: JobStore, worker: DownloadWorker) -> type[KaiOSYTDLPHandler]:
    class Handler(KaiOSYTDLPHandler):
        pass

    Handler.config = config
    Handler.api_spec = api_spec
    Handler.innertube = innertube
    Handler.jobs = jobs
    Handler.worker = worker
    return Handler


def ensure_runtime(config: Config) -> None:
    config.download_dir.mkdir(parents=True, exist_ok=True)
    marker = config.download_dir / ".gitignore"
    if not marker.exists():
        marker.write_text("*\n!.gitignore\n", encoding="utf-8")


def update_ytdlp_once(config: Config) -> None:
    if not config.ytdlp_auto_update:
        return
    if not shutil.which(config.ytdlp_bin):
        print(f"⚠️ yt-dlp auto-update skipped: {config.ytdlp_bin!r} PATH-এ নেই", flush=True)
        return
    cmd = [config.ytdlp_bin, "-U"] if config.ytdlp_update_channel == "stable" else [config.ytdlp_bin, "--update-to", config.ytdlp_update_channel]
    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=180)
        tail = (proc.stdout or "").strip().splitlines()[-3:]
        print("🔄 yt-dlp auto-update: " + " | ".join(tail or [f"exit={proc.returncode}"]), flush=True)
    except Exception as exc:
        print(f"⚠️ yt-dlp auto-update ব্যর্থ: {exc}", flush=True)


def start_ytdlp_update_scheduler(config: Config) -> None:
    if not config.ytdlp_auto_update:
        return

    def loop() -> None:
        update_ytdlp_once(config)
        while True:
            time.sleep(config.ytdlp_update_interval)
            update_ytdlp_once(config)

    threading.Thread(target=loop, name="ytdlp-auto-updater", daemon=True).start()


def main() -> int:
    config = Config.from_env()
    ensure_runtime(config)
    api_spec = APISpecStore(config.api_manifest_path, config.api_manifest_url, config.api_manifest_refresh)
    innertube = InnerTubeClient(api_spec, bootstrap_ttl=config.innertube_bootstrap_ttl)
    jobs = JobStore(config.download_dir, config.cleanup_after)
    worker = DownloadWorker(config, jobs, api_spec)
    start_ytdlp_update_scheduler(config)
    handler = make_handler(config, api_spec, innertube, jobs, worker)
    server = ThreadingHTTPServer((config.host, config.port), handler)
    server.daemon_threads = True
    print(f"🚀 KaiOS yt-dlp backend চলছে: http://{config.host}:{config.port}", flush=True)
    print("📲 Target: KaiOS 2.5 | Flow: Browser → Share → Premium Downloader → video/audio download", flush=True)
    print(f"🧩 Raw API manifest: {api_spec.public().get('source')}", flush=True)
    print("⚠️  কেবল নিজের/অনুমতিপ্রাপ্ত/লাইসেন্সড কনটেন্ট ডাউনলোডে ব্যবহার করুন।", flush=True)
    if not shutil.which(config.ytdlp_bin):
        print(f"⚠️  {config.ytdlp_bin!r} PATH-এ পাওয়া যায়নি — Dockerfile বা pip install yt-dlp ব্যবহার করুন।", flush=True)
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        print("\n🛑 বন্ধ করা হচ্ছে...", flush=True)
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
