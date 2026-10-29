#!/usr/bin/env python3
"""Acquire a licensed public audio URL and record technical (not listening) evidence.

This helper never searches, purchases, authenticates, or changes an editor document.
Caller-supplied license evidence is preserved; its truth is the researcher's responsibility.
"""
from __future__ import annotations

import argparse
import hashlib
import http.client
import ipaddress
import json
import math
import os
from pathlib import Path
import queue
import re
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import urlencode, urljoin, urlsplit

MAX_BYTES = 128 * 1024 * 1024
MAX_DURATION = 3600
DOWNLOAD_TIMEOUT = 120
FORMATS = "wav,mp3,flac,ogg,mov,aac,aiff,ape,wv,matroska"
FAKE_IP_RANGES = (ipaddress.ip_network("198.18.0.0/15"),
                  ipaddress.ip_network("2001:2::/48"))


def _parse_url(url):
    if not isinstance(url, str) or not url or any(ord(c) < 33 for c in url):
        raise ValueError("invalid public URL")
    try:
        parts = urlsplit(url)
        port = parts.port or (443 if parts.scheme == "https" else 80)
    except ValueError as exc:
        raise ValueError("invalid public URL") from exc
    if (parts.scheme not in ("http", "https") or not parts.hostname
            or parts.username is not None or parts.password is not None
            or port not in (80, 443) or parts.fragment):
        raise ValueError("only direct public HTTP(S) URLs without credentials are allowed")
    hostname = parts.hostname.lower().rstrip(".")
    if hostname == "localhost" or hostname.endswith(".localhost"):
        raise ValueError("private address is forbidden")
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        address = None
    if address is not None and not address.is_global:
        raise ValueError("private or reserved address is forbidden")
    return parts, port


def validate_public_url(url, timeout=10):
    """Resolve and validate every address; returned addresses are used directly."""
    started = time.monotonic()
    parts, port = _parse_url(url)
    results = queue.Queue(maxsize=1)

    def resolve():
        try:
            results.put(socket.getaddrinfo(parts.hostname, port, type=socket.SOCK_STREAM))
        except Exception as exc:
            results.put(exc)

    threading.Thread(target=resolve, daemon=True).start()
    try:
        addresses = results.get(timeout=timeout)
    except queue.Empty as exc:
        raise ValueError("DNS timeout") from exc
    if isinstance(addresses, Exception):
        raise ValueError("cannot resolve download host") from addresses
    hostname = parts.hostname.lower().rstrip(".")
    labels = hostname.split(".")
    public_name = (len(labels) > 1 and all(re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?",
                                                      label) for label in labels)
                   and labels[-1] not in ("localhost", "local", "internal", "lan", "home",
                                          "test", "invalid", "onion"))
    synthetic_only = bool(addresses) and all(
        any(ipaddress.ip_address(item[4][0]) in network for network in FAKE_IP_RANGES)
        for item in addresses)
    if public_name and synthetic_only:
        # Some TUN proxies synthesize benchmark addresses. Never connect to those
        # addresses: resolve independently over certificate-verified, IP-pinned TLS.
        remaining = timeout - (time.monotonic() - started)
        if remaining <= 0:
            raise ValueError("DNS timeout")
        addresses = _resolve_public_doh(hostname, port, remaining)
    if not addresses or any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
        raise ValueError("private or reserved address is forbidden")
    return addresses


class _PinnedConnection(http.client.HTTPConnection):
    """Connect to a validated IP without a second DNS lookup (including for TLS)."""
    def __init__(self, host, port, addresses, timeout, tls):
        super().__init__(host, port, timeout=timeout)
        self.addresses = addresses
        self.tls = tls

    def connect(self):
        # One validated address per attempt keeps connection time bounded.
        family, kind, proto, _, sockaddr = self.addresses[0]
        sock = socket.socket(family, kind, proto)
        sock.settimeout(self.timeout)
        try:
            sock.connect(sockaddr)
            if self.tls:
                sock = ssl.create_default_context().wrap_socket(sock, server_hostname=self.host)
            self.sock = sock
        except Exception:
            sock.close()
            raise


