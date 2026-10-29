"""Shared, content-addressed timed transcripts. No ASR, network or fuzzy matching here."""
import fcntl
import hashlib
import json
import os
import subprocess
import uuid
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'workspace' / 'transcript-cache'

def root():
    p = Path(os.environ.get('TRANSCRIPT_CACHE_ROOT', ROOT)); p.mkdir(parents=True, exist_ok=True); return p

def atomic(path, value):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8'); temp.replace(path)

def _identity_memo(media, stat):
    identity = hashlib.sha256(f'{media}:{stat.st_size}:{stat.st_mtime_ns}:{stat.st_ctime_ns}'.encode()).hexdigest()
    return root() / 'identities' / (identity + '.json')

def known_media_key(media):
    """Memoized PCM key for this exact path/size/mtime/ctime, or None. Never decodes."""
    media = Path(media).resolve()
    try: return json.loads(_identity_memo(media, media.stat()).read_text())['key']
    except (OSError, ValueError, KeyError): return None

def remember_media_key(media, key, expected=None):
    """Record a PCM key computed elsewhere from the identical decode (roughcut_audio single pass).
    expected=(size, mtime_ns, ctime_ns) observed before decoding; refuses if the file changed since."""
    media = Path(media).resolve(); stat = media.stat()
    if expected is not None and tuple(expected) != (stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns): return False
    memo = _identity_memo(media, stat)
    if not memo.exists(): atomic(memo, {'key': key, 'path': str(media)})
    return True

def media_key(media):
    """Decoded mono PCM identity survives container changes and byte-identical audio copies.
    Lossy re-encodes require an explicit, time-aligned alias; duration/name never prove identity.
    """
    media = Path(media).resolve(); stat = media.stat()
    memo = _identity_memo(media, stat)
    if memo.exists(): return json.loads(memo.read_text())['key']
    with subprocess.Popen(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(media), '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as proc:
        digest = hashlib.sha256(); size = 0
        for chunk in iter(lambda: proc.stdout.read(1024 * 1024), b''):
            size += len(chunk); digest.update(chunk)
        if proc.wait() or not size: raise ValueError(f'无法读取音轨，不能核验转写归属：{media}')
    after = media.stat()
    if (stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns): raise ValueError('计算转写身份期间素材已变化')
    key = digest.hexdigest(); atomic(memo, {'key': key, 'path': str(media)}); return key

@contextmanager
def locked(key):
    directory = root() / 'locks'; directory.mkdir(exist_ok=True)
    with (directory / (key + '.lock')).open('a') as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try: yield
        finally: fcntl.flock(f, fcntl.LOCK_UN)

def read(key, speakers=False):
    p = root() / 'records' / (key + ('.speakers' if speakers else '') + '.json')
    if not p.exists(): return None
    try:
        d = json.loads(p.read_text()); validate(d['cues']); return d
    except (ValueError, KeyError, TypeError): return None

def validate(cues):
    if not isinstance(cues, list) or not cues: raise ValueError('转写没有时间码段落')
    for c in cues:
        if not isinstance(c.get('text'), str) or not c['text'].strip() or not (0 <= float(c['start']) < float(c['end'])): raise ValueError('转写段落无效')

def put(key, cues, minute_url='', speakers=False, provenance=None):
    validate(cues)
    d = {'version': 1, 'key': key, 'cues': cues, 'minute_url': minute_url, 'provenance': provenance}
    atomic(root() / 'records' / (key + ('.speakers' if speakers else '') + '.json'), d); return d

def materialize(record, prefix, fmt='srt'):
    prefix = Path(prefix); prefix.parent.mkdir(parents=True, exist_ok=True)
    def stamp(t):
        n=round(float(t)*1000); return f'{n//3600000:02}:{n//60000%60:02}:{n//1000%60:02},{n%1000:03}'
    # Always retain a canonical timed SRT; plain prose is not a reusable alignment source.
    target = prefix.with_name(prefix.name + '.srt')
    target.write_text('\n\n'.join(f'{i+1}\n{stamp(c["start"])} --> {stamp(c["end"])}\n{c["text"]}' for i,c in enumerate(record['cues']))+'\n', encoding='utf-8')
    atomic(prefix.with_name(prefix.name+'-minute.json'), {'minute_url': record.get('minute_url',''), 'transcript_key':record['key'], 'reused':True})
    return {'path': target, 'format':'srt', 'cues':record['cues'], 'minute_url':record.get('minute_url',''), 'reused':True}
