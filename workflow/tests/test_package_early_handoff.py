import json
from pathlib import Path
import tempfile
import unittest
from tools.package_early_handoff import publish_early_handoff
class HandoffTests(unittest.TestCase):
    def test_ready_canonical_and_immutable(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); script=root/'script.md';script.write_text('全部口播')
            video=root/'v.mp4';video.write_bytes(b'video');srt=root/'v.srt';srt.write_text('1\n00:00:00,000 --> 00:00:01,000\n全部口播\n')
            request={'projectId':'p','runId':'r','outputRoot':tmp,'packageRoot':str(root/'package'),'finalScriptPath':str(script),'videoPath':str(video),'sourceSrtPath':str(srt),'canvas':{'width':1920,'height':1080}}
            semantic=root/'semantic.json';semantic.write_text(json.dumps({'projectId':'p','sections':[{'id':'s1','sourceCueIds':[1],'requirementVersion':1,'title':'标题','narration':'全部口播','animationNeed':'required','goal':'理解','reason':'必要','information':['信息'],'relations':[],'boundaries':[]}],'sourceVideoPath':str(video),'sourceSrtPath':str(srt)}))
            value=publish_early_handoff(request,semantic)
            self.assertEqual(value['status'],'ready')
            text=Path(value['planPath']).read_text()
            self.assertEqual(text.count('## 给 Claude 的动画提示词'),1)
            self.assertNotIn('productionReceiptPaths',value)
            semantic.write_text('{}')
            self.assertEqual(publish_early_handoff(request,semantic)['status'],'blocked')
            self.assertEqual(publish_early_handoff(request,semantic)['status'],'blocked')
    def test_missing_reports_actual_path(self):
        with tempfile.TemporaryDirectory() as root:
            value=publish_early_handoff({'outputRoot':root,'packageRoot':root,'projectId':'p','runId':'r','finalScriptPath':root+'/absent'},Path(root)/'missing')
            self.assertEqual(value['status'],'blocked')
            self.assertIn(str(Path(root)/'missing'),value['missingPaths'])

    def test_incomplete_semantics_cannot_publish(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for name,text in [('script','全部'),('video','v'),('srt','1\n00:00:00,000 --> 00:00:01,000\n全部\n')]:
                (root/name).write_text(text)
            semantic=root/'semantic';semantic.write_text(json.dumps({'projectId':'p','sourceVideoPath':str(root/'video'),'sourceSrtPath':str(root/'srt'),'sections':[{'id':'s1','sourceCueIds':[],'requirementVersion':1,'title':'x','narration':'部分','animationNeed':'required','goal':'x','reason':'x','information':[],'relations':[],'boundaries':[]}]}))
            request={'projectId':'p','runId':'r','outputRoot':tmp,'finalScriptPath':str(root/'script'),'sourceSrtPath':str(root/'srt'),'videoPath':str(root/'video'),'canvas':{'width':1920,'height':1080}}
            self.assertEqual(publish_early_handoff(request,semantic)['status'],'blocked')

    def test_two_restarts_preserve_final_report_and_original_early_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for name,text in [('script','全部'),('video','v'),('srt','1\n00:00:00,000 --> 00:00:01,000\n全部\n')]:
                (root/name).write_text(text)
            semantic=root/'semantic';semantic.write_text(json.dumps({'projectId':'p','sourceVideoPath':str(root/'video'),'sourceSrtPath':str(root/'srt'),'sections':[{'id':'s1','sourceCueIds':[1],'requirementVersion':1,'title':'x','narration':'全部','animationNeed':'required','goal':'x','reason':'x','information':[],'relations':[],'boundaries':[]}]}))
            request={'projectId':'p','runId':'r','outputRoot':tmp,'finalScriptPath':str(root/'script'),'sourceSrtPath':str(root/'srt'),'videoPath':str(root/'video'),'canvas':{'width':1920,'height':1080}}
            early=publish_early_handoff(request,semantic)
            final_text='# 已最终汇总\n\n七项回执和最终提示词。\n'
            plan=Path(early['planPath']);plan.write_text(final_text)
            for _ in range(2):
                restarted=publish_early_handoff(request,semantic)
                self.assertEqual(plan.read_text(),final_text)
                self.assertEqual(restarted['planSha256'],early['planSha256'])
                self.assertEqual(restarted['planStatus'],'preserved_existing')
