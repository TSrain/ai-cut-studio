"""Durable, deduplicated orchestration observations (never inferred token counts)."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import time


def record_event(root, event):
    root=Path(root);root.mkdir(parents=True,exist_ok=True)
    event=dict(event)
    # Content identity is stable across recovery; generated clocks are not part of it.
    event.setdefault('eventId',hashlib.sha256(json.dumps(event,sort_keys=True,ensure_ascii=False).encode()).hexdigest())
    with (root/'package-metrics.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        path=root/'package-events.jsonl'
        rows=_read(path)
        if any(row['eventId']==event['eventId'] for row in rows):return
        event.setdefault('utcTime',time.time());event.setdefault('monotonic',time.monotonic())
        # Only metadata supplied by the coordinator is retained, never full prompts/secrets.
        allowed={'eventId','runId','branchId','attemptId','stage','utcTime','monotonic','durationSeconds','bundleBytes','promptBytes','controllerBytes','usage','runnerKind','status','shaSeconds'}
        event={key:value for key,value in event.items() if key in allowed}
        with path.open('a',encoding='utf-8') as handle:
            handle.write(json.dumps(event,ensure_ascii=False,allow_nan=False)+'\n');handle.flush();os.fsync(handle.fileno())


def _read(path):
    if not path.exists():return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def summarize_metrics(root):
    root=Path(root);root.mkdir(parents=True,exist_ok=True)
    with (root/'package-metrics.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        rows=_read(root/'package-events.jsonl');groups={};branches={}
        result={'eventCount':len(rows),'branches':branches,'inputTokens':None,'outputTokens':None,'bundleBytes':0,'promptBytes':0,'controllerBytes':0,'successCount':0,'reuseCount':0,'retryCount':0}
        for row in rows:
            key=(row.get('runId'),row.get('branchId'),row.get('attemptId'));groups.setdefault(key,[]).append(row)
            for field in ('bundleBytes','promptBytes','controllerBytes'):result[field]+=row.get(field,0) or 0
            for target,aliases in [('inputTokens',('input_tokens','inputTokens')),('outputTokens',('output_tokens','outputTokens'))]:
                usage=row.get('usage') or {};value=next((usage[a] for a in aliases if isinstance(usage.get(a),(int,float))),None)
                if value is not None:result[target]=(result[target] or 0)+value
        first=[];all_times=[]
        for (_,branch,_),events in groups.items():
            if not branch:continue
            out=branches.setdefault(branch,{'queueSeconds':0,'modelSeconds':0,'applicationSeconds':0,'validationSeconds':0})
            stamps={e['stage']:e['monotonic'] for e in events if isinstance(e.get('monotonic'),(int,float))}
            all_times.extend(stamps.values())
            for field,start,end in [('queueSeconds','queued','start'),('modelSeconds','start','model-return'),('applicationSeconds','application','readback'),('validationSeconds','validation','application')]:
                if start in stamps and end in stamps:out[field]+=max(0,stamps[end]-stamps[start])
            if 'readback' in stamps:first.append(stamps['readback'])
            stages={e['stage'] for e in events}
            if 'complete' in stages and not stages.intersection({'cancelled','failed'}):result['successCount']+=1
            if any(e.get('runnerKind')=='reuse' for e in events):result['reuseCount']+=1
        attempts={}
        for run,branch,attempt in groups:attempts.setdefault((run,branch),set()).add(attempt)
        result['retryCount']=sum(max(0,len(v)-1) for v in attempts.values())
        result['totalSeconds']=max(all_times)-min(all_times) if all_times else None
        result['firstResultSeconds']=min(first)-min(all_times) if first and all_times else None
        result['shaSeconds']=sum(e.get('shaSeconds',0) or 0 for e in rows)
        tmp=root/'package-metrics.json.tmp';tmp.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');tmp.replace(root/'package-metrics.json')
        return result