def _resolve_public_doh(hostname, port, timeout):
    """Conservative IPv4 fallback for synthetic-only system DNS; no OS changes.

    Uses Cloudflare's JSON DNS-over-HTTPS endpoint over TLS pinned to 1.1.1.1.
    Redirects, non-success replies, large responses, and private answers fail closed.
    """
    pinned = [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("1.1.1.1", 443))]
    connection = _PinnedConnection("cloudflare-dns.com", 443, pinned, min(5, timeout), True)
    try:
        connection.request("GET", "/dns-query?" + urlencode({"name": hostname, "type": "A"}),
                           headers={"Accept": "application/dns-json",
                                    "Accept-Encoding": "identity", "Connection": "close"})
        with connection.getresponse() as response:
            if response.status != 200:
                raise ValueError("public DNS HTTPS status " + str(response.status))
            body = response.read(65537)
            if len(body) > 65536:
                raise ValueError("public DNS reply exceeds size limit")
        value = json.loads(body)
        if not isinstance(value, dict) or value.get("Status") != 0:
            raise ValueError("public DNS resolution failed")
        answers = value.get("Answer", [])
        if not isinstance(answers, list):
            raise ValueError("invalid public DNS answers")
        addresses = []
        for answer in answers:
            if not isinstance(answer, dict) or answer.get("type") != 1:
                continue
            address = ipaddress.ip_address(answer.get("data", ""))
            if address.version != 4 or not address.is_global:
                raise ValueError("private or reserved public DNS answer is forbidden")
            item = (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "",
                    (str(address), port))
            if item not in addresses:
                addresses.append(item)
        if not addresses:
            raise ValueError("public DNS returned no usable public IPv4 address")
        return addresses
    except (OSError, http.client.HTTPException, json.JSONDecodeError) as exc:
        raise ValueError("public DNS HTTPS lookup failed") from exc
    finally:
        connection.close()


class _Response:
    def __init__(self, connection, response):
        self.connection = connection
        self.response = response
        self.status = response.status
        self.headers = response.headers

    def read(self, size):
        return self.response.read1(size)

    def set_timeout(self, timeout):
        # HTTP/1.0 and Connection: close can transfer socket ownership to response.
        if self.response.fp is not None:
            self.response.fp.raw._sock.settimeout(timeout)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.response.close()
        self.connection.close()


def _request(url, timeout):
    started = time.monotonic()
    parts, port = _parse_url(url)
    addresses = validate_public_url(url, min(10, timeout))
    remaining = timeout - (time.monotonic() - started)
    if remaining <= 0:
        raise ValueError("download timeout")
    connection = _PinnedConnection(parts.hostname, port, addresses, min(15, remaining),
                                   parts.scheme == "https")
    try:
        path = parts.path or "/"
        if parts.query:
            path += "?" + parts.query
        connection.request("GET", path, headers={"User-Agent": "BgmAcquire/1.0",
                                                "Accept-Encoding": "identity",
                                                "Connection": "close"})
        return _Response(connection, connection.getresponse())
    except Exception:
        connection.close()
        raise


def _digest(path):
    sha = hashlib.sha256()
    with Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            sha.update(chunk)
    return sha.hexdigest()


def _run(command, timeout):
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ValueError("audio verification unavailable or timed out") from exc
    if result.returncode:
        raise ValueError("audio verification failed: " + result.stderr[-1600:].strip())
    return result


def measure_audio_level(path, start_seconds=0, duration_seconds=None):
    """Measure the first audio stream after a 20 Hz high-pass, without listening.

    Levels are dBFS measured over the requested interval. Constant-signal detection
    runs before the high-pass so a DC signal's filter transient cannot pass as music.
    This function reports quiet/constant intervals; probe_audio rejects them for BGM.
    """
    path = Path(path).resolve(strict=True)
    if not path.is_file():
        raise ValueError("audio measurement requires a local file")
    for name, value in (("start", start_seconds), ("duration", duration_seconds)):
        if name == "duration" and value is None:
            continue
        if (isinstance(value, bool) or not isinstance(value, (int, float))
                or not math.isfinite(value) or value < 0
                or (name == "duration" and (value == 0 or value > MAX_DURATION))):
            raise ValueError("invalid audio measurement " + name)
    command = ["ffmpeg", "-nostdin", "-v", "info", "-xerror", "-err_detect", "explode",
               "-protocol_whitelist", "file,pipe", "-format_whitelist", FORMATS,
               "-ss", str(start_seconds), "-i", str(path)]
    if duration_seconds is not None:
        command += ["-t", str(duration_seconds)]
    # Output -t alone can stop after the analysis filter already consumed a frame
    # beyond the selected endpoint. Trim samples before collecting statistics.
    filters = (f"atrim=duration={duration_seconds},asetpts=PTS-STARTPTS,"
               if duration_seconds is not None else "")
    filters += "astats=metadata=0:reset=0,highpass=f=20,volumedetect"
    command += ["-map", "0:a:0", "-af", filters, "-f", "null", "-"]
    result = _run(command, 180)
    mean = re.search(r"\bmean_volume:\s*(-?[\d.]+|[-+]?inf)\s+dB", result.stderr)
    peak = re.search(r"\bmax_volume:\s*(-?[\d.]+|[-+]?inf)\s+dB", result.stderr)
    counts = re.findall(r"\bn_samples:\s*(\d+)", result.stderr)
    minimums = re.findall(r"\bMin level:\s*(-?[\d.]+)", result.stderr)
    maximums = re.findall(r"\bMax level:\s*(-?[\d.]+)", result.stderr)
    # The final astats pair describes all channels; preceding pairs are per-channel.
    if not mean or not peak or not counts or int(counts[-1]) <= 0 or not minimums or not maximums:
        raise ValueError("audio measurement has no samples or valid levels")
    if len(minimums) != len(maximums):
        raise ValueError("audio measurement channel statistics are incomplete")
    pairs = list(zip(minimums, maximums))
    channel_pairs = pairs[:-1] if len(pairs) > 1 else pairs
    constant = all(float(low) == float(high) for low, high in channel_pairs)
    mean_db, peak_db = float(mean.group(1)), float(peak.group(1))
    if not math.isfinite(mean_db) or not math.isfinite(peak_db):
        # volumedetect normally reports its 16-bit floor as -91 dBFS.
        raise ValueError("audio measurement is silent or has non-finite levels")
    return {"meanVolumeDb": mean_db, "peakVolumeDb": peak_db,
            "startSeconds": start_seconds, "durationSeconds": duration_seconds,
            "highpassHz": 20, "constantSignal": constant,
            "sampleCount": int(counts[-1]), "tool": "ffmpeg"}


