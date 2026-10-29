import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,symlinkSync,rmSync,utimesSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {getTimelineMedia} from '../lib/editor-timeline-media.mjs';
test('real thumbnail/audio extraction is bounded, cached and deduplicated',async()=>{
 const root=mkdtempSync(join(tmpdir(),'timeline-media-'));
 try {
 execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=s=160x90:r=10:d=1','-f','lavfi','-i','sine=frequency=440:duration=1','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',join(root,'test.mp4')]);
 const [a,b]=await Promise.all([getTimelineMedia('test.mp4',{root}),getTimelineMedia('test.mp4',{root})]);
 assert.deepEqual(a,b);assert.ok(a.thumbnails.length>0&&a.thumbnails.length<=12);assert.ok(a.peaks.length>0&&a.peaks.length<=1200);assert.ok(a.peaks.some(p=>p>0));assert.ok(a.peaks.every(p=>p>=0&&p<=1));assert.equal(a.sampleSeconds,a.durationSeconds/a.peaks.length);assert.deepEqual(await getTimelineMedia('test.mp4',{root}),a);
 utimesSync(join(root,'test.mp4'),new Date(),new Date(Date.now()+2000));const refreshed=await getTimelineMedia('test.mp4',{root});assert.notEqual(refreshed.thumbnails[0].url,a.thumbnails[0].url);
 execFileSync('ffmpeg',['-v','error','-i',join(root,'test.mp4'),'-an','-c:v','copy',join(root,'silent.mp4')]);assert.deepEqual((await getTimelineMedia('silent.mp4',{root})).peaks,[]);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('rejects traversal, symlink escape and unsupported files',async()=>{const root=mkdtempSync(join(tmpdir(),'timeline-safe-'));try{writeFileSync(join(root,'a.txt'),'x');symlinkSync('/tmp',join(root,'escape'));await assert.rejects(getTimelineMedia('../outside.mp4',{root}));await assert.rejects(getTimelineMedia('/tmp/a.mp4',{root}));await assert.rejects(getTimelineMedia('a.txt',{root}));await assert.rejects(getTimelineMedia('escape/a.mp4',{root}));}finally{rmSync(root,{recursive:true,force:true});}});
