import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from tools.package_branch_metrics import record_event, summarize_metrics

class MetricsTests(unittest.TestCase):
    def test_durable_dedup_unknown_usage_and_stage_separation(self):
        with tempfile.TemporaryDirectory() as root:
            events=[{'eventId':str(i),'branchId':'cover','attemptId':'a','stage':stage,'monotonic':t} for i,(stage,t) in enumerate([('queued',1),('start',3),('model-return',8),('application',9),('readback',11),('finalize',12)])]
            with ThreadPoolExecutor(8) as pool:
                list(pool.map(lambda e:record_event(root,e),events*4))
            value=summarize_metrics(root)
            self.assertEqual(value['eventCount'],6)
            self.assertEqual(value['branches']['cover']['queueSeconds'],2)
            self.assertEqual(value['branches']['cover']['modelSeconds'],5)
            self.assertEqual(value['branches']['cover']['applicationSeconds'],2)
            self.assertIsNone(value['inputTokens'])
    def test_usage_only_actual_and_cancel_not_success(self):
        with tempfile.TemporaryDirectory() as root:
            record_event(root,{'eventId':'1','branchId':'camera','stage':'cancelled','usage':{'input_tokens':12,'output_tokens':3},'bundleBytes':80})
            value=summarize_metrics(root)
            self.assertEqual(value['successCount'],0)
            self.assertEqual(value['inputTokens'],12)
            self.assertEqual(value['bundleBytes'],80)
