"""Exercise lazy production validators with the same imports as tools/*.py CLI."""
import json
from pathlib import Path
import subprocess
import sys
import unittest

from tests import test_cover, test_package_production
from tools import caption_quality, package_production as production


class ProductionScriptModeTests(unittest.TestCase):
    def setUp(self):
        self.fixture = test_package_production.FullPackageTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.fixture.prepare()

    def validate_in_script_mode(self):
        fixture = self.fixture
        payload = fixture.root / 'script-mode-input.json'
        payload.write_text(json.dumps([fixture.analysis, fixture.request, fixture.document]))
        code = '''
import importlib.util, json, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
assert importlib.util.find_spec('tools') is None, 'repository root leaked into test'
import package_production
data, request, document = json.loads(Path(sys.argv[2]).read_text())
result = package_production.validate_full_package(data, request, document)
assert result['state'] == 'complete', result
print('complete')
'''
        return subprocess.run(
            [sys.executable, '-I', '-c', code,
             str(Path(__file__).resolve().parents[1] / 'tools'), str(payload)],
            cwd=fixture.root, capture_output=True, text=True, timeout=30)

    def test_executed_cover_validation_without_repository_import_path(self):
        covers = test_cover.CoverTests()
        covers.setUp()
        self.addCleanup(covers.doCleanups)
        covers.manifest.write_text(json.dumps(covers.data))
        fixture = self.fixture
        receipt_path = Path(fixture.analysis['productionReceiptPaths']['cover'])
        receipt = json.loads(receipt_path.read_text())
        receipt.update(status='executed', coverCandidateManifestPath=str(covers.manifest))
        receipt['files'] += [{'path': str(path), 'sha256': production.digest(path)}
                             for path in covers.root.rglob('*') if path.is_file()]
        receipt_path.write_text(json.dumps(receipt))
        fixture.analysis['productionDesign']['cover']['decision'] = 'executed'
        completed = self.validate_in_script_mode()
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(completed.stdout.strip(), 'complete')

    def test_executed_caption_quality_without_repository_import_path(self):
        fixture = self.fixture
        fixture.request['captionSegmentationVersion'] = 1
        fixture.document.update(revision=1, captions={'enabled': True, 'cues': [
            {'id': 'caption-1', 'startFrame': 0, 'endFrame': 60, 'text': '工具降低执行成本'}]})
        snapshot = fixture.root / 'caption-readback.json'
        snapshot.write_text(json.dumps({'document': fixture.document}))
        cue = fixture.document['captions']['cues'][0]
        review = fixture.root / 'caption-segmentation.json'
        review.write_text(json.dumps({'version': 1, 'cues': [
            {'cueId': cue['id'], 'cueSha256': caption_quality.cue_digest(cue),
             'decision': 'keep', 'reason': '单个完整表达'}]}))
        receipt_path = Path(fixture.analysis['productionReceiptPaths']['captions'])
        receipt = json.loads(receipt_path.read_text())
        receipt.update(status='executed', captionSegmentationReviewPath=str(review), engineering={
            'snapshotPath': str(snapshot), 'revision': 1, 'instanceIds': [], 'fields': [
                {'pointer': '/captions', 'sha256': production.json_digest(fixture.document['captions'])}]})
        receipt['files'] += [{'path': str(path), 'sha256': production.digest(path)}
                             for path in (snapshot, review)]
        receipt_path.write_text(json.dumps(receipt))
        fixture.analysis['productionDesign']['captions']['decision'] = 'executed'
        completed = self.validate_in_script_mode()
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(completed.stdout.strip(), 'complete')


if __name__ == '__main__':
    unittest.main()
