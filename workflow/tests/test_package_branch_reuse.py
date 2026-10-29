import json
import tempfile
import unittest
from pathlib import Path
from tools.package_branch_inputs import build_branch_input
from tools.package_branch_reuse import find_reusable_artifact, materialize_reuse
from tests.test_package_branch_inputs import fixture
import hashlib

def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()

class ReuseTests(unittest.TestCase):
    def test_explicit_same_project_success_and_rewrite(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); old=root/'old'; old.mkdir(); manifest=old/'proposal.json'; manifest.write_text(json.dumps({'path':str(old/'media.png')})); media=old/'media.png'; media.write_bytes(b'image')
            execution=old/'execution.json'; execution.write_text('{"runnerKind":"codex"}')
            r,s=fixture(); bundle=build_branch_input(r,s,'cover')
            origin={'projectId':'p','runId':'r','attemptId':'old','branchId':'cover','status':'complete','validation':{'status':'passed'},'branchInput':bundle,'dependencyFingerprint':bundle['dependencyFingerprint'],'outputRoot':str(old),'manifestPath':str(manifest),'executionPath':str(execution),'executionSha256':sha(execution),'files':[{'path':str(p),'sha256':sha(p)} for p in (manifest,media)]}
            self.assertIsNotNone(find_reusable_artifact(bundle,{'artifacts':[origin]}))
            later=dict(bundle,runId='later')
            self.assertIsNone(find_reusable_artifact(later,{'artifacts':[origin]}))
            later['reusePolicy']='validated-project-artifacts'
            self.assertIsNotNone(find_reusable_artifact(later,{'artifacts':[origin]}))
            origin['additionalDependencies']=[{'kind':'file','path':str(media),'sha256':'wrong'}]
            self.assertIsNone(find_reusable_artifact(bundle,{'artifacts':[origin]}))
            origin.pop('additionalDependencies')
            origin['resultPath']=str(old/'missing-result.json'); origin['resultSha256']='missing'
            self.assertIsNone(find_reusable_artifact(bundle,{'artifacts':[origin]}))
            origin.pop('resultPath'); origin.pop('resultSha256')
            foreign=dict(origin,projectId='other'); self.assertIsNone(find_reusable_artifact(bundle,{'artifacts':[foreign]}))
            req={'projectId':'p','runId':'new','attemptId':'new','branchId':'cover','outputRoot':str(root/'new'),'branchInput':bundle}
            Path(req['outputRoot']).mkdir()
            (Path(req['outputRoot'])/'request.json').write_text('{}')
            (Path(req['outputRoot'])/'branch-input.json').write_text('{}')
            result=materialize_reuse(origin,req)
            self.assertEqual(result['runnerKind'],'reuse'); self.assertEqual(result['runId'],'new')
            self.assertIn(str(root/'new'/'media.png'),Path(result['manifestPath']).read_text())
            self.assertIn(str(old/'media.png'),manifest.read_text())
            self.assertEqual(result['reuse']['originAttemptId'],'old')
            media.write_bytes(b'bad'); self.assertIsNone(find_reusable_artifact(bundle,{'artifacts':[origin]}))
    def test_unvalidated_and_cross_run_default_rejected(self):
        r,s=fixture(); bundle=build_branch_input(r,s,'cover')
        self.assertIsNone(find_reusable_artifact(bundle,{'artifacts':[{'status':'complete'}]}))
