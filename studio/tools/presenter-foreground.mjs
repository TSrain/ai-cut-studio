#!/usr/bin/env node
import {preparePresenterPreview} from './lib/presenter-preview.mjs';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,readdirSync,renameSync} from 'node:fs';
import {resolve,join,dirname,relative,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {probeNativeVideo} from './lib/editor-native-video.mjs';
import {fileURLToPath} from 'node:url';
import {sourceDigest,validatePresenterAssets,validatePresenterSourceClock} from './lib/presenter-foreground.mjs';
const [action,...args]=process.argv.slice(2),root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const options=Object.fromEntries(args.reduce((a,x,n)=>n%2?a:[...a,[x.replace(/^--/,''),args[n+1]]],[]));
const document=JSON.parse(readFileSync(options.document,'utf8')),fps=document.canvas.fps.num/document.canvas.fps.den;
const publicRoot=resolve(options['public-root']??join(root,'templates/remotion-base/public'));
if(action==='prepare'){
 const source=document.source;if(!source?.publicPath)throw Error('需要已导入的 public 底片');
 const start=Number(options['source-start-frame']),count=Number(options.frames);
 if(!Number.isInteger(start)||start<0||!Number.isInteger(count)||count<1)throw Error('source-start-frame/frames 必须为合法源帧');
 const input=resolve(publicRoot,source.publicPath),rel=relative(publicRoot,input);
 if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('源底片必须在 public 内');
 validatePresenterSourceClock(probeNativeVideo(input),fps,{sourceStartFrame:start,frameCount:count});
 const hash=sourceDigest(input);
 const run=randomUUID(),publicPath=`presenter-foreground/${hash.slice(0,16)}-${fps}-${start}-${count}-${run}`,published=join(publicRoot,publicPath),output=join(publicRoot,'presenter-foreground',`.pending-${run}`);
 const tmp=mkdtempSync(join(tmpdir(),'presenter-'));
 try{
  mkdirSync(output,{recursive:true});mkdirSync(join(tmp,'frames'));
  execFileSync('ffmpeg',['-v','error','-nostdin','-y','-ss',String(start/fps),'-i',input,'-vf',`fps=${fps},scale=w='min(iw,${document.canvas.width})':h=-2`,'-vsync','0','-frames:v',String(count),'-start_number','0',join(tmp,'frames','%06d.png')],{stdio:'inherit'});
  execFileSync('swiftc',['-O','-module-cache-path',join(tmp,'swift-cache'),join(root,'tools/presenter-matte.swift'),'-o',join(tmp,'matte')],{stdio:'inherit'});
  execFileSync(join(tmp,'matte'),[join(tmp,'frames'),output],{stdio:'inherit'});
  if(readdirSync(output).filter(x=>x.endsWith('.png')).length!==count)throw Error('源视频长度不足或前景缺帧');
  const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',join(output,'000000.png')],{encoding:'utf8'})).streams[0];
  const manifest={version:1,sourcePath:source.path,sourcePublicPath:source.publicPath,sourceSha256:hash,fps,sourceStartFrame:start,frameCount:count,width:probe.width,height:probe.height,framesPublicPath:publicPath};
  preparePresenterPreview(output,manifest);
  writeFileSync(join(output,'manifest.json'),JSON.stringify(manifest,null,2));renameSync(output,published);console.log(join(published,'manifest.json'));
 }finally{rmSync(tmp,{recursive:true,force:true});rmSync(output,{recursive:true,force:true});}
}else if(action==='attach'){
 if(!options.out||resolve(options.out)===resolve(options.document))throw Error('attach 必须显式 --out 新文档；活动工程请经现有 editor 保存 API');
 const instance=document.instances.find(i=>i.id===options.instance);if(!instance)throw Error('找不到目标动画');
 instance.props.presenterLayer='behind';instance.props.presenterForeground=JSON.parse(readFileSync(options.manifest,'utf8'));instance.props.editorBackground='transparent';
 validatePresenterAssets(document,{publicRoot});writeFileSync(options.out,JSON.stringify(document,null,2));
}else if(action==='validate'){validatePresenterAssets(document,{publicRoot});console.log('valid');}
else throw Error('usage: prepare --document FILE --source-start-frame N --frames N | attach --document FILE --instance ID --manifest FILE --out NEW_FILE | validate --document FILE');
