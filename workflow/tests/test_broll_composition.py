import copy
import importlib.util
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

spec=importlib.util.spec_from_file_location('composition',Path(__file__).resolve().parents[1]/'tools/broll_composition.py')
m=importlib.util.module_from_spec(spec)
if spec.loader and Path(spec.origin).exists(): spec.loader.exec_module(m)

def manifest():
    return {'version':1,'id':'demo','name':'测试','approval':{'status':'approved'},'canvas':{'width':1920,'height':1080,'fps':{'num':30,'den':1},'durationFrames':300},'source':None,'shots':[{'id':'s1','text':'同一观点','startSeconds':1.25,'endSeconds':4.5,'recommended':'animation','reason':'图解更清楚','options':[{'id':'animation','route':'animation','status':'ready','description':'图解','assetId':'number-beat','props':{'slots':{'value':42,'unit':'%','label':'示意'}}},{'id':'footage','route':'media','status':'pending','description':'素材分屏','assetId':'media-split','props':{'items':[{'id':'a','origin':'ai','media':None,'generation':{'brief':'生产线上的机械臂','prompt':'固定中景，机械臂拿起物品，真实工业环境，无文字，画面右侧留白。','durationSeconds':4,'aspectRatio':'16:9'}}]}}]}]}

class CompositionTest(unittest.TestCase):
    def test_same_shot_keeps_both_options_but_selects_one(self):
        d=manifest(); self.assertEqual(m.validate_manifest(d),d)
        with tempfile.TemporaryDirectory() as td:
            out=m.write_delivery(d,Path(td))
            text=out.read_text(); self.assertIn('图解',text); self.assertIn('素材分屏',text)
            self.assertIn('固定中景',text); self.assertIn('推荐',text)
            self.assertEqual(len(list(Path(td).glob('options/*.json'))),2)
    def test_invalid_recommendation_and_timing_fail(self):
        for change in [lambda d:d['shots'][0].update(recommended='missing'),lambda d:d['shots'][0].update(endSeconds=float('nan')),lambda d:d['shots'][0].update(endSeconds=12),lambda d:d['shots'][0].update(startSeconds=4.6)]:
            d=manifest();change(d)
            with self.assertRaises(ValueError):m.validate_manifest(d)
    def test_ai_pending_requires_copyable_prompt_not_fake_ready(self):
        d=manifest();item=d['shots'][0]['options'][1]['props']['items'][0]
        item['generation'].pop('prompt')
        with self.assertRaises(ValueError):m.validate_manifest(d)
        d=manifest();d['shots'][0]['options'][1]['status']='ready'
        with self.assertRaises(ValueError):m.validate_manifest(d)
    def test_approval_is_required_for_compose_not_draft(self):
        d=manifest();d['approval']['status']='pending';m.validate_manifest(d)
        with self.assertRaises(ValueError):m.validate_manifest(d,require_approved=True)
    def test_ids_and_route_contract(self):
        d=manifest();d['shots'][0]['id']='../bad'
        with self.assertRaises(ValueError):m.validate_manifest(d)
        d=manifest();d['shots'][0]['options'][0]['route']='media'
        with self.assertRaises(ValueError):m.validate_manifest(d)
    def test_actual_metadata_rejects_low_resolution_and_honors_rotation(self):
        meta={'streams':[{'codec_type':'video','width':1280,'height':720,'side_data_list':[{'rotation':90}]}],'format':{'duration':'3'}}
        found=m.quality_metadata(meta,'video');self.assertEqual((found['width'],found['height']),(720,1280))
        meta['streams'][0]['height']=480
        with self.assertRaises(ValueError):m.quality_metadata(meta,'video')
        meta['streams'][0].update(width=640,height=720,sample_aspect_ratio='2:1')
        with self.assertRaises(ValueError):m.quality_metadata(meta,'video')
    def test_out_of_range_video_start_becomes_pending(self):
        d=manifest();o=d['shots'][0]['options'][1]
        with tempfile.TemporaryDirectory() as td:
            path=Path(td)/'video.mp4';path.write_bytes(b'test')
            o['status']='ready';o['props']['items'][0]['media']={'kind':'video','path':str(path),'startSeconds':9}
            with patch.object(m,'probe',return_value={'width':1280,'height':720,'durationSeconds':4}):
                result=m.prepare(d,Path(td),Path(td)/'out')
            self.assertEqual(result['shots'][0]['options'][1]['status'],'pending')
            self.assertIsNone(result['shots'][0]['options'][1]['props']['items'][0]['media'])

    def test_exact_evidence_cannot_be_ai_substitute(self):
        d=manifest();d['shots'][0]['options'][1]['props']['items'][0]['role']='evidence'
        with self.assertRaises(ValueError):m.validate_manifest(d)

if __name__=='__main__':unittest.main()
