import re
import subprocess
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
paths = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT).decode().split("\0")
checks = {
    "private home path": re.compile(r"/" + r"Users/(?!example(?:/|$)|…)[^/\s]+/"),
    "credential-shaped value": re.compile(r"(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{32,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)"),
    "private workspace service": re.compile(r"https?://[a-zA-Z0-9.-]+\.(?:feishu\.cn|larksuite\.com)/(?:base|docx|wiki|minutes)/[A-Za-z0-9]{10,}"),
}
errors = []
for name in filter(None, paths):
    path = ROOT / name
    if path.is_symlink():
        errors.append((name, "symlink"))
        continue
    if path.name.startswith(".env") or path.suffix in {".secret", ".pem", ".key", ".mp4", ".mov", ".mp3", ".wav"} or "workspace" in path.parts:
        errors.append((name, "private/runtime asset"))
    try:
        text = path.read_text()
    except UnicodeError:
        errors.append((name, "unreviewed binary"))
        continue
    for label, pattern in checks.items():
        if pattern.search(text):
            errors.append((name, label))
for name, label in errors:
    print(f"FAIL {name}: {label}")
print(f"Reviewed {len(list(filter(None, paths)))} tracked paths; {len(errors)} findings. This is a release guard, not a comprehensive security audit.")
sys.exit(bool(errors))
