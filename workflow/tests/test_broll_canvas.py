"""Canvas guard regression tests; no network or third-party Python packages."""
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'tools' / 'broll_canvas.py'


class CanvasTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(SCRIPT.exists(), 'canvas guard has not been implemented')
        spec = importlib.util.spec_from_file_location('broll_canvas', SCRIPT)
        self.guard = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.guard)

    def dimensions(self, **values):
        stream = dict(codec_type='video', width=1920, height=1080,
                      sample_aspect_ratio='1:1', **values)
        return self.guard.canvas_from_probe({'streams': [stream]}, 'source.mp4')

    def test_landscape_source(self):
        result = self.dimensions()
        self.assertEqual((result['width'], result['height']), (1920, 1080))
        self.assertEqual(result['aspectRatio'], '16:9')
        self.assertEqual(result['source'], 'source.mp4')

    def test_rotation_swaps_display_not_coded_dimensions(self):
        result = self.dimensions(side_data_list=[{'rotation': -90}])
        self.assertEqual((result['displayWidth'], result['displayHeight']), (1080, 1920))
        self.assertEqual(result['aspectRatio'], '9:16')

    def test_legacy_rotation(self):
        self.assertEqual(self.dimensions(tags={'rotate': '270'})['aspectRatio'], '9:16')

    def test_anamorphic_pixels(self):
        result = self.guard.canvas_from_probe({'streams': [{'codec_type': 'video',
            'width': 1440, 'height': 1080, 'sample_aspect_ratio': '4:3'}]}, 'a.mov')
        self.assertEqual(result['aspectRatio'], '16:9')
        self.assertEqual(result['width'], 1920)

    def test_odd_source_recommends_even_pixels(self):
        result = self.guard.canvas_from_probe({'streams': [{'codec_type': 'video',
            'width': 1919, 'height': 1079}]}, 'a.mov')
        self.assertEqual(result['width'] % 2, 0)
        self.assertEqual(result['height'] % 2, 0)

    def test_audio_and_attached_cover_are_not_master_video(self):
        for streams in ([{'codec_type': 'audio'}], [{'codec_type': 'video',
                'width': 100, 'height': 100, 'disposition': {'attached_pic': 1}}]):
            with self.assertRaises(ValueError):
                self.guard.canvas_from_probe({'streams': streams}, 'voice.mp3')

    def test_arbitrary_rotation_not_silently_assumed(self):
        with self.assertRaises(ValueError):
            self.dimensions(side_data_list=[{'rotation': 45}])

    def test_contract_checks_every_mode_and_top_level(self):
        contract = {'canvas': {'width': 1920, 'height': 1080}, 'shots': [
            {'id': '003', 'presentationMode': 'overlay', 'output': {'width': 1920, 'height': 1080}},
            {'id': '005', 'presentationMode': 'immersive', 'output': {'width': 1080, 'height': 1920}}]}
        errors = self.guard.check_contract(contract, self.dimensions())
        self.assertEqual(len(errors), 1)
        self.assertIn('005', errors[0])
        contract['canvas'] = {'width': 1080, 'height': 1920}
        self.assertEqual(len(self.guard.check_contract(contract, self.dimensions())), 2)

    def test_missing_output_is_not_inherited_silently(self):
        errors = self.guard.check_contract({'canvas': {'width': 1920, 'height': 1080},
            'shots': [{'id': '003', 'presentationMode': 'overlay'}]}, self.dimensions())
        self.assertTrue(errors)

    def test_explicit_target_ratio_overrides_source(self):
        result = self.guard.apply_aspect_override(self.dimensions(), '1:1')
        self.assertEqual(result['aspectRatio'], '1:1')
        self.assertEqual(result['width'], result['height'])
        self.assertEqual(result['sourceAspectRatio'], '16:9')

    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'requires ffmpeg')
    def test_cli_real_video_and_contract_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            video = Path(temp) / 'video.mp4'
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i',
                'color=s=320x180:r=1', '-t', '1', '-c:v', 'mpeg4', str(video)], check=True)
            probe = subprocess.run([sys.executable, str(SCRIPT), 'probe', '--video', str(video)],
                capture_output=True, text=True)
            self.assertEqual(probe.returncode, 0, probe.stderr)
            self.assertEqual(json.loads(probe.stdout)['aspectRatio'], '16:9')
            contract = Path(temp) / 'contract.json'
            contract.write_text(json.dumps({'canvas': {'width': 320, 'height': 180},
                'shots': [{'id': 'test', 'output': {'width': 180, 'height': 320}}]}))
            checked = subprocess.run([sys.executable, str(SCRIPT), 'check', '--video', str(video),
                '--contract', str(contract), '--files', str(video)], capture_output=True, text=True)
            self.assertEqual(checked.returncode, 1, checked.stderr)
            self.assertFalse(json.loads(checked.stdout)['passed'])
            contract.write_text(json.dumps({'canvas': {'width': 320, 'height': 180},
                'shots': [{'id': 'test', 'output': {'width': 320, 'height': 180}}]}))
            passed = subprocess.run([sys.executable, str(SCRIPT), 'check', '--video', str(video),
                '--contract', str(contract), '--files', str(video)], capture_output=True, text=True)
            self.assertEqual(passed.returncode, 0, passed.stderr)
            portrait = Path(temp) / 'portrait.mp4'
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i',
                'color=s=180x320:r=1', '-t', '1', '-c:v', 'mpeg4', str(portrait)], check=True)
            failed_file = subprocess.run([sys.executable, str(SCRIPT), 'check', '--video', str(video),
                '--contract', str(contract), '--files', str(portrait)], capture_output=True, text=True)
            self.assertEqual(failed_file.returncode, 1, failed_file.stderr)
            self.assertIn('file ', json.loads(failed_file.stdout)['errors'][0])
            audio = Path(temp) / 'audio.wav'
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc',
                            '-t', '0.1', str(audio)], check=True)
            failed_audio = subprocess.run([sys.executable, str(SCRIPT), 'probe', '--video', str(audio)],
                                         capture_output=True, text=True)
            self.assertEqual(failed_audio.returncode, 2)
            self.assertIn('No real video stream', failed_audio.stderr)

    def test_cli_missing_source_does_not_default_portrait(self):
        result = subprocess.run([sys.executable, str(SCRIPT), 'probe', '--video', '/no/such/video.mp4'],
            capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('"width": 1080', result.stdout)


if __name__ == '__main__':
    unittest.main()
