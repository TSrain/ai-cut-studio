import test from 'node:test';import assert from 'node:assert/strict';import{mkdtempSync,readFileSync,readdirSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{execFileSync}from'node:child_process';
import{presenterAtlasLayout,presenterAtlasTile}from'../../templates/remotion-base/src/editor/presenter-atlas.mjs';
import{preparePresenterPreview}from'../lib/presenter-preview.mjs';
test('4K matte uses bounded preview tiles and exact page/seek positions',()=>{
 const m={width:2160,height:3840,frameCount:130,framesPublicPath:'matte'};
 assert.deepEqual(presenterAtlasLayout(m),{width:360,height:640,columns:8,rows:8,capacity:64});
 assert.equal(presenterAtlasTile(m,63).x,2520);assert.equal(presenterAtlasTile(m,63).y,4480);
 assert.equal(presenterAtlasTile(m,64).path,'matte/preview-mask-v1/0001.png');
 assert.equal(presenterAtlasTile(m,0).path,'matte/preview-mask-v1/0000.png');
 assert.throws(()=>presenterAtlasTile(m,130));
});
test('generated atlas contains inverse alpha, correct page order and partial final page',()=>{
 const dir=mkdtempSync(join(tmpdir(),'presenter-atlas-test-'));
 try{
  const raw=Buffer.alloc(70*2*2*4);for(let n=0;n<70;n++)for(let p=0;p<4;p++)raw.set([n*3,200,43,n*3],(n*4+p)*4);
  execFileSync('ffmpeg',['-v','error','-f','rawvideo','-pix_fmt','rgba','-s','2x2','-i','pipe:0','-start_number','0',join(dir,'%06d.png')],{input:raw});
  const manifest={width:2,height:2,frameCount:70,fps:30};const out=preparePresenterPreview(dir,manifest);
  assert.equal(readdirSync(out).filter(f=>f.endsWith('.png')).length,2);
  for(const page of [0,1]){const decoded=execFileSync('ffmpeg',['-v','error','-i',join(out,`${String(page).padStart(4,'0')}.png`),'-f','rawvideo','-pix_fmt','gray','pipe:1']);assert.equal(decoded.length,16*16);
   for(let n=0;n<Math.min(64,70-page*64);n++){const x=n%8*2,y=Math.floor(n/8)*2;assert.equal(decoded[y*16+x],255-(page*64+n)*3);}
  }
  assert.equal(preparePresenterPreview(dir,manifest),out);
  assert.equal(JSON.parse(readFileSync(join(out,'ready.json'))).frameCount,70);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
