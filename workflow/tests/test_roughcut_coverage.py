"""Independent semantic coverage only replaces the lexical-containment veto."""
import copy
import hashlib
import json
import os
import sys
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import roughcut_semantics as sem

UNITS=[{'id':'a','text':'这车我试了，我实际试了三次。','startSeconds':0,'endSeconds':1,'timing':'word','groupId':'c1'},
       {'id':'b','text':'这辆车，我实际试了三次。','startSeconds':2,'endSeconds':3,'timing':'word','groupId':'c2'}]
PRIMARY={'decisions':[{'id':'d','unitIds':['a'],'keepUnitIds':['b'],'action':'delete','kind':'retake','reason':'中断后完整重说，事实相同','confidence':.99}]}
APPROVAL={'reviews':[{'decisionId':'d','covered':True,'reason':'保留版本含相同的试车次数和亲身经历；被删版本仅有中断重复'}]}


class CoverageTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.cli=patch.object(sem,'codex_binary',return_value='/fixture/codex')
        self.cli.start();self.addCleanup(self.cli.stop)
    def tearDown(self):self.temp.cleanup()
    def prepare(self,units=UNITS,primary=PRIMARY):
        d=self.root/'semantic';d.mkdir(exist_ok=True)
        (d/'prompt.txt').write_text(sem.build_prompt(units));(d/'response.json').write_text(json.dumps(primary))
        return d
    def runner(self,response,calls):
        def run(command,**kwargs):
            target=Path(command[command.index('--output-last-message')+1])
            self.assertIn('coverage',target.parts,'must not repeat primary model')
            calls.append(kwargs['input_text']);target.write_text(json.dumps(response));return ('coverage events','')
        return run

    def test_nonliteral_complete_retake_needs_independent_approval_and_resumes_cached(self):
        directory=self.prepare();before=(directory/'response.json').read_bytes();calls=[]
        self.assertEqual(sem.validate_decisions(PRIMARY,UNITS)[0]['action'],'review')
        with patch.object(sem,'run_command',side_effect=self.runner(APPROVAL,calls)):
            result=sem.model_decisions(UNITS,self.root,resume=True)
        self.assertEqual(result[0]['action'],'delete');self.assertEqual(len(calls),1)
        self.assertIn('上下文',calls[0]);self.assertIn('否定',calls[0]);self.assertIn('条件',calls[0])
        self.assertEqual((directory/'response.json').read_bytes(),before)
        with patch.object(sem,'run_command',side_effect=AssertionError('cached coverage must not rerun')):
            self.assertEqual(sem.model_decisions(UNITS,self.root,resume=True)[0]['action'],'delete')
        self.assertTrue((directory/'coverage/report.json').is_file())

    def test_primary_score_cannot_cover_lost_numbers_negation_or_condition(self):
        for selected,kept in [('我试了三次。','我试了两次。'),('我不推荐。','我推荐。'),('如果下雨就不开。','我不开。')]:
            with self.subTest(selected=selected):
                units=copy.deepcopy(UNITS);units[0]['text']=selected;units[1]['text']=kept;self.prepare(units)
                denied={'reviews':[{'decisionId':'d','covered':False,'reason':'存在独有数字、否定或条件，保留版本没有覆盖'}]}
                with patch.object(sem,'run_command',side_effect=self.runner(denied,[])):
                    self.assertEqual(sem.model_decisions(units,self.root,resume=True)[0]['action'],'review')

    def test_bad_coverage_fields_or_ids_fail_closed_without_failing_primary(self):
        invalid=[{'reviews':[]},{'reviews':[{'decisionId':'wrong','covered':True,'reason':'x'}]},
                 {'reviews':[{'decisionId':'d','covered':'true','reason':'x'}]},
                 {'reviews':[{'decisionId':'d','covered':True,'reason':'x','startSeconds':0}]},
                 {'reviews':APPROVAL['reviews']*2},
                 {'reviews':APPROVAL['reviews']+[{'decisionId':'extra','covered':True,'reason':'x'}]}]
        for i,response in enumerate(invalid):
            with self.subTest(case=i):
                work=self.root/str(i);work.mkdir();old=self.root;self.root=work;self.prepare()
                try:
                    with patch.object(sem,'run_command',side_effect=self.runner(response,[])):
                        self.assertEqual(sem.model_decisions(UNITS,self.root,resume=True)[0]['action'],'review')
                finally:self.root=old

    def test_coverage_failure_keeps_review_and_failure_evidence(self):
        self.prepare()
        failure=subprocess.TimeoutExpired(['codex'],1,output=b'partial event',stderr=b'timeout detail')
        with patch.object(sem,'run_command',side_effect=failure) as model:
            result=sem.model_decisions(UNITS,self.root,resume=True)
        self.assertEqual(result[0]['action'],'review')
        model.assert_called_once();command=model.call_args.args[0]
        self.assertIn('coverage',Path(command[command.index('--output-last-message')+1]).parts)
        self.assertTrue(list((self.root/'semantic/coverage/attempts').glob('*/failure.txt')))

    def test_primary_review_low_confidence_and_timing_protection_are_never_offered(self):
        for change in ('review','low','protected','segment'):
            with self.subTest(change=change):
                units=copy.deepcopy(UNITS);primary=copy.deepcopy(PRIMARY)
                if change=='review':primary['decisions'][0]['action']='review'
                if change=='low':primary['decisions'][0]['confidence']=.89
                if change=='protected':units[0]['protectionReasons']=['possible_missing_transcript']
                if change=='segment':units[0]['timing']='segment'
                self.prepare(units,primary)
                with patch.object(sem,'run_command',side_effect=AssertionError('ineligible coverage')) as model:
                    self.assertEqual(sem.model_decisions(units,self.root,resume=True)[0]['action'],'review')
                model.assert_not_called()

    def test_prior_explicit_keep_blocks_independent_coverage(self):
        directory=self.prepare();sha=hashlib.sha256(json.dumps(UNITS,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
        (directory/'protections.json').write_text(json.dumps({'version':3,'unitsSha256':sha,'reviewUnitIds':[],'keepUnitIds':['a']}))
        with patch.object(sem,'run_command') as model:result=sem.model_decisions(UNITS,self.root,resume=True)
        model.assert_not_called();self.assertEqual(result[0]['action'],'review');self.assertIn('a',result[0]['keepUnitIds'])

    def test_v2_lexical_only_protection_can_migrate_but_primary_review_cannot(self):
        directory=self.prepare();sha=hashlib.sha256(json.dumps(UNITS,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
        (directory/'protections.json').write_text(json.dumps({'version':2,'unitsSha256':sha,'reviewUnitIds':['a'],'keepUnitIds':['b']}))
        with patch.object(sem,'run_command',side_effect=self.runner(APPROVAL,[])):
            self.assertEqual(sem.model_decisions(UNITS,self.root,resume=True)[0]['action'],'delete')
        review=copy.deepcopy(PRIMARY);review['decisions'][0]['action']='review'
        prior=directory/'attempts/prior';prior.mkdir(parents=True);(prior/'prompt.txt').write_text(sem.build_prompt(UNITS));(prior/'response.json').write_text(json.dumps(review))
        (directory/'protections.json').write_text(json.dumps({'version':2,'unitsSha256':sha,'reviewUnitIds':['a'],'keepUnitIds':['b']}))
        with patch.object(sem,'run_command',side_effect=AssertionError('prior primary review cannot upgrade')) as model:
            self.assertEqual(sem.model_decisions(UNITS,self.root,resume=True)[0]['action'],'review')
        model.assert_not_called()

    def test_unproven_legacy_review_protection_is_not_cleared(self):
        directory=self.prepare();sha=hashlib.sha256(json.dumps(UNITS,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
        # No raw response ever targeted b as lexical-only delete; its old review must survive.
        (directory/'protections.json').write_text(json.dumps({'version':2,'unitsSha256':sha,'reviewUnitIds':['b'],'keepUnitIds':[]}))
        reviewed,kept=sem._load_protections(directory,UNITS,sha)
        self.assertIn('b',reviewed)

    def test_coverage_cache_is_bound_to_primary_content_and_full_units(self):
        self.prepare();calls=[]
        with patch.object(sem,'run_command',side_effect=self.runner(APPROVAL,calls)):
            sem.model_decisions(UNITS,self.root,resume=True)
            changed=copy.deepcopy(PRIMARY);changed['decisions'][0]['reason']='另一种明确重录理由';self.prepare(primary=changed)
            sem.model_decisions(UNITS,self.root,resume=True)
            units=copy.deepcopy(UNITS);units[1]['endSeconds']=3.1;self.prepare(units,changed)
            sem.model_decisions(units,self.root,resume=True)
        self.assertEqual(len(calls),3)


if __name__=='__main__':unittest.main()
