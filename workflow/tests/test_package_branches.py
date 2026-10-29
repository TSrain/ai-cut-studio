import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from tools import package_branches as pb


def write(path, obj):
    Path(path).write_text(json.dumps(obj))


def result(req):
    root = Path(req['outputRoot'])
    payload = root / 'proposal.json'
    write(payload, {'schemaVersion': 1, 'branchId': req['branchId'], 'items': [], 'reason': '本轮留白'})
    report = root / 'report.md'; report.write_text('本轮专项完成，建议留白。')
    value = {k: req[k] for k in ('projectId', 'runId', 'branchId', 'attemptId', 'inputFingerprint', 'dependencies')}
    value.update(status='complete', manifestPath=str(payload), reportPath=str(report),
                 files=[{'path': str(p), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in (payload, report)],
                 proposedChanges=[], acceptance={'applied': False, 'technical': 'not_run', 'viewed': False, 'listened': False}, gaps=[])
    write(root / 'result.json', value)
    return value


def reviewed_result(req):
    value = result(req)
    proposal = pb.load(value['manifestPath'])
    bundle = pb.load(req['branchInputPath'])
    proposal.update(decision='leave_blank', reviewedSections=[s['id'] for s in bundle['common']['sections']])
    pb.atomic_json(value['manifestPath'], proposal)
    value['files'][0]['sha256'] = pb.digest(value['manifestPath'])
    pb.atomic_json(Path(req['outputRoot'])/'result.json', value)
    return value


class BranchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.script = self.root/'script.md'; self.script.write_text('完整口播')
        self.semantic = self.root/'semantic.json'; write(self.semantic, {'sections': [{'id': 's1', 'narration': '完整口播', 'requirementVersion': 1, 'animationNeed': 'none'}]})
        self.request = {'projectId': 'p1', 'runId': 'r1', 'outputRoot': str(self.root/'out'), 'finalScriptPath': str(self.script), 'canvas': {'width': 1920, 'height': 1080}, 'packageOrchestrationVersion': 2, 'cues': [], 'scope': {'templates': False, 'footage': False, 'captions': False, 'animation': False}}
        self.path = self.root/'request.json'; write(self.path, self.request)
        self.slots = self.root/'slots'

    def run_branches(self, runner, **kw):
        return pb.run_branches(self.path, self.semantic, runner=runner, slot_root=self.slots, **kw)

    def test_default_runner_uses_host_cli_and_network_only_for_asset_branches(self):
        write(self.root/'result.json', {'smoke':True})
        for branch in ('footage','aiVideo','cover','camera','templates','captions'):
            with patch.dict(os.environ, {}, clear=True), patch('tools.editor_plan_runtime.codex_binary', return_value='/bundled/codex'), patch.object(pb,'run_process') as call:
                pb.default_runner({'version':2,'branchId':branch,'outputRoot':str(self.root),'requestPath':str(self.path)}, threading.Event())
                argv=call.call_args.args[0]
                self.assertEqual(argv[0],'/bundled/codex')
                self.assertEqual('sandbox_workspace_write.network_access=true' in argv, branch in {'footage','aiVideo','cover'})
                self.assertNotIn('--add-dir',argv)

    def test_parallel_real_processes_and_complete_validation(self):
        spans = []; lock = threading.Lock()
        def worker(req, stop):
            start = time.monotonic()
            pb.run_process([sys.executable, '-c', 'import time; time.sleep(.18)'], req, stop)
            with lock: spans.append((start, time.monotonic()))
            return reviewed_result(req)
        run = self.run_branches(worker)
        self.assertEqual(run['status'], 'complete')
        self.assertEqual(len(spans), 3)
        self.assertGreater(sum(a < spans[0][1] and b > spans[0][0] for a,b in spans), 1)
        self.assertEqual(pb.validate_branch_run(self.request, self.root/'out/package-branches.json')['runId'], 'r1')
        Path(run['branches']['camera']['reportPath']).write_text('tampered')
        with self.assertRaises(ValueError): pb.validate_branch_run(self.request, self.root/'out/package-branches.json')

    def test_failed_sibling_retry_and_input_change(self):
        calls=[]
        def worker(req, stop):
            calls.append(req['branchId'])
            if req['branchId']=='camera' and calls.count('camera') == 1: raise RuntimeError('camera failure')
            return reviewed_result(req)
        first=self.run_branches(worker)
        self.assertEqual(first['status'], 'partial')
        self.assertEqual(first['branches']['cover']['status'], 'complete')
        second=self.run_branches(worker, retry_failed=True)
        self.assertEqual(second['status'], 'complete'); self.assertEqual(len(calls), 4)
        self.assertEqual(first['branches']['cover']['attemptId'], second['branches']['cover']['attemptId'])
        self.script.write_text('更新完整口播')
        third=self.run_branches(worker)
        self.assertNotEqual(third['inputFingerprint'], second['inputFingerprint']); self.assertEqual(len(calls), 7)

    def test_cancel_terminates_process_group_and_rejects_late_result(self):
        stop=threading.Event(); launched=threading.Event()
        def worker(req, event):
            launched.set()
            pb.run_process([sys.executable, '-c', 'import time; time.sleep(30)'], req, event)
            return reviewed_result(req)
        output={}
        thread=threading.Thread(target=lambda: output.update(self.run_branches(worker, cancel_event=stop)))
        thread.start(); self.assertTrue(launched.wait(3)); stop.set(); thread.join(4)
        self.assertFalse(thread.is_alive()); self.assertEqual(output['status'], 'cancelled')
        self.assertTrue(all(b['status'] in ('cancelled','skipped') for b in output['branches'].values()))

    def test_global_slots_across_independent_runs(self):
        other = dict(self.request, runId='r2', outputRoot=str(self.root/'other'))
        other_path=self.root/'other.json'; write(other_path,other)
        active=0; peak=0; lock=threading.Lock(); results=[]
        def worker(req, stop):
            nonlocal active, peak
            with lock: active+=1; peak=max(peak,active)
            pb.run_process([sys.executable,'-c','import time; time.sleep(.08)'],req,stop)
            with lock: active-=1
            return reviewed_result(req)
        threads=[threading.Thread(target=lambda p=p: results.append(pb.run_branches(p,self.semantic,runner=worker,slot_root=self.slots))) for p in (self.path,other_path)]
        for t in threads: t.start()
        for t in threads: t.join(5)
        self.assertEqual(len(results),2); self.assertEqual(peak,3)

    def test_cancel_kills_descendant(self):
        stop=threading.Event(); heartbeat=self.root/'heartbeat'
        def worker(req,event):
            child="import pathlib,time,sys; p=pathlib.Path(sys.argv[1]);\nwhile True: p.write_text(str(time.time())); time.sleep(.02)"
            code="import subprocess,sys,time; subprocess.Popen([sys.executable,'-c',sys.argv[1],sys.argv[2]]); time.sleep(30)"
            pb.run_process([sys.executable,'-c',code,child,str(heartbeat)],req,event)
        self.request['scope']={b:False for b in pb.BRANCHES if b!='camera'}; write(self.path,self.request)
        thread=threading.Thread(target=lambda:self.run_branches(worker,cancel_event=stop))
        thread.start(); deadline=time.monotonic()+3
        while not heartbeat.exists() and time.monotonic()<deadline: time.sleep(.02)
        self.assertTrue(heartbeat.exists()); stop.set(); thread.join(4)
        self.assertFalse(thread.is_alive())
        before=heartbeat.read_text(); time.sleep(.15)
        self.assertEqual(before,heartbeat.read_text())

    def test_cancel_rejects_success_returned_late(self):
        stop=threading.Event()
        def worker(req,event):
            value=reviewed_result(req); stop.set(); return value
        state=self.run_branches(worker,cancel_event=stop)
        self.assertEqual(state['status'],'cancelled')
        self.assertFalse(any(v['status']=='complete' for v in state['branches'].values()))

    def test_cancel_file_stops_descendant_and_waiting_branches(self):
        heartbeat=self.root/'cancel-heartbeat'; launched=[]; output={}
        def worker(req,event):
            launched.append(req['branchId'])
            child="import pathlib,time,sys; p=pathlib.Path(sys.argv[1]);\nwhile True: p.write_text(str(time.time())); time.sleep(.02)"
            code="import subprocess,sys,time; subprocess.Popen([sys.executable,'-c',sys.argv[1],sys.argv[2]]); time.sleep(30)"
            pb.run_process([sys.executable,'-c',code,child,str(heartbeat)],req,event)
        thread=threading.Thread(target=lambda:output.update(self.run_branches(worker,max_workers=1)))
        thread.start(); deadline=time.monotonic()+3
        while not heartbeat.exists() and time.monotonic()<deadline: time.sleep(.02)
        self.assertTrue(heartbeat.exists())
        (self.root/'out/cancel.request').write_text('parent cancelled')
        thread.join(3)
        if thread.is_alive():
            # Let the pre-fix test fail without leaving a 30-second process behind.
            for process in (self.root/'out/branches').glob('*/*/process.json'):
                try: os.killpg(pb.load(process)['processGroup'],15)
                except ProcessLookupError: pass
            thread.join(3)
        self.assertEqual(output.get('status'),'cancelled')
        self.assertEqual(len(launched),1)
        before=heartbeat.read_text(); time.sleep(.15); self.assertEqual(heartbeat.read_text(),before)

    def test_cancel_file_rejects_late_publication_and_prevents_start(self):
        def worker(req,event):
            value=reviewed_result(req)
            (self.root/'out/cancel.request').write_text('parent cancelled')
            return value
        state=self.run_branches(worker,max_workers=1)
        self.assertEqual(state['status'],'cancelled')
        self.assertFalse(any(v['status']=='complete' for v in state['branches'].values()))
        started=[]
        def never(req,event): started.append(req); return reviewed_result(req)
        state=self.run_branches(never,retry_failed=True)
        self.assertEqual(state['status'],'cancelled'); self.assertEqual(started,[])

    def test_cancel_file_interrupts_global_slot_wait(self):
        self.slots.mkdir()
        handles=[(self.slots/f'{i}.lock').open('a+') for i in range(3)]
        for handle in handles: pb.fcntl.flock(handle,pb.fcntl.LOCK_EX)
        output={}; called=[]
        def worker(req,event): called.append(req); return reviewed_result(req)
        thread=threading.Thread(target=lambda:output.update(self.run_branches(worker)))
        try:
            thread.start(); deadline=time.monotonic()+3
            while not (self.root/'out/package-branches.json').exists() and time.monotonic()<deadline: time.sleep(.01)
            (self.root/'out/cancel.request').write_text('cancel while queued for global slot')
            thread.join(3)
            self.assertFalse(thread.is_alive()); self.assertEqual(called,[])
            self.assertEqual(output['status'],'cancelled')
        finally:
            for handle in handles: handle.close()
            thread.join(3)

    def test_execution_receipt_is_bound_and_checked(self):
        state=self.run_branches(lambda req,stop:reviewed_result(req))
        camera=state['branches']['camera']
        self.assertIn('executionPath',camera)
        receipt=pb.load(camera['executionPath'])
        self.assertEqual(receipt['attemptId'],camera['attemptId'])
        self.assertEqual(receipt['runnerKind'],'injected')
        receipt['runnerKind']='codex'; write(camera['executionPath'],receipt)
        with self.assertRaises(ValueError): pb.validate_branch_run(self.request,self.root/'out/package-branches.json')

    def test_wrong_attempt_and_pending_are_not_complete(self):
        def worker(req, stop):
            value=reviewed_result(req); value['attemptId']='old'; write(Path(req['outputRoot'])/'result.json',value)
            return value
        run=self.run_branches(worker)
        self.assertEqual(run['status'],'partial')
        with self.assertRaises(ValueError): pb.validate_branch_run(self.request,self.root/'out/package-branches.json')

if __name__ == '__main__': unittest.main()
