import argparse
import hashlib
import io
import json
from pathlib import Path
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
GOOGLE = "https://raw.githubusercontent.com/google/fonts/5297014cc3f0048aa4bbef1e6a246833f4ccc93c/ofl"
FONTS = [
    ("InterVariable.ttf", f"{GOOGLE}/inter/Inter%5Bopsz,wght%5D.ttf", f"{GOOGLE}/inter/OFL.txt"),
    ("Archivo-VF.ttf", f"{GOOGLE}/archivo/Archivo%5Bwdth,wght%5D.ttf", f"{GOOGLE}/archivo/OFL.txt"),
    ("JetBrainsMono-VF.ttf", f"{GOOGLE}/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf", f"{GOOGLE}/jetbrainsmono/OFL.txt"),
    ("InstrumentSerif-Regular.ttf", f"{GOOGLE}/instrumentserif/InstrumentSerif-Regular.ttf", f"{GOOGLE}/instrumentserif/OFL.txt"),
    ("NotoSansSC-VF.ttf", f"{GOOGLE}/notosanssc/NotoSansSC%5Bwght%5D.ttf", f"{GOOGLE}/notosanssc/OFL.txt"),
    ("NotoSerifSC-Bold.otf", "https://raw.githubusercontent.com/notofonts/noto-cjk/9b0f1436e455d902de067a2501422e5dc71ad16b/Serif/OTF/SimplifiedChinese/NotoSerifCJKsc-Bold.otf", "https://raw.githubusercontent.com/notofonts/noto-cjk/9b0f1436e455d902de067a2501422e5dc71ad16b/Serif/LICENSE"),
    ("SmileySans-Oblique.ttf", "https://github.com/atelier-anchor/smiley-sans/releases/download/v2.0.1/smiley-sans-v2.0.1.zip", "https://raw.githubusercontent.com/atelier-anchor/smiley-sans/v2.0.1/LICENSE"),
    ("LXGWWenKai-Regular.ttf", "https://github.com/lxgw/LxgwWenKai/releases/download/v1.522/LXGWWenKai-Regular.ttf", "https://raw.githubusercontent.com/lxgw/LxgwWenKai/v1.522/OFL.txt"),
    ("LXGWNeoXiHei.ttf", "https://github.com/lxgw/LxgwNeoXiHei/releases/download/v1.305/LXGWNeoXiHei.ttf", "https://raw.githubusercontent.com/lxgw/LxgwNeoXiHei/v1.305/LICENSE.md"),
]

def download(url):
    request = urllib.request.Request(url, headers={"User-Agent": "ai-cut-studio-setup"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()

def digest(data):
    return hashlib.sha256(data).hexdigest()

def main():
    parser = argparse.ArgumentParser(description="Install pinned OFL fonts and their upstream licenses; requires network only during setup.")
    parser.add_argument("--record-lock", action="store_true")
    args = parser.parse_args()
    path = ROOT / ".devin/fonts.lock.json"
    lock = {} if args.record_lock else json.loads(path.read_text())
    directory = ROOT / "studio/templates/remotion-base/public/fonts"
    directory.mkdir(parents=True, exist_ok=True)
    for name, url, license_url in FONTS:
        file = directory / name
        notice = directory / (name + ".LICENSE.txt")
        expected = lock.get(name, {})
        if file.exists() and notice.exists() and digest(file.read_bytes()) == expected.get("sha256") and digest(notice.read_bytes()) == expected.get("licenseSha256"):
            print(f"Verified {name}", flush=True)
            continue
        data = download(url)
        if url.endswith(".zip"):
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                matches = [entry for entry in archive.namelist() if Path(entry).name == name and not entry.startswith("__MACOSX/")]
                if len(matches) != 1:
                    raise ValueError(f"Expected exactly one {name} in archive")
                data = archive.read(matches[0])
        license_data = download(license_url)
        record = {"url": url, "sha256": digest(data), "licenseUrl": license_url, "licenseSha256": digest(license_data)}
        if not args.record_lock and record != expected:
            raise ValueError(f"Font or license checksum mismatch: {name}")
        lock[name] = record
        file.with_suffix(file.suffix + ".tmp").write_bytes(data)
        file.with_suffix(file.suffix + ".tmp").replace(file)
        notice.write_bytes(license_data)
        print(f"Installed {name}", flush=True)
        if args.record_lock:
            path.write_text(json.dumps(lock, indent=2) + "\n")

if __name__ == "__main__":
    main()
