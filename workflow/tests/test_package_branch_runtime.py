import copy
import tempfile
import unittest
from pathlib import Path

from tests.test_package_branches import reviewed_result, write
from tools import package_branches as pb, package_branch_runtime as transport
from tools import editor_plan_runtime as runtime


class BranchTransportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.semantic = self.root / 'semantic.json'
        write(self.semantic, {'sections': [{'id': 's1', 'narration': '完整口播'}]})
        self.request = {'projectId': 'p1', 'runId': 'r1', 'packageOrchestrationVersion': 2, 'outputRoot': str(self.root / 'out'), 'script':'完整口播', 'canvas':{'width':1920,'height':1080}, 'cues':[], 'scope':{'templates':False,'footage':False,'captions':False,'animation':False}}
        self.request_path = self.root / 'request.json'; write(self.request_path, self.request)
        self.snapshot = {'projectId': 'p1', 'jobId': 'r1', 'packageOrchestrationVersion': 2}

    def run_proposals(self, fail=False):
        def runner(req, stop):
            if fail and req['branchId'] == 'camera':
                raise RuntimeError('camera fixture failure')
            return reviewed_result(req)
        state = pb.run_branches(self.request_path, self.semantic, runner=runner, slot_root=self.root / 'slots')
        path = self.root / 'out/package-branches.json'
        from tools.package_branches_v2 import evidence_records
        return {'state': 'partial' if fail else 'complete', 'packageOrchestrationVersion': 2,
                'outputs': {'packageBranchesPath': str(path)},
                'files': [pb.file_record(path), *evidence_records(state)]}

    def test_real_runner_evidence_is_required_by_frozen_marker(self):
        manifest = self.run_proposals()
        state = transport.verify_branch_manifest(self.snapshot, self.request, manifest, self.root/'out')
        self.assertEqual(state['status'], 'complete')
        changed = copy.deepcopy(manifest); changed['files'].pop()
        with self.assertRaisesRegex(ValueError, 'SHA'):
            transport.verify_branch_manifest(self.snapshot, self.request, changed, self.root/'out')
        for request, result_manifest in ((dict(self.request, packageOrchestrationVersion=None), manifest),
                                          (self.request, dict(manifest, packageOrchestrationVersion=None))):
            with self.assertRaisesRegex(ValueError, 'unknown package orchestration version'):
                transport.verify_branch_manifest(self.snapshot, request, result_manifest, self.root/'out')

    def test_unversioned_full_package_requires_v2_branch_evidence(self):
        self.request.pop('packageOrchestrationVersion')
        self.request['fullPackageVersion']=1
        self.snapshot.pop('packageOrchestrationVersion')
        self.snapshot['kind']='package'
        write(self.request_path,self.request)
        manifest=self.run_proposals()
        manifest.pop('packageOrchestrationVersion')
        self.assertEqual(transport.verify_branch_manifest(self.snapshot,self.request,manifest,self.root/'out')['version'],2)
        with self.assertRaisesRegex(ValueError,'canonical branch manifest'):
            transport.verify_branch_manifest(self.snapshot,self.request,{},self.root/'out')

    def test_retired_version_in_any_manifest_binding_is_rejected(self):
        manifest=self.run_proposals()
        for index in range(3):
            values=copy.deepcopy([self.snapshot,self.request,manifest])
            values[index]['packageOrchestrationVersion']=1
            with self.subTest(binding=index),self.assertRaisesRegex(ValueError,'packageOrchestrationVersion=1 已下线'):
                transport.verify_branch_manifest(*values,self.root/'out')

    def test_other_job_kinds_do_not_require_package_branch_evidence(self):
        for kind in ('broll','footage','recognize','revise','roughcut'):
            with self.subTest(kind=kind):
                self.assertIsNone(transport.verify_branch_manifest({'kind':kind},{'fullPackageVersion':1},{},self.root/'out'))

    def test_partial_is_visible_but_cannot_claim_complete(self):
        manifest = self.run_proposals(fail=True)
        transport.verify_branch_manifest(self.snapshot, self.request, manifest, self.root/'out')
        with self.assertRaisesRegex(ValueError, 'incomplete'):
            transport.verify_branch_manifest(self.snapshot, self.request, dict(manifest, state='complete'), self.root/'out')
        store = runtime.ResultStore(self.root/'out', self.snapshot)
        runtime.ingest_progress(store)
        branch = next(row for row in store.status['packageBranches']['branches'] if row['id'] == 'camera')
        self.assertEqual(branch['status'], 'failed')
        self.assertIn('failure', branch['error'])

    def test_wrong_run_progress_is_not_forwarded_and_missing_version_is_v2(self):
        self.run_proposals()
        with self.assertRaisesRegex(ValueError, 'identity'):
            transport.branch_progress(dict(self.snapshot, jobId='another'), self.root/'out')
        unversioned = {k:v for k,v in self.snapshot.items() if k != 'packageOrchestrationVersion'}
        self.assertEqual(transport.branch_progress(unversioned,self.root/'out')['version'],2)
        self.assertIsNone(transport.verify_branch_manifest({}, {}, {}, self.root/'out'))


if __name__ == '__main__':
    unittest.main()