def probe_audio(path):
    """Return SHA, audio duration, ffprobe and full decode evidence for a local file."""
    path = Path(path).resolve(strict=True)
    if not path.is_file() or not 0 < path.stat().st_size <= MAX_BYTES:
        raise ValueError("audio file size exceeds limits or is empty")
    original_sha = _digest(path)
    probe = _run(["ffprobe", "-v", "error", "-protocol_whitelist", "file,pipe",
                  "-format_whitelist", FORMATS, "-show_format", "-show_streams",
                  "-of", "json", str(path)], 30)
    try:
        info = json.loads(probe.stdout)
        streams = [s for s in info.get("streams", []) if s.get("codec_type") == "audio"]
        duration = float(info.get("format", {}).get("duration", 0))
    except (ValueError, TypeError) as exc:
        raise ValueError("invalid audio probe") from exc
    if not streams:
        raise ValueError("file has no audio stream")
    if not math.isfinite(duration) or duration <= 0 or duration > MAX_DURATION:
        raise ValueError("audio duration exceeds limits or is unknown")
    decode = _run(["ffmpeg", "-nostdin", "-v", "error", "-xerror", "-err_detect", "explode",
                   "-protocol_whitelist", "file,pipe", "-format_whitelist", FORMATS,
                   "-i", str(path), "-map", "0:a", "-f", "null", "-"], 180)
    if decode.stderr.strip():
        raise ValueError("audio decode reported errors: " + decode.stderr[-1600:].strip())
    level = measure_audio_level(path)
    if level["constantSignal"] or level["peakVolumeDb"] < -70:
        raise ValueError("audio is silent, constant DC, or inaudible (peak below -70 dBFS)")
    if _digest(path) != original_sha:
        raise ValueError("audio changed during verification")
    return {"sha256": original_sha, "sourceDurationSeconds": duration,
            "meanVolumeDb": level["meanVolumeDb"], "peakVolumeDb": level["peakVolumeDb"],
            "audioLevel": level,
            "technicalProbe": {"passed": True, "formatName": info.get("format", {}).get("format_name"),
                               "audioStreams": streams, "sizeBytes": path.stat().st_size},
            "fullDecode": {"passed": True, "exitCode": decode.returncode,
                           "tool": "ffmpeg", "audioStreams": len(streams)}}


def _validate_candidate(candidate):
    if not isinstance(candidate, dict):
        raise ValueError("candidate must be an object")
    for name in ("id", "title", "artist", "url", "downloadUrl", "licenseUrl", "licenseEvidence"):
        if not isinstance(candidate.get(name), str) or not candidate[name].strip():
            raise ValueError("candidate requires " + name)
    if candidate.get("licenseStatus") != "verified":
        raise ValueError("license must be verified before acquisition")
    if type(candidate.get("attributionRequired")) is not bool:
        raise ValueError("attributionRequired must be a boolean")
    if (not isinstance(candidate.get("credit"), str)
            or (candidate["attributionRequired"] and not candidate["credit"].strip())):
        raise ValueError("required attribution credit is missing")
    for name in ("url", "downloadUrl", "licenseUrl"):
        _parse_url(candidate[name])


