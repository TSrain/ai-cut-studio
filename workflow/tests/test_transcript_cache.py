import concurrent.futures
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
import wave
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import transcribe
import transcript_cache as cache

class SharedTranscriptTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.env=patch.dict(os.environ,{'TRANSCRIPT_CACHE_ROOT':str(self.root/'cache')});self.env.start()
        self.audio=self.root/'source.wav';self.make_audio(self.audio,100)
        self.cues=[{'start':0,'end':.5,'text':'复用同一段口播'}]
    def tearDown(self):self.env.stop();self.tmp.cleanup()
    def make_audio(self,path,value):
        with wave.open(str(path),'wb') as f:f.setparams((1,2,16000,0,'NONE','not compressed'));f.writeframes(value.to_bytes(2,'little',signed=True)*16000)
    def recognize(self,*args,**kwargs):return {'cues':self.cues,'minute_url':'test','format':'srt'}
    def test_cross_prefix_and_copy_reuse_without_asr(self):
        copied=self.root/'copied.wav';shutil.copyfile(self.audio,copied)
        with patch.object(transcribe,'_transcribe_uncached',side_effect=self.recognize) as asr:
            transcribe.transcribe(self.audio,self.root/'camera'/'transcript')
            r=transcribe.transcribe(copied,self.root/'subtitles'/'transcript')
            self.assertEqual(asr.call_count,1);self.assertTrue(r['reused']);self.assertEqual(transcribe.load_cues(r['path']),self.cues)
    def test_changed_audio_same_name_does_not_reuse(self):
        with patch.object(transcribe,'_transcribe_uncached',side_effect=self.recognize) as asr:
            transcribe.transcribe(self.audio,self.root/'result')
            self.make_audio(self.audio,200)
            transcribe.transcribe(self.audio,self.root/'result')
            self.assertEqual(asr.call_count,2)
    def test_explicit_existing_srt_and_alias_need_no_asr(self):
        srt=self.root/'known.srt';srt.write_text('1\n00:00:00,000 --> 00:00:00,500\n已校对文字\n')
        other=self.root/'video-audio.wav';self.make_audio(other,300)
        transcribe.register_transcript(self.audio,srt,[other])
        with patch.object(transcribe,'_transcribe_uncached',side_effect=AssertionError('MUST NOT RECOGNIZE')):
            result=transcribe.transcribe(other,self.root/'later');self.assertEqual(result['cues'][0]['text'],'已校对文字')
    def test_concurrent_callers_only_recognize_once_and_force_is_explicit(self):
        def slow(*a,**k):time.sleep(.1);return self.recognize()
        with patch.object(transcribe,'_transcribe_uncached',side_effect=slow) as asr:
            with concurrent.futures.ThreadPoolExecutor(2) as pool:
                results=list(pool.map(lambda n:transcribe.transcribe(self.audio,self.root/str(n)),[1,2]))
            self.assertEqual(asr.call_count,1)
            transcribe.transcribe(self.audio,self.root/'force',force=True);self.assertEqual(asr.call_count,2)
    def test_source_change_during_recognition_is_not_published(self):
        key=cache.media_key(self.audio)
        def changed(*a,**k):
            self.make_audio(self.audio,999);return self.recognize()
        with patch.object(transcribe,'_transcribe_uncached',side_effect=changed):
            with self.assertRaisesRegex(transcribe.TranscribeError,'已变化'):
                transcribe.transcribe(self.audio,self.root/'changed')
        self.assertIsNone(cache.read(key))
    def test_corrupt_record_does_not_silently_succeed(self):
        key=cache.media_key(self.audio);p=cache.root()/'records'/f'{key}.json';p.parent.mkdir();p.write_text('{broken')
        with patch.object(transcribe,'_transcribe_uncached',side_effect=self.recognize) as asr:
            transcribe.transcribe(self.audio,self.root/'fixed');self.assertEqual(asr.call_count,1)
if __name__=='__main__':unittest.main()
