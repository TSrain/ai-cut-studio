import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {renderMediaSize,prepareRenderMedia} from '../lib/editor-render-media.mjs';
const instance=()=>({assetId:'media-stage',props:{slots:{clip:'clips/source.mp4'},variant:{fit:'contain',ratio:'auto'},tune:{scale:1}}});
const canvas={width:1920,height:1080};
const stream={width:3840,height:2160,pix_fmt:'yuv420p',color_transfer:'bt709'};
test('only downsample when the complete displayed clip stays above output resolution',()=>{
 assert.deepEqual(renderMediaSize(instance(),canvas,stream),{width:1920,height:1080});
 const i=instance();i.props.tune.scale=2;assert.equal(renderMediaSize(i,canvas,stream),null);
 i.props.tune.scale=1;i.props.variant.fit='cover';assert.equal(renderMediaSize(i,canvas,stream),null);
 assert.equal(renderMediaSize(instance(),canvas,{...stream,color_transfer:'smpte2084'}),null);
 assert.equal(renderMediaSize(instance(),canvas,{...stream,side_data_list:[{rotation:90}]}),null);
});
test('real CFR preparation preserves frames, reuses cache and never mutates editor props',async t=>{
 const root=mkdtempSync(join(tmpdir(),'render-media-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'clips'));
 execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=640x360:rate=30','-t','0.5','-c:v','libx264','-pix_fmt','yuv420p',join(root,'clips/source.mp4')]);
 const props={document:{canvas:{width:320,height:180},instances:[instance()]}};
 const out=await prepareRenderMedia(props,{publicRoot:root});assert.equal(out.prepared,1);assert.equal(out.hits,0);
 assert.equal(props.document.instances[0].props.slots.clip,'clips/source.mp4');
 const file=join(root,out.props.document.instances[0].props.slots.clip);
 const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',file],{encoding:'utf8'})).streams[0];
 assert.equal(probe.width,320);assert.equal(probe.height,180);assert.equal(Number(probe.nb_frames),15);
 const again=await prepareRenderMedia(props,{publicRoot:root});assert.equal(again.hits,1);
});