def _download(url, path, max_bytes):
    deadline = time.monotonic() + DOWNLOAD_TIMEOUT
    for redirect in range(6):
        _parse_url(url)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise ValueError("download timeout")
        with _request(url, remaining) as response:
            if response.status in (301, 302, 303, 307, 308):
                if redirect == 5 or not response.headers.get("Location"):
                    raise ValueError("download redirect limit or missing location")
                next_url = urljoin(url, response.headers["Location"])
                _parse_url(next_url)
                if urlsplit(url).scheme == "https" and urlsplit(next_url).scheme != "https":
                    raise ValueError("insecure download redirect")
                url = next_url
                continue
            if response.status != 200:
                raise ValueError("download HTTP status " + str(response.status))
            content_type = response.headers.get("Content-Type", "").lower()
            if any(kind in content_type for kind in ("html", "xml", "json")):
                raise ValueError("download is a webpage, not audio")
            if response.headers.get("Content-Encoding", "identity").lower() != "identity":
                raise ValueError("encoded download is unsupported")
            expected = response.headers.get("Content-Length")
            try:
                expected = int(expected) if expected is not None else None
            except ValueError as exc:
                raise ValueError("invalid download length") from exc
            if expected is not None and (expected <= 0 or expected > max_bytes):
                raise ValueError("download size exceeds limits or is empty")
            total = 0
            with path.open("wb") as target:
                while True:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise ValueError("download timeout")
                    if isinstance(response, _Response):
                        response.set_timeout(min(15, remaining))
                    chunk = response.read(min(65536, max_bytes - total + 1))
                    if not chunk:
                        break
                    if total == 0 and chunk.lstrip().lower().startswith((b"<", b"<!doctype")):
                        raise ValueError("download contains HTML/XML")
                    total += len(chunk)
                    if total > max_bytes:
                        raise ValueError("download size exceeds limits")
                    target.write(chunk)
                target.flush()
                os.fsync(target.fileno())
            if total == 0 or (expected is not None and expected != total):
                raise ValueError("truncated or empty audio download")
            return url
    raise ValueError("download redirect limit")


def _atomic_json(path, value):
    fd, temporary = tempfile.mkstemp(prefix=".bgm-result-", suffix=".part", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as target:
            json.dump(value, target, ensure_ascii=False, indent=2)
            target.write("\n")
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def acquire(candidate, out_dir, *, max_bytes=MAX_BYTES):
    _validate_candidate(candidate)
    if type(max_bytes) is not int or not 0 < max_bytes <= MAX_BYTES:
        raise ValueError("invalid size limit")
    out_dir = Path(out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    identity = {key: candidate[key] for key in (
        "id", "title", "artist", "url", "downloadUrl", "licenseStatus",
        "licenseUrl", "licenseEvidence", "credit", "attributionRequired")}
    fingerprint = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
    suffix = Path(urlsplit(candidate["downloadUrl"]).path).suffix.lower()
    if suffix not in (".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac", ".aiff", ".opus"):
        suffix = ".audio"
    audio_path = out_dir / ("bgm-" + fingerprint[:24] + suffix)
    result_path = out_dir / ("bgm-" + fingerprint[:24] + ".json")
    if result_path.is_file() and audio_path.is_file():
        try:
            previous = json.loads(result_path.read_text(encoding="utf-8"))
            fresh = probe_audio(audio_path)
            if (previous.get("candidateFingerprint") == fingerprint
                    and previous.get("sha256") == fresh["sha256"]
                    and audio_path.stat().st_size <= max_bytes):
                result = {**previous, **fresh}
                _atomic_json(result_path, result)
                return result
        except (OSError, ValueError):
            pass
    fd, name = tempfile.mkstemp(prefix=".bgm-", suffix=".part", dir=out_dir)
    os.close(fd)
    temporary = Path(name)
    try:
        final_url = _download(candidate["downloadUrl"], temporary, max_bytes)
        evidence = probe_audio(temporary)
        os.replace(temporary, audio_path)
        result = {**identity, **evidence, "schemaVersion": 1,
                  "candidateFingerprint": fingerprint, "path": str(audio_path),
                  "resultPath": str(result_path), "finalDownloadUrl": final_url,
                  "audition": "not_listened"}
        _atomic_json(result_path, result)
        return result
    except (OSError, http.client.HTTPException) as exc:
        raise ValueError("public audio download failed: " + str(exc)) from exc
    finally:
        temporary.unlink(missing_ok=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    command = commands.add_parser("acquire")
    command.add_argument("--candidate", required=True, type=Path)
    command.add_argument("--out-dir", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        value = acquire(json.loads(args.candidate.read_text(encoding="utf-8")), args.out_dir)
    except (OSError, ValueError) as exc:
        print(json.dumps({"status": "failed", "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1
    print(json.dumps(value, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
