import json
import tempfile
import unittest
from pathlib import Path

import server


def test_config(tmp: str) -> server.Config:
    return server.Config(
        host="0.0.0.0",
        port=8080,
        download_dir=Path(tmp),
        ytdlp_bin="yt-dlp",
        ffmpeg_location="",
        access_token="",
        cors_origin="*",
        max_concurrent=1,
        metadata_timeout=10,
        job_timeout=60,
        cleanup_after=3600,
        api_manifest_path=Path(tmp) / "api.raw.json",
        api_manifest_url="",
        api_manifest_refresh=3600,
        innertube_bootstrap_ttl=3600,
        ytdlp_auto_update=False,
        ytdlp_update_channel="stable",
        ytdlp_update_interval=43200,
    )


class ValidationTests(unittest.TestCase):
    def test_validate_media_url_accepts_https(self):
        self.assertEqual(server.validate_media_url(" https://example.com/watch?v=1 "), "https://example.com/watch?v=1")

    def test_validate_media_url_extracts_url_from_shared_text(self):
        self.assertEqual(
            server.validate_media_url("দেখুন https://example.com/watch?v=1 share text"),
            "https://example.com/watch?v=1",
        )

    def test_validate_media_url_rejects_non_http(self):
        with self.assertRaises(server.APIError):
            server.validate_media_url("file:///etc/passwd")

    def test_validate_media_url_rejects_localhost(self):
        for value in ["http://localhost/a", "http://127.0.0.1/a", "http://[::1]/a", "http://10.0.0.1/a"]:
            with self.subTest(value=value):
                with self.assertRaises(server.APIError):
                    server.validate_media_url(value)

    def test_video_id_from_url(self):
        self.assertEqual(server.video_id_from_url("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ")
        self.assertEqual(server.video_id_from_url("https://www.youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ")

    def test_sanitize_filename(self):
        self.assertEqual(server.sanitize_filename(' bad:/name?.mp4 '), 'bad_name_.mp4')
        self.assertEqual(server.sanitize_filename(''), 'download')

    def test_ascii_filename_fallback(self):
        self.assertEqual(server.ascii_filename('বাংলা video 01.mp4'), 'video_01.mp4')

    def test_parse_range_header(self):
        self.assertEqual(server.parse_range_header('bytes=0-99', 1000), (0, 99))
        self.assertEqual(server.parse_range_header('bytes=100-', 1000), (100, 999))
        self.assertEqual(server.parse_range_header('bytes=-50', 1000), (950, 999))
        self.assertIsNone(server.parse_range_header('bytes=1000-1001', 1000))


class RawManifestTests(unittest.TestCase):
    def test_raw_api_json_is_valid(self):
        data = json.loads(Path("api.raw.json").read_text(encoding="utf-8"))
        self.assertEqual(data["schema"], "arena.kaios_ytdlp.raw_api.v1")
        self.assertIn("innertube", data)
        self.assertIn("ytdlp", data)
        self.assertIn("ffmpeg", data)

    def test_parse_search_response(self):
        raw = {
            "contents": {
                "twoColumnSearchResultsRenderer": {
                    "primaryContents": {
                        "sectionListRenderer": {
                            "contents": [
                                {"itemSectionRenderer": {"contents": [
                                    {"videoRenderer": {"videoId": "dQw4w9WgXcQ", "title": {"runs": [{"text": "Test Video"}]}}},
                                    {"channelRenderer": {"channelId": "UCaaaaaaaaaaaaaaaaaaaaaa", "title": {"simpleText": "Test Channel"}}},
                                ]}}
                            ]
                        }
                    }
                }
            }
        }
        parsed = server.parse_search_response(raw, limit=5)
        self.assertEqual(parsed["items"][0]["url"], "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        self.assertEqual(parsed["items"][1]["type"], "channel")


class JobStoreTests(unittest.TestCase):
    def test_job_public_done_has_download_url(self):
        with tempfile.TemporaryDirectory() as tmp:
            jobs = server.JobStore(Path(tmp), cleanup_after=3600)
            job = jobs.create("https://example.com/v", "video", 720, "m4a")
            jobs.mutate(job.id, status="done", file_path=str(Path(tmp) / "x.mp4"), filename="x.mp4")
            self.assertEqual(jobs.get(job.id).public()["download_url"], f"/api/files/{job.id}")

    def test_build_download_command_video_contains_manifest_selector(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = test_config(tmp)
            spec = json.loads(Path("api.raw.json").read_text(encoding="utf-8"))
            job = server.Job(id="abcdef1234567890", url="https://example.com/v", mode="video", max_height=720, audio_format="m4a")
            cmd = server.build_download_command(job, cfg, spec)
            self.assertIn("--merge-output-format", cmd)
            selector = cmd[cmd.index("-f") + 1]
            self.assertIn("bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]", selector)
            self.assertIn("bestvideo[height<=720]+bestaudio", selector)


if __name__ == "__main__":
    unittest.main()
