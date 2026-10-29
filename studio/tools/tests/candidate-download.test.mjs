import test from 'node:test';
import assert from 'node:assert/strict';
import {isPublicAddress,assertReusableCandidate} from '../lib/candidate-download.mjs';
test('download rejects private IPv4 and IPv6 including mapped addresses',()=>{
 for(const ip of ['127.0.0.1','10.1.2.3','172.20.0.1','192.168.1.2','169.254.1.2','0.0.0.0','::1','fc00::1','fe80::1','::ffff:127.0.0.1','::ffff:7f00:1','2001:2::10','198.18.0.16']) assert.equal(isPublicAddress(ip),false,ip);
 for(const ip of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111']) assert.equal(isPublicAddress(ip),true,ip);
});
test('rights must be explicit and website URL is not a direct download',()=>{
 assert.throws(()=>assertReusableCandidate({url:'https://example.com',license:'unknown'}));
 assert.throws(()=>assertReusableCandidate({downloadUrl:'https://example.com/a.mp4',license:'unknown'}));
 assert.equal(assertReusableCandidate({downloadUrl:'https://example.com/a.mp4',license:'CC0'}),'https://example.com/a.mp4');
 for(const license of ['Pexels License','Pixabay License',{name:'Pexels License'}]) assert.equal(assertReusableCandidate({downloadUrl:'https://example.com/a.mp4',license}),'https://example.com/a.mp4');
 assert.throws(()=>assertReusableCandidate({downloadUrl:'https://example.com/a.mp4',license:'Pexels License except this is paid'}));
});
import {downloadPublicMedia,inspectDownloadedMedia} from '../lib/candidate-download.mjs';
import {mkdtempSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
test('actual downloader rejects loopback before making any request or writing a file',async()=>{
 const target=join(mkdtempSync(join(tmpdir(),'candidate-network-')),'media.mp4');
 await assert.rejects(downloadPublicMedia('http://127.0.0.1/media.mp4',target),/非公网/);
 assert.equal(existsSync(target),false);
});
test('media inspection probes and fully decodes real 720p video; low resolution is rejected',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'candidate-quality-'));
 for(const [name,size] of [['good','1280x720'],['low','640x360']]){
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i',`color=c=blue:s=${size}:r=10`,'-t','0.3','-c:v','libx264','-pix_fmt','yuv420p',join(dir,name+'.mp4')]);
 }
 const meta=await inspectDownloadedMedia(join(dir,'good.mp4'));
 assert.equal(meta.width,1280);assert.equal(meta.kind,'video');
 await assert.rejects(inspectDownloadedMedia(join(dir,'low.mp4')),/720px/);
});
import {copyFileSync,writeFileSync,readFileSync} from 'node:fs';
import {createDocument,saveDocument,resolveDocumentPath} from '../lib/editor-store.mjs';
import {createProductionPlanService} from '../lib/production-plan-jobs.mjs';
test('download cache survives service reload, is idempotent, rejects changed bytes and GET never downloads',async()=>{
 const root=mkdtempSync(join(tmpdir(),'candidate-cache-')), source=join(root,'source.mp4');
 execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=1280x720:r=10','-t','0.3','-c:v','libx264','-pix_fmt','yuv420p',source]);
 writeFileSync(join(root,'poster.jpg'),'representative frame');
 let downloads=0;
 const options={root,rootDir:join(root,'index'),artifactRoot:join(root,'artifacts'),autoStart:false,candidateDownloadTools:{download:async(url,target)=>{assert.equal(url,'https://example.com/stored.mp4');downloads++;copyFileSync(source,target);},inspect:inspectDownloadedMedia}};
 saveDocument(createDocument({id:'cache',name:'Cache',canvas:{width:1280,height:720,fps:{num:30,den:1},durationFrames:90},productionPlan:{shots:[{id:'s',keyframes:[{path:join(root,'poster.jpg')}],slots:[{id:'slot',type:'animation',description:'素材'}],candidates:[{id:'c',slotId:'slot',title:'素材',reason:'演示',previewPath:join(root,'poster.jpg'),url:'https://example.com/page',downloadUrl:'https://example.com/stored.mp4',license:'Pexels License'}]}]}}),options);
 const request={projectId:'cache',shotId:'s',candidateId:'c'};
 const first=createProductionPlanService(options);
 assert.deepEqual(await first.candidateMedia(request),{candidateId:'c',available:false});assert.equal(downloads,0);
 const downloaded=await first.candidateDownload(request);assert.equal(downloads,1);
 assert.equal(downloaded.kind,"video");
 assert.match(downloaded.url,/browserPreview=1/);
 assert.doesNotMatch(downloaded.downloadUrl,/browserPreview=1/);
 const before=readFileSync(join(dirname(resolveDocumentPath('cache',options)),'candidate-media-cache.json'),'utf8');
 const second=createProductionPlanService(options);
 const restored=await second.candidateMedia(request);assert.equal(restored.available,true);assert.equal(restored.path,downloaded.path);assert.match(restored.url,/browserPreview=1/);
 assert.equal(readFileSync(join(dirname(resolveDocumentPath('cache',options)),'candidate-media-cache.json'),'utf8'),before);
 assert.equal((await second.candidateDownload(request)).path,downloaded.path);assert.equal(downloads,1);
 writeFileSync(downloaded.path,'tampered');
 assert.deepEqual(await second.candidateMedia(request),{candidateId:'c',available:false});assert.equal(downloads,1);
 assert.throws(()=>second.resolveFile('cache',downloaded.path),/not referenced/);
 const repaired=await second.candidateDownload(request);assert.equal(downloads,2);assert.notEqual(repaired.path,downloaded.path);
 first.close();second.close();
});
import {resolvePublicAddresses} from '../lib/candidate-download.mjs';
test('fake-IP fallback resolves through fixed public DoH but never permits private responses',async()=>{
 let calls=0;
 const local=async()=>[{address:'198.18.0.16',family:4},{address:'2001:2::10',family:6}];
 const result=await resolvePublicAddresses('videos.pexels.com',{lookupFn:local,dohFn:async host=>{calls++;assert.equal(host,'videos.pexels.com');return [{address:'104.18.67.220',family:4}];}});
 assert.equal(result[0].address,'104.18.67.220');assert.equal(calls,1);
 await assert.rejects(resolvePublicAddresses('example.com',{lookupFn:local,dohFn:async()=>[{address:'127.0.0.1',family:4}]}),/非公网/);
 await assert.rejects(resolvePublicAddresses('example.com',{lookupFn:async()=>[{address:'10.0.0.1',family:4}],dohFn:async()=>{throw new Error('must not call');}}),/非公网/);
});
