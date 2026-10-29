import copy
import unittest
from tools.sound_design import validate_sound_design
from tools.package_contract import design_digest

class SoundDesignTests(unittest.TestCase):
    def document(self):
        return {'coverage':'hybrid','soundDesignVersion':1,'shots':[{'镜号':1,'锚点口播':'真正重要的是结果','soundDesign':{'decision':'cues','reason':'让结论落稳','cues':[{'id':'result','role':'emphasis','intent':'短促、温和的落定感','anchor':'真正重要的是结果','event':'settle','texture':'干、短、无刺耳高频','priority':2}]}}]}
    def test_valid_and_silence(self):
        d=self.document();validate_sound_design(d)
        d['shots'][0]['soundDesign']={'decision':'silence','reason':'让人声独立承载观点','cues':[]};validate_sound_design(d)
    def test_no_estimated_time_or_missing_intent(self):
        d=self.document();d['shots'][0]['soundDesign']['cues'][0]['startSeconds']=1
        with self.assertRaises(ValueError):validate_sound_design(d)
        d=self.document();del d['shots'][0]['soundDesign']['cues'][0]['intent']
        with self.assertRaises(ValueError):validate_sound_design(d)
    def test_every_shot_explicit_and_ids_unique(self):
        d=self.document();d['shots'].append(copy.deepcopy(d['shots'][0]));d['shots'][1]['镜号']=2
        with self.assertRaises(ValueError):validate_sound_design(d)
        del d['shots'][1]['soundDesign']
        with self.assertRaises(ValueError):validate_sound_design(d)
    def test_sound_change_invalidates_design_approval(self):
        d=self.document();before=design_digest(d);d['shots'][0]['soundDesign']['cues'][0]['texture']='厚、强烈'
        self.assertNotEqual(before,design_digest(d))
    def test_legacy_unchanged(self):
        validate_sound_design({'shots':[{}]})
