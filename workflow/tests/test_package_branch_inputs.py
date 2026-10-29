import copy
import tempfile
import unittest
from pathlib import Path
from tools.package_branch_inputs import build_branch_input, dependency_fingerprint, validate_dependency_set


def fixture():
    return ({'projectId':'p','runId':'r','script':'完整脚本，后半也必须保留。','source':{'clips':[],'videoIdentity':'abc'},'cues':[{'text':'全文'}],'canvas':{'width':1080,'height':1920},'captions':{'color':'white'},'templateCatalog':{'version':1},'presenterObservation':{'safe':True},'subtitleSafeArea':{'bottom':100},'coverReferences':[], 'rulesVersions':{'prompt':1,'validator':1}}, {'sections':[{'id':'s','requirementVersion':1,'factBoundary':'示意'}]})

class InputsTests(unittest.TestCase):
    def test_implicit_source_mapping_matches_native_interval_mapping(self):
        from tools.editor_plan_runtime import map_source_interval
        with tempfile.TemporaryDirectory() as d:
            r,s=fixture(); video=Path(d)/'source.mov'; video.write_bytes(b'video')
            r['source']={'path':str(video),'startFrame':45,'durationFrames':150}
            r['canvas'].update(fps={'num':30,'den':1},durationFrames=300)
            original=copy.deepcopy(r)
            bundle=build_branch_input(r,s,'templates')
            projected=bundle['input']['source']
            self.assertIn('clips',projected)
            self.assertEqual(map_source_interval({'source':projected,'canvas':r['canvas']},str(video),2,4,'s'),
                             map_source_interval(r,str(video),2,4,'s'))
            self.assertEqual(r,original)
            r['source']['startFrame']=60
            self.assertNotEqual(bundle['dependencyFingerprint'],build_branch_input(r,s,'templates')['dependencyFingerprint'])

    def test_implicit_mapping_canvas_duration_and_explicit_empty_clips(self):
        with tempfile.TemporaryDirectory() as d:
            r,s=fixture(); video=Path(d)/'source.mov'; video.write_bytes(b'video')
            r['source']={'path':str(video)}; r['canvas']['durationFrames']=1414
            self.assertEqual(build_branch_input(r,s,'camera')['input']['source']['clips'],
                             [{'id':'source','startFrame':0,'durationFrames':1414,'sourceInFrame':0}])
            r['source']['clips']=[]
            self.assertEqual(build_branch_input(r,s,'camera')['input']['source']['clips'],[])

    def test_matrix_and_full_script(self):
        r,s=fixture()
        for b in ('templates','footage','aiVideo','camera','captions','cover'):
            bundle=build_branch_input(r,s,b)
            self.assertEqual(bundle['common']['script'],r['script'])
            self.assertEqual(bundle['common']['sections'],s['sections'])
        cover=build_branch_input(r,s,'cover')['input']
        self.assertNotIn('cues',cover); self.assertNotIn('source',cover)
        captions=build_branch_input(r,s,'captions')['input']
        self.assertNotIn('templateCatalog',captions)
        self.assertIn('presenterObservation',build_branch_input(r,s,'templates')['input'])
    def test_relevant_change_and_volatile_identity(self):
        r,s=fixture(); a=build_branch_input(r,s,'captions'); cover=build_branch_input(r,s,'cover')
        r['runId']='other'; r['outputRoot']='/tmp/other'; r['revision']=100
        self.assertEqual(dependency_fingerprint(a),dependency_fingerprint(build_branch_input(r,s,'captions')))
        r['captions']['color']='red'
        self.assertNotEqual(dependency_fingerprint(a),dependency_fingerprint(build_branch_input(r,s,'captions')))
        self.assertEqual(dependency_fingerprint(cover),dependency_fingerprint(build_branch_input(r,s,'cover')))
        self.assertTrue(validate_dependency_set(a,build_branch_input(r,s,'captions')))
    def test_missing_required(self):
        r,s=fixture(); del r['canvas']
        with self.assertRaises(ValueError): build_branch_input(r,s,'templates')
    def test_file_content_and_missing(self):
        with tempfile.TemporaryDirectory() as d:
            r,s=fixture(); p=Path(d)/'ref.png'; p.write_bytes(b'first'); r['coverReferences']=[{'path':str(p)}]
            a=build_branch_input(r,s,'cover'); p.write_bytes(b'second')
            self.assertTrue(validate_dependency_set(a,a))
            p.unlink(); self.assertTrue(validate_dependency_set(a,a))
    def test_reference_order_and_versions(self):
        r,s=fixture(); a=build_branch_input(r,s,'cover'); r['rulesVersions']['validator']=2
        self.assertNotEqual(dependency_fingerprint(a),dependency_fingerprint(build_branch_input(r,s,'cover')))

    def test_native_snapshot_shape_and_source_file_identity(self):
        with tempfile.TemporaryDirectory() as d:
            r,s=fixture(); video=Path(d)/'video.mp4'; video.write_bytes(b'video')
            r['videoPath']=str(video); r['source']['clips']=[{'start':0,'end':1}]
            a=build_branch_input(r,s,'camera')
            video.write_bytes(b'changed')
            self.assertTrue(validate_dependency_set(a,a))
    def test_rule_sources_are_bound_and_missing_null_differ(self):
        r,s=fixture(); a=build_branch_input(r,s,'cover')
        self.assertTrue(any(x['pointer'].startswith('/rulesFiles/') for x in a['dependencies']))
        r['titleIntent']=None
        self.assertNotEqual(dependency_fingerprint(a),dependency_fingerprint(build_branch_input(r,s,'cover')))

    def test_order_and_source_mapping_invalidate_only_consumers(self):
        with tempfile.TemporaryDirectory() as d:
            r,s=fixture(); a=Path(d)/'a.png'; b=Path(d)/'b.png'; a.write_bytes(b'a'); b.write_bytes(b'b')
            r['coverReferences']=[{'path':str(a)},{'path':str(b)}]
            cover=build_branch_input(r,s,'cover'); footage=build_branch_input(r,s,'footage')
            r['coverReferences'].reverse()
            self.assertNotEqual(cover['dependencyFingerprint'],build_branch_input(r,s,'cover')['dependencyFingerprint'])
            self.assertEqual(footage['dependencyFingerprint'],build_branch_input(r,s,'footage')['dependencyFingerprint'])
            r['source']['clips']=[{'start':2}]
            self.assertNotEqual(footage['dependencyFingerprint'],build_branch_input(r,s,'footage')['dependencyFingerprint'])

    def test_audio_identity_is_dependency_not_cover_context(self):
        with tempfile.TemporaryDirectory() as d:
            r,s=fixture(); p=Path(d)/'audio.wav'; p.write_bytes(b'audio'); r['audioPath']=str(p)
            captions=build_branch_input(r,s,'captions'); cover=build_branch_input(r,s,'cover')
            p.write_bytes(b'changed')
            self.assertTrue(validate_dependency_set(captions,captions))
            self.assertFalse(validate_dependency_set(cover,cover))

    def test_runtime_envelope_and_native_protection(self):
        with tempfile.TemporaryDirectory() as d:
            r,s=fixture(); snapshot=Path(d)/'snapshot.json'; catalog=Path(d)/'catalog.json'; catalog.write_text('{"presets": []}')
            doc={'source':{'path':str(catalog),'clips':[],'locked':True},'canvas':r.pop('canvas'),'captions':{'cues':r.pop('cues'),'locked':True},'tracks':[{'id':'t','locked':True}],'instances':[{'id':'i','trackId':'t','locked':True}],'productionPlan':{'tombstones':['gone']},'cover':{'selectedCandidateId':'selected'}}
            r.pop('source'); r.pop('captions'); r.pop('templateCatalog'); r['projectSnapshotPath']=str(snapshot); r['templateCatalogPath']=str(catalog); r['preferences']={'userDirection':'保留手调'}; r['titleIntent']='标题意图'
            snapshot.write_text(__import__('json').dumps({'document':doc,'catalog':{'project':[]}}))
            template=build_branch_input(r,s,'templates'); cover=build_branch_input(r,s,'cover')
            self.assertEqual(template['common']['userDirection'],'保留手调')
            self.assertEqual(template['input']['templateCatalog'],{'presets':[]})
            self.assertEqual(template['input']['protection']['tracks'][0]['id'],'t')
            self.assertEqual(template['input']['protection']['tombstones'],['gone'])
            self.assertEqual(cover['input']['selectedCover']['selectedCandidateId'],'selected')
            self.assertEqual(cover['input']['titleIntent'],'标题意图')
