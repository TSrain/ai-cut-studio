import copy
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from roughcut_audio import RoughcutError
from roughcut_takes import validate_edit_plan, model_edit_plan, RULES, _infer, _PlanFormatError


def fixture():
    units=[{'id':f'u{i}','text':text,'startSeconds':i,'endSeconds':i+1,'groupId':f'g{i}'} for i,text in enumerate(['打开扣子，','打开扣子做智能体。','打开Coze做智能体，','它不需要写代码。'])]
    plan={'version':1,'mode':'complete-takes','selections':[{'id':'s1','startUnitId':'u2','endUnitId':'u3','reason':'最后一次完整表达包含必要否定'}],
          'omissions':[{'startUnitId':'u0','endUnitId':'u1','reason':'相邻重录，同一产品的转写专名差异','kind':'retake','coveredBySelectionIds':['s1']}],'reviewNotes':[]}
    return units,{'editPlan':plan}


class CompleteTakesTests(unittest.TestCase):
    def setUp(self):
        # The cross-job plan cache is per-test so model-call assertions never see another test's plan.
        self.cache=tempfile.TemporaryDirectory()
        self.env=patch.dict(os.environ,{'ROUGHCUT_MODEL_CACHE_DIR':self.cache.name});self.env.start()

    def tearDown(self):
        self.env.stop();self.cache.cleanup()

    def test_cross_group_retake_and_asr_name_difference(self):
        units,response=fixture()
        units[2].update(coalesced=True,protectionReasons=['zero_duration_alignment'],safeBoundaries=False)
        self.assertEqual(validate_edit_plan(response,units),response['editPlan'])
        self.assertIn('转写专名差异',RULES)

    def test_missing_coverage(self):
        units,response=fixture();response['editPlan']['omissions'][0]['endUnitId']='u0'
        with self.assertRaisesRegex(RoughcutError,'完整覆盖'):validate_edit_plan(response,units)

    def test_unknown_id(self):
        units,response=fixture();response['editPlan']['selections'][0]['endUnitId']='invented'
        with self.assertRaisesRegex(RoughcutError,'未知 ID'):validate_edit_plan(response,units)

    def test_reverse_or_overlap(self):
        units,response=fixture();response['editPlan']['omissions'][0]['startUnitId']='u2'
        with self.assertRaises(RoughcutError):validate_edit_plan(response,units)
        units,response=fixture();response['editPlan']['omissions'][0]['endUnitId']='u2'
        with self.assertRaisesRegex(RoughcutError,'重复'):validate_edit_plan(response,units)

    def test_missing_boundary(self):
        units,response=fixture();del units[1]['endSeconds']
        with self.assertRaisesRegex(RoughcutError,'声学边界'):validate_edit_plan(response,units)

    def test_missing_endpoint_and_unknown_cover(self):
        units,response=fixture();del response['editPlan']['selections'][0]['endUnitId']
        with self.assertRaises(RoughcutError):validate_edit_plan(response,units)
        units,response=fixture();response['editPlan']['omissions'][0]['coveredBySelectionIds']=['missing']
        with self.assertRaises(RoughcutError):validate_edit_plan(response,units)

    def test_independent_review_must_run_and_failure_does_not_publish(self):
        units,response=fixture()
        with tempfile.TemporaryDirectory() as directory:
            with patch('roughcut_takes._infer',side_effect=[(response['editPlan'],'first'),RoughcutError('review failure')]) as infer:
                with self.assertRaisesRegex(RoughcutError,'review failure'):model_edit_plan(units,directory)
                self.assertEqual(infer.call_count,2)
                self.assertFalse((Path(directory)/'complete-takes/result.json').exists())

    def test_format_repairs_are_bounded_and_not_a_semantic_review(self):
        units,response=fixture()
        with patch('roughcut_takes._infer_once',side_effect=[_PlanFormatError('missing u1'),(response['editPlan'],'fixed')]) as infer:
            result=_infer(units,Path('/tmp'),'selection')
            self.assertEqual(result[1],'fixed')
            self.assertIn('不能替代独立全文审核',infer.call_args.args[3])
        with patch('roughcut_takes._infer_once',side_effect=_PlanFormatError('missing u1')) as infer:
            with self.assertRaisesRegex(RoughcutError,'两次结构修正'):_infer(units,Path('/tmp'),'selection')
            self.assertEqual(infer.call_count,3)
        with patch('roughcut_takes._infer_once',side_effect=RoughcutError('process failed')) as infer:
            with self.assertRaisesRegex(RoughcutError,'process failed'):_infer(units,Path('/tmp'),'selection')
            self.assertEqual(infer.call_count,1)

    def test_cache_full_unit_and_version_binding(self):
        units,response=fixture()
        with tempfile.TemporaryDirectory() as directory:
            with patch('roughcut_takes._infer',return_value=(response['editPlan'],'attempt')) as infer:
                model_edit_plan(units,directory)
                self.assertEqual(infer.call_count,2)
            with patch('roughcut_takes._infer',side_effect=AssertionError('cache should be used')):
                self.assertEqual(model_edit_plan(units,directory,resume=True),response['editPlan'])
            units[0]['text']='changed source'
            with patch('roughcut_takes._infer',return_value=(response['editPlan'],'new-attempt')) as infer:
                model_edit_plan(units,directory,resume=True)
                self.assertEqual(infer.call_count,2)

if __name__=='__main__':unittest.main()
