import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
failed = False
for name in ("node", "npm", "python3", "ffmpeg", "ffprobe"):
    found = shutil.which(name)
    print(f"{'OK' if found else 'MISSING'} {name}")
    failed |= not bool(found)
print(f"Python {sys.version.split()[0]} (requires 3.11+)")
failed |= sys.version_info < (3, 11)
if shutil.which("node"):
    version = subprocess.check_output(["node", "--version"], text=True).strip()
    print(f"Node {version} (requires 22+)")
    failed |= int(version.lstrip("v").split(".")[0]) < 22
for relative in ("studio/templates/remotion-base/node_modules/esbuild", "studio/templates/remotion-base/public/fonts/NotoSansSC-VF.ttf"):
    found = (ROOT / relative).exists()
    print(f"{'OK' if found else 'MISSING'} {relative}")
    failed |= not found
for name in ("codex", "lark-cli"):
    print(f"OPTIONAL {name}: {'available' if shutil.which(name) else 'not installed'}")
print("Local editing needs no AI account. AI workers and cloud transcription require separate opt-in setup.")
sys.exit(1 if failed else 0)
