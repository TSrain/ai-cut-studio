#!/usr/bin/env python3
"""Reuse the content workflow's Feishu transcriber, retaining its timestamp/cache rules."""
import importlib.util
import json
import sys
from pathlib import Path
script, audio, prefix, output = map(Path, sys.argv[1:5])
sys.path.insert(0, str(script.resolve().parent))
spec = importlib.util.spec_from_file_location('workflow_transcribe', script)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
if len(sys.argv)>5 and sys.argv[5]=='--register-json':
    import transcript_cache as cache
    raw=json.loads(output.read_text())
    key=cache.media_key(audio)
    with cache.locked(key):
        if not cache.read(key): cache.put(key,raw['cues'],raw.get('minuteUrl',''),provenance={'source':str(audio),'imported':str(output)})
    sys.exit(0)
result = module.transcribe(audio, prefix, fmt='srt')
Path(output).write_text(json.dumps({'cues': result['cues'], 'minuteUrl': result.get('minute_url'), 'reused': result.get('reused',False)}, ensure_ascii=False), encoding='utf-8')
