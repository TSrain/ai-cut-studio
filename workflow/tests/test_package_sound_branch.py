import json
from pathlib import Path
import tempfile
import threading
import unittest
from tools import package_branches as pb
from tools.package_sound_branch import prepare_sound_input, run_sound_branch

class SoundTests(unittest.TestCase):
    def fixture(self,root):
        receipt=root/'applied.json';pb.atomic_json(receipt,{'status':'applied'})
        request={'projectId':'p','runId':'r','outputRoot':str(root),'semantic':{'sections':[{'id':'s1','narration':'完整口播','soundDesign':{'decision':'silence','reason':'人声足够','cues':[]}}]}}
        events={'status':'applied','projectId':'p','runId':'r','receiptPath':str(receipt),'events':[]}
        document={'id':'p','revision':3,'source':{'clips':[],'cameraPlan':[]},'canvas':{'width':1920,'height':1080},'instances':[],'captions':[],'audioClips':[]}
        return request,events,document
    def test_evidence_and_source_binding(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);request,events,document=self.fixture(root)
            value=prepare_sound_input(request,events,document)
            self.assertEqual(value['status'],'ready')
            self.assertEqual(value['soundDesignVersion'],1)
            changed=dict(document,audioClips=[{'id':'manual'}])
            self.assertNotEqual(value['inputFingerprint'],prepare_sound_input(request,events,changed)['inputFingerprint'])
            events.pop('receiptPath')
            self.assertEqual(prepare_sound_input(request,events,document)['status'],'blocked')
    def test_leave_blank_review_and_changed_events_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);request,events,document=self.fixture(root)
            value=prepare_sound_input(request,events,document);path=root/'sound-request.json';pb.atomic_json(path,value)
            def runner(req,stop):
                out=Path(req['outputRoot']);out.mkdir(parents=True,exist_ok=True)
                manifest=out/'sound-cues.json';pb.atomic_json(manifest,{'version':1,'projectId':'p','cues':[]})
                proposal=out/'proposal.json';pb.atomic_json(proposal,{'schemaVersion':1,'branchId':'sound','items':[],'reason':'人声留白','decision':'leave_blank','soundManifestPath':str(manifest),'reviewedSectionIds':['s1']})
                report=out/'report.md';report.write_text('未试听；按全文声音意图留白。')
                return {**{k:req[k] for k in pb.IDENTITY},'status':'complete','manifestPath':str(proposal),'reportPath':str(report),'files':[pb.file_record(p) for p in [manifest,proposal,report]],'proposedChanges':[],'gaps':[],'acceptance':{'applied':False,'technical':'passed','viewed':False,'listened':False}}
            result=run_sound_branch(path,threading.Event(),slot_root=root/'slots',runner=runner)
            self.assertEqual(result['status'],'complete')
            pb.atomic_json(Path(value['appliedEventsPath']),{'events':['changed']})
            with self.assertRaisesRegex(ValueError,'changed'):
                run_sound_branch(path,threading.Event(),slot_root=root/'slots',runner=runner)
    def test_scope_skip(self):
        with tempfile.TemporaryDirectory() as root:
            self.assertEqual(prepare_sound_input({'scope':{'sound':False}}, {}, {})['status'],'skipped')

    def test_all_sections_need_native_sound_intentions(self):
        with tempfile.TemporaryDirectory() as tmp:
            request,events,document=self.fixture(Path(tmp))
            request['semantic']['sections'].append({'id':'s2','narration':'遗漏段落'})
            self.assertEqual(prepare_sound_input(request,events,document)['status'],'blocked')

    def test_saved_current_intentions_can_complete_frozen_semantic_sections(self):
        with tempfile.TemporaryDirectory() as tmp:
            request,events,document=self.fixture(Path(tmp))
            section=request['semantic']['sections'][0]
            design=section.pop('soundDesign')
            section['requirementVersion']=1
            document['productionPlan']={'shots':[dict(section,soundDesign=design)]}
            value=prepare_sound_input(request,events,document)
            self.assertEqual(value['status'],'ready')
            self.assertEqual(value['sections'][0]['soundDesign'],design)
            self.assertNotIn('soundDesign',section)
            document['productionPlan']['shots'][0]['narration']='用户已改字'
            self.assertEqual(prepare_sound_input(request,events,document)['status'],'blocked')
