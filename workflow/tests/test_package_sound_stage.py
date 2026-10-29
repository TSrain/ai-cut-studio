from pathlib import Path
import tempfile
import unittest
from tools import package_branches as pb
from tools.package_sound_stage import run_sound_stage

class SoundStageTests(unittest.TestCase):
    def fixture(self,root):
        semantic=root/'semantic.json';pb.atomic_json(semantic,{'sections':[{'id':'s1','narration':'口播','soundDesign':{'decision':'silence','reason':'人声足够','cues':[]}}]})
        request={'projectId':'p','runId':'r','outputRoot':str(root),'packageOrchestrationVersion':2}
        req=root/'request.json';pb.atomic_json(req,request)
        identity=pb.input_identity(request,semantic);shared=root/'shared.json';pb.atomic_json(shared,{'semanticPath':str(semantic),'identity':identity})
        pb.atomic_json(root/'package-branches.json',{'version':2,'projectId':'p','runId':'r','inputFingerprint':pb.json_digest(identity),'sharedInputPath':str(shared),'sharedInputSha256':pb.digest(shared),'status':'complete','branches':{}})
        ack=root/'ack.json';pb.atomic_json(ack,{'status':'applied'})
        events=root/'events.json';pb.atomic_json(events,{'status':'applied','projectId':'p','runId':'r','receiptPath':str(ack),'events':[]})
        snapshot=root/'snapshot.json';pb.atomic_json(snapshot,{'document':{'id':'p','revision':2,'source':{'clips':[]},'canvas':{},'instances':[],'captions':[],'audioClips':[]}})
        return req,events,snapshot
    def worker(self,req,stop):
        root=Path(req['outputRoot']);root.mkdir(parents=True,exist_ok=True)
        manifest=root/'sound.json';pb.atomic_json(manifest,{'version':1,'projectId':'p','cues':[]})
        proposal=root/'proposal.json';pb.atomic_json(proposal,{'schemaVersion':1,'branchId':'sound','items':[],'reason':'全文留白','decision':'leave_blank','reviewedSections':['s1'],'reviewedSectionIds':['s1'],'soundManifestPath':str(manifest)})
        report=root/'report.md';report.write_text('未听审，保留人声')
        return {**{k:req[k] for k in pb.IDENTITY},'status':'complete','manifestPath':str(proposal),'reportPath':str(report),'files':[pb.file_record(p) for p in [manifest,proposal,report]],'proposedChanges':[],'gaps':[],'acceptance':{'applied':False,'technical':'passed','viewed':False,'listened':False}}
    def test_injected_stage_persists_real_validation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);paths=self.fixture(root)
            state=run_sound_stage(*paths,runner=self.worker,slot_root=root/'slots')
            row=state['postStages']['sound']
            self.assertEqual(row['status'],'complete')
            self.assertEqual(row['validation']['status'],'passed')
            self.assertEqual(row['application']['status'],'not_required')
            self.assertEqual(pb.load(row['executionPath'])['runnerKind'],'injected')
    def test_missing_ack_is_partial(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);paths=self.fixture(root);(root/'ack.json').unlink()
            state=run_sound_stage(*paths,runner=self.worker,slot_root=root/'slots')
            self.assertEqual(state['status'],'partial')
            self.assertEqual(state['postStages']['sound']['status'],'blocked')
    def test_native_gate_preserves_worker_validation_artifact(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);paths=self.fixture(root)
            def worker(req,stop):
                result=self.worker(req,stop)
                artifact=Path(req['outputRoot'])/'validation.json'
                pb.atomic_json(artifact,{'workerCheck':'original evidence'})
                result['files'].append(pb.file_record(artifact))
                return result
            state=run_sound_stage(*paths,runner=worker,slot_root=root/'slots')
            row=state['postStages']['sound']
            self.assertEqual(row['status'],'complete')
            pb.verify_files(row['files'])
            self.assertNotIn(row['validation']['receiptPath'],[f['path'] for f in row['files']])
    def test_scope_false_does_not_require_application_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);req,events,snapshot=self.fixture(root)
            request=pb.load(req);request['scope']={'sound':False};pb.atomic_json(req,request)
            state=pb.load(root/'package-branches.json');shared=pb.load(state['sharedInputPath'])
            shared['identity']=pb.input_identity(request,shared['semanticPath']);pb.atomic_json(state['sharedInputPath'],shared)
            state['sharedInputSha256']=pb.digest(state['sharedInputPath']);state['inputFingerprint']=pb.json_digest(shared['identity']);pb.atomic_json(root/'package-branches.json',state)
            events.unlink();snapshot.unlink()
            result=run_sound_stage(req,events,snapshot)
            self.assertEqual(result['postStages']['sound']['status'],'skipped')
    def test_active_coordinator_is_not_mutated(self):
        import fcntl
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);paths=self.fixture(root)
            with (root/'.package-branches.lock').open('a+') as owner:
                fcntl.flock(owner,fcntl.LOCK_EX|fcntl.LOCK_NB)
                with self.assertRaisesRegex(RuntimeError,'already running'):
                    run_sound_stage(*paths,runner=self.worker)
            self.assertNotIn('sound',pb.load(root/'package-branches.json').get('postStages',{}))
