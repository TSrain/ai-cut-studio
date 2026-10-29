import io
import http.client
import json
import math
from pathlib import Path
import socket
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
import wave

from tools import bgm_acquire as bgm


def candidate():
    return {"id": "track-1", "title": "Track", "artist": "Artist",
            "url": "https://example.com/music", "downloadUrl": "https://example.com/track.wav",
            "licenseStatus": "verified", "licenseUrl": "https://example.com/license",
            "licenseEvidence": "Creator grants reuse with attribution.",
            "credit": "Track by Artist", "attributionRequired": True}


class Response(io.BytesIO):
    def __init__(self, body, status=200, headers=None):
        super().__init__(body)
        self.status = status
        self.headers = headers or {"Content-Type": "audio/wav", "Content-Length": str(len(body))}


class BgmAcquireTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.wav = self.root / "test.wav"
        with wave.open(str(self.wav), "wb") as out:
            out.setparams((1, 2, 8000, 0, "NONE", "not compressed"))
            out.writeframes(b"".join(struct.pack("<h", int(6000 * math.sin(2 * math.pi * 440 * i / 8000)))
                                     for i in range(8000)))
        self.body = self.wav.read_bytes()

    def test_probe_has_real_duration_digest_and_decode_receipt(self):
        result = bgm.probe_audio(self.wav)
        self.assertAlmostEqual(result["sourceDurationSeconds"], 1.0, places=3)
        self.assertEqual(len(result["sha256"]), 64)
        self.assertTrue(result["technicalProbe"]["audioStreams"])
        self.assertTrue(result["fullDecode"]["passed"])
        self.assertEqual(result["fullDecode"]["exitCode"], 0)
        self.assertLess(result["meanVolumeDb"], result["peakVolumeDb"])
        self.assertGreater(result["peakVolumeDb"], -20)

    def test_rejects_silence_dc_and_inaudible_peak(self):
        for name, samples in (
                ("silence", [0] * 8000),
                ("dc", [12000] * 8000),
                ("inaudible", [int(2 * math.sin(2 * math.pi * 440 * i / 8000))
                               for i in range(8000)])):
            path = self.root / (name + ".wav")
            with wave.open(str(path), "wb") as out:
                out.setparams((1, 2, 8000, 0, "NONE", "not compressed"))
                out.writeframes(b"".join(struct.pack("<h", sample) for sample in samples))
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "silent|inaudible|constant"):
                bgm.probe_audio(path)

    def test_segment_volume_measured_and_range_validated(self):
        level = bgm.measure_audio_level(self.wav, start_seconds=0.25, duration_seconds=0.5)
        self.assertAlmostEqual(level["meanVolumeDb"], -17.8, delta=0.6)
        self.assertAlmostEqual(level["peakVolumeDb"], -14.7, delta=0.6)
        self.assertEqual(level["startSeconds"], 0.25)
        self.assertEqual(level["durationSeconds"], 0.5)
        self.assertEqual(level["highpassHz"], 20)
        self.assertFalse(level["constantSignal"])
        for start, duration in ((-1, None), (0, 0), (float("nan"), None),
                                (0, float("inf")), (0, -1), (0, 3601)):
            with self.subTest(start=start, duration=duration), self.assertRaises(ValueError):
                bgm.measure_audio_level(self.wav, start_seconds=start, duration_seconds=duration)

    def test_measurement_uses_requested_piece_and_rejects_empty_piece(self):
        path = self.root / "silence-then-tone.wav"
        samples = [0] * 4000 + [
            int(6000 * math.sin(2 * math.pi * 440 * i / 8000)) for i in range(4000)]
        with wave.open(str(path), "wb") as out:
            out.setparams((1, 2, 8000, 0, "NONE", "not compressed"))
            out.writeframes(b"".join(struct.pack("<h", sample) for sample in samples))
        silent = bgm.measure_audio_level(path, 0, 0.4)
        tone = bgm.measure_audio_level(path, 0.6, 0.4)
        self.assertTrue(silent["constantSignal"])
        self.assertLess(silent["peakVolumeDb"], -70)
        self.assertFalse(tone["constantSignal"])
        self.assertGreater(tone["peakVolumeDb"], -20)
        with self.assertRaises(ValueError):
            bgm.measure_audio_level(path, 2, 0.2)

    def test_acquire_atomic_result_and_cache_reverified_without_network(self):
        with patch.object(bgm, "_request", return_value=Response(self.body)):
            result = bgm.acquire(candidate(), self.root / "assets")
        self.assertEqual(Path(result["path"]).read_bytes(), self.body)
        self.assertEqual(result["credit"], "Track by Artist")
        self.assertEqual(result["audition"], "not_listened")
        self.assertEqual(json.loads(Path(result["resultPath"]).read_text()), result)
        with patch.object(bgm, "_request", side_effect=AssertionError("no network")):
            cached = bgm.acquire(candidate(), self.root / "assets")
        self.assertEqual(result["sha256"], cached["sha256"])
        Path(result["path"]).write_bytes(b"corrupt")
        with patch.object(bgm, "_request", return_value=Response(self.body)) as request:
            repaired = bgm.acquire(candidate(), self.root / "assets")
        self.assertEqual(request.call_count, 1)
        self.assertEqual(repaired["sha256"], result["sha256"])

    def test_license_gate_precedes_download(self):
        for changed in ({"licenseStatus": "unverified"}, {"licenseEvidence": ""},
                        {"licenseUrl": ""}, {"credit": ""}, {"attributionRequired": "false"}):
            with self.subTest(changed=changed), patch.object(bgm, "_request") as request:
                with self.assertRaises(ValueError):
                    bgm.acquire(candidate() | changed, self.root / "assets")
                request.assert_not_called()

    def test_credit_optional_only_if_explicitly_not_required(self):
        with patch.object(bgm, "_request", return_value=Response(self.body)):
            result = bgm.acquire(candidate() | {"credit": "", "attributionRequired": False},
                                 self.root / "assets")
        self.assertEqual(result["credit"], "")

    def test_html_http_failures_and_truncated_download_rejected(self):
        cases = [
            Response(b"<html>login</html>"),
            Response(self.body, headers={"Content-Type": "text/html"}),
            Response(self.body, status=403),
            Response(self.body, headers={"Content-Length": str(len(self.body) + 1)}),
            Response(b"not audio"),
        ]
        for index, response in enumerate(cases):
            out = self.root / str(index)
            with self.subTest(index=index), patch.object(bgm, "_request", return_value=response):
                with self.assertRaises(ValueError):
                    bgm.acquire(candidate(), out)
            self.assertFalse(list(out.glob("*.json")))
            self.assertFalse(list(out.glob("*.part")))

    def test_byte_limit_and_redirect_limit(self):
        with patch.object(bgm, "_request", return_value=Response(self.body)):
            with self.assertRaisesRegex(ValueError, "size"):
                bgm.acquire(candidate(), self.root / "assets", max_bytes=8)
        with patch.object(bgm, "_request", side_effect=lambda *a: Response(
                b"", 302, {"Location": "https://example.com/loop"})):
            with self.assertRaisesRegex(ValueError, "redirect"):
                bgm.acquire(candidate(), self.root / "assets")

    def test_redirect_rejects_private_address_before_open(self):
        with patch.object(bgm, "_request", return_value=Response(
                b"", 302, {"Location": "http://127.0.0.1/secret"})):
            with self.assertRaises(ValueError):
                bgm.acquire(candidate(), self.root / "assets")

    def test_probe_rejects_truncated_audio_and_no_audio(self):
        broken = self.root / "broken.wav"
        broken.write_bytes(self.body[:-4000])
        with self.assertRaises(ValueError):
            bgm.probe_audio(broken)
        video = self.root / "video.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i",
                        "color=black:s=16x16:d=0.1", "-an", str(video)], check=True)
        with self.assertRaisesRegex(ValueError, "audio"):
            bgm.probe_audio(video)

    def test_public_address_validation_rejects_all_private_families(self):
        for address in ("127.0.0.1", "10.0.0.1", "169.254.169.254", "::1",
                        "fc00::1", "::ffff:127.0.0.1", "192.0.2.1"):
            with self.subTest(address=address), self.assertRaises(ValueError):
                bgm.validate_public_url(f"http://[{address}]/" if ":" in address else f"http://{address}/")
        for url in ("file:///tmp/a", "https://u:p@example.com/a", "http://localhost/a",
                    "http://example.com:22/a"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                bgm.validate_public_url(url)
        with patch.object(socket, "getaddrinfo", return_value=[
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443)),
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))]):
            with self.assertRaises(ValueError):
                bgm.validate_public_url("https://example.com/a")

    def test_fake_ip_dns_falls_back_to_public_answers_only(self):
        fake = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("198.18.0.8", 443)),
                (socket.AF_INET6, socket.SOCK_STREAM, 6, "", ("2001:2::b", 443, 0, 0))]
        public = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]
        with patch.object(socket, "getaddrinfo", return_value=fake), \
                patch.object(bgm, "_resolve_public_doh", return_value=public) as doh:
            self.assertEqual(bgm.validate_public_url("https://example.com/a"), public)
            self.assertEqual(doh.call_args.args[:2], ("example.com", 443))
        with patch.object(socket, "getaddrinfo", return_value=fake), \
                patch.object(bgm, "_resolve_public_doh", return_value=[
                    (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.1", 443))]):
            with self.assertRaises(ValueError):
                bgm.validate_public_url("https://example.com/a")
        private = fake + [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.1", 443))]
        with patch.object(socket, "getaddrinfo", return_value=private), \
                patch.object(bgm, "_resolve_public_doh") as doh:
            with self.assertRaises(ValueError):
                bgm.validate_public_url("https://example.com/a")
            doh.assert_not_called()
        with patch.object(bgm, "_resolve_public_doh") as doh:
            with self.assertRaises(ValueError):
                bgm.validate_public_url("https://198.18.0.8/a")
            doh.assert_not_called()

    def test_doh_fixed_tls_resolver_and_public_answer_validation(self):
        def response(address):
            body = json.dumps({"Status": 0, "Answer": [{"type": 1, "data": address}]}).encode()
            return Response(body, headers={"Content-Type": "application/dns-json"})
        with patch.object(bgm, "_PinnedConnection") as connection:
            connection.return_value.getresponse.return_value = response("93.184.216.34")
            answers = bgm._resolve_public_doh("example.com", 443, 5)
            args = connection.call_args.args
            self.assertEqual(args[0], "cloudflare-dns.com")
            self.assertEqual(args[2][0][4], ("1.1.1.1", 443))
            self.assertTrue(args[4])
            self.assertEqual(answers[0][4], ("93.184.216.34", 443))
        with patch.object(bgm, "_PinnedConnection") as connection:
            connection.return_value.getresponse.return_value = response("127.0.0.1")
            with self.assertRaises(ValueError):
                bgm._resolve_public_doh("example.com", 443, 5)

    def test_http_response_remains_safe_after_last_read_closes_socket(self):
        client, server = socket.socketpair()
        self.addCleanup(client.close)
        self.addCleanup(server.close)
        server.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok")
        response = http.client.HTTPResponse(client)
        response.begin()
        with bgm._Response(Mock(), response) as wrapped:
            wrapped.set_timeout(1)
            self.assertEqual(wrapped.read(10), b"ok")
            wrapped.set_timeout(1)
            self.assertEqual(wrapped.read(10), b"")

    def test_cli_returns_exact_cached_result_path(self):
        data = candidate()
        source = self.root / "candidate.json"
        source.write_text(json.dumps(data))
        with patch.object(bgm, "_request", return_value=Response(self.body)):
            result = bgm.acquire(data, self.root / "assets")
        cli = subprocess.run([sys.executable, str(Path(bgm.__file__)), "acquire",
                              "--candidate", str(source), "--out-dir", str(self.root / "assets")],
                             text=True, capture_output=True, check=True)
        self.assertEqual(json.loads(cli.stdout)["resultPath"], result["resultPath"])
        self.assertEqual(cli.stderr, "")

    def test_pinned_connection_uses_resolved_ip_without_dns_relookup(self):
        addresses = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 80))]
        with patch.object(socket, "socket") as factory, patch.object(socket, "getaddrinfo") as dns:
            connection = bgm._PinnedConnection("example.com", 80, addresses, 2, False)
            connection.connect()
            factory.return_value.connect.assert_called_once_with(("93.184.216.34", 80))
            dns.assert_not_called()


if __name__ == "__main__":
    unittest.main()
