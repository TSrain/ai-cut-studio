#!/usr/bin/env node
import {remixHybridAudio} from './lib/editor-hybrid-audio.mjs';
// One queue slot owns this process, snapshot, and output. Bundle cache is shared.
import {showCoverAtFrame} from '../templates/remotion-base/src/editor/cover-frame.mjs';
import {hasVisibleCaptions} from '../templates/remotion-base/src/editor/captions.mjs';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {constants as fsConstants} from 'node:fs';
import {planHybrid,runHybrid,isDirectMedia} from './lib/editor-hybrid.mjs';
import {cachedRaster,exportPolicy,silentVisualProps,exportRasterGeometry,hasEmbeddedAudio} from './lib/editor-export-cache.mjs';
import {prepareRenderMedia} from './lib/editor-render-media.mjs';
import {ensureExportBundle} from './lib/editor-bundle-cache.mjs';
import {planNativeComposite,runNativeComposite} from './lib/editor-native-composite.mjs';
import {planNativeVideo,runNativeVideo} from './lib/editor-native-video.mjs';
import {planNativeSource,runNativeSource} from './lib/editor-native-source.mjs';
const ROOT=resolve(fileURLToPath(new URL('..',import.meta.url)));
const [directoryArg,itemId,...flags]=process.argv.slice(2);
if(!directoryArg||!itemId)throw Error('Usage: editor-export-worker.mjs <export directory> <item id>');
const directory=resolve(directoryArg),buildRoot=join(directory,'build');
const manifest=JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8'));
const item=manifest.items.find(x=>x.id===itemId);
if(!item)throw Error('导出项不存在');
const props=JSON.parse(readFileSync(join(directory,`${itemId}.props.json`),'utf8'));
const started=Date.now();
const controller=new AbortController(),signal=controller.signal;
process.once('SIGTERM',()=>controller.abort(Error('导出已取消')));
process.once('SIGINT',()=>controller.abort(Error('导出已取消')));
const previewScale=exportRasterGeometry(props.document.canvas,item.previewScale??1,item.extension).scale;
const embeddedAudio=hasEmbeddedAudio(props.document,item);
if(!Number.isFinite(previewScale)||previewScale<=0||previewScale>1)throw Error('previewScale 必须在 0–1 之间');
if(previewScale!==1)props.previewScale=previewScale;
let detail;
const emit=event=>{if(event.detail)detail=event.detail;console.log('EXPORT_PROGRESS '+JSON.stringify({detail,...event,timestamp:Date.now()}));};
const result=record=>writeFileSync(join(directory,`${itemId}.performance.json`),JSON.stringify({...record,durationMs:Date.now()-started},null,2));
const forceRemotion=embeddedAudio||previewScale<1||showCoverAtFrame(props.document,item.renderMode,item.rangeStartFrame)||Boolean(props.document.tracks?.some(t=>t.disabled))||props.document.instances.some(i=>i.disabled)||Boolean(props.document.audioClips?.length)||props.document.source?.volume!==undefined||Boolean(props.document.source?.muted)||flags.includes('--force-remotion')||hasVisibleCaptions(props.document,item.renderMode);
const policy=exportPolicy(props.document.canvas,{transparent:item.extension==='mov'});
const hardware=flags.includes('--software')?'disable':policy.hardwareAcceleration;
emit({stage:'preparing'});
if(!forceRemotion && item.renderMode==='full' && props.document.instances.length===0){
 try {
  const camera=props.document.source?.cameraPlan ? await import(pathToFileURL(join(buildRoot,'src/editor/aroll-shot-plan.mjs')).href) : undefined;
  const sourcePlan=planNativeSource(props.document,item,{publicRoot:join(buildRoot,'public'),camera});
  if(sourcePlan){
   const sourceResult=await runNativeSource(sourcePlan,{outputPath:item.path,onProgress:emit,hardwareAcceleration:flags.includes('--software')?'disable':'if-possible'});
   result({engine:'native-source',...sourceResult});emit({stage:'verifying'});process.exit(0);
  }
 } catch(e){console.log('底片合成未命中，使用完整渲染：'+e.message);emit({stage:'preparing'});}
}
if(!forceRemotion){
 try{
  const composite=planNativeComposite(props.document,item,{publicRoot:join(buildRoot,'public')});
  if(composite){const out=await runNativeComposite(composite,{outputPath:item.path,onProgress:emit});result({engine:'native-composite',...out});emit({stage:'verifying'});process.exit(0);}
 }catch(e){console.log('画面复用未命中，使用完整渲染：'+e.message);emit({stage:'preparing'});}
}
let native=null;
try{if(!forceRemotion)native=planNativeVideo(props.document,item,{publicRoot:join(buildRoot,'public')});}
catch(e){console.log('原生导出检查未命中，使用完整渲染：'+e.message);}
if(native){
 try{
  const nativeResult=await runNativeVideo(native,{outputPath:item.path,hardwareAcceleration:hardware,onProgress:p=>emit({...p,completed:p.completed??p.encodedFrames,total:p.total??p.totalFrames})});
  result({engine:'native',method:native.method,codec:nativeResult.codec,hardwareFallback:Boolean(nativeResult.hardwareFallback)});emit({stage:'verifying'});process.exit(0);
 }catch(e){console.log('原生导出未完成，回退完整渲染：'+e.message);emit({stage:'preparing'});}
}
const mediaStart=Date.now();
const media=flags.includes('--original-media')?{props,prepared:0,hits:0}:await prepareRenderMedia(props,{publicRoot:join(buildRoot,'public'),onProgress:emit});
const mediaMs=Date.now()-mediaStart;
const renderPropsPath=join(directory,`${itemId}.render.props.json`);
writeFileSync(renderPropsPath,JSON.stringify(media.props));
const require=createRequire(join(buildRoot,'package.json'));
const cliRoot=dirname(require.resolve('@remotion/cli/package.json'));
const bundleStart=Date.now();
let lastBundle=-1;
const cached=await ensureExportBundle({buildRoot,cacheRoot:join(ROOT,'workspace/editor-bundle-cache'),
 onWait:()=>{if(lastBundle!==-2){emit({stage:'preparing',detail:'等待共享编译'});lastBundle=-2;}},
 build:async(outDir,publicRoot)=>{
  const {bundle}=require('@remotion/bundler');
  await require(join(cliRoot,'dist/load-config.js')).loadConfigFile(buildRoot,'remotion.config.ts',false);
  const {ConfigInternals}=require('@remotion/cli/config');
  return bundle({entryPoint:join(buildRoot,'src/index.ts'),rootDir:buildRoot,outDir,publicDir:publicRoot,
  symlinkPublicDir:true,webpackOverride:ConfigInternals.getWebpackOverrideFn(),enableCaching:ConfigInternals.getWebpackCaching(),
  onProgress:p=>{const n=Math.floor(p);if(n!==lastBundle){emit({stage:'bundling',progress:n/100});lastBundle=n;}}});
 },
});
const bundleMs=Date.now()-bundleStart;
emit({stage:'preparing',detail:cached.hit?'复用已编译工程':'编译完成'});
const {openBrowser,selectComposition,renderMedia,renderStill,makeCancelSignal}=require('@remotion/renderer');
const cancellation=makeCancelSignal();signal.addEventListener('abort',()=>cancellation.cancel(),{once:true});if(signal.aborted)cancellation.cancel();
let browser;
const rasterRoot=join(ROOT,'workspace/editor-raster-cache');
let rasterHits=0,rasterRendered=0;
async function renderRaster(input,extension,output){
 signal.throwIfAborted();
 if(!browser)browser=await openBrowser('chrome',process.env.REMOTION_BROWSER_EXECUTABLE?{browserExecutable:process.env.REMOTION_BROWSER_EXECUTABLE}:undefined);
 const composition=await selectComposition({serveUrl:cached.path,id:'EditorComposition',inputProps:input,puppeteerInstance:browser});
 if(extension==='png'){await renderStill({serveUrl:cached.path,composition,inputProps:input,output,imageFormat:'png',puppeteerInstance:browser,frame:0,scale:previewScale,cancelSignal:cancellation.cancelSignal});return;}
 const p=exportPolicy(input.document.canvas,{transparent:extension==='mov'});
 const options={serveUrl:cached.path,composition,inputProps:input,outputLocation:output,codec:p.codec,
  ...(extension==='mov'?{proResProfile:'4444',pixelFormat:'yuva444p10le',imageFormat:'png'}:{}),
  concurrency:p.concurrency,puppeteerInstance:browser,hardwareAcceleration:hardware,scale:previewScale,cancelSignal:cancellation.cancelSignal,
  ...(extension==='mp4'?{videoBitrate:p.videoBitrate}:{}),
  offthreadVideoCacheSizeInBytes:268435456,
  onProgress:progress=>emit({stage:progress.renderedFrames<composition.durationInFrames?'rendering':'encoding',completed:progress.renderedFrames,total:composition.durationInFrames})};
 try{await renderMedia(options);}catch(e){if(hardware==='disable'||!/videotoolbox|hardware.accelerat|encoder.*(?:failed|error)|cannot.*encoder/i.test(e.message))throw e;emit({stage:'preparing',detail:'硬件编码不可用，回退软件编码'});await renderMedia({...options,hardwareAcceleration:'disable',overwrite:true});}
}
async function raster(input,extension){const result=await cachedRaster(input,extension,{root:rasterRoot,bundleKey:cached.key,publicRoot:join(buildRoot,'public'),render:renderRaster,onProgress:emit,signal});if(result.hit)rasterHits++;else rasterRendered++;return result.path;}
let succeeded=false;
try{
 const hybrid=flags.includes('--force-remotion')||previewScale<1?null:planHybrid(media.props.document,item,{publicRoot:join(buildRoot,'public')});
 if(hybrid){
  let out;
  const runtimeKey=createHash('sha256').update(readFileSync(join(ROOT,'tools/lib/editor-hybrid.mjs'))).update(readFileSync(join(ROOT,'tools/lib/editor-export-cache.mjs'))).update(readFileSync(join(ROOT,'tools/lib/editor-source-normalization.mjs'))).update(readFileSync(join(ROOT,'tools/export-caption-plates.py'))).update(hardware).digest('hex');
  const silent=silentVisualProps(media.props);
  const final=await cachedRaster(silent,item.extension,{root:join(ROOT,'workspace/editor-composite-cache'),bundleKey:cached.key+runtimeKey,publicRoot:join(buildRoot,'public'),onProgress:emit,signal,
   render:async(_input,_extension,temporary)=>{out=await runHybrid(hybrid,silent.document,item,{outputPath:temporary,workRoot:directory,renderVisual:raster,renderPlate:input=>raster(input,'png'),onProgress:emit,hardware:hardware!=='disable',signal});}});
  const remix=await remixHybridAudio(final.path,media.props.document,item,{publicRoot:join(buildRoot,'public'),outputPath:item.path,workRoot:directory,onProgress:emit,signal});
  result({...out,...remix,engine:final.hit?'hybrid-cache':'hybrid',compositeCacheHit:final.hit,rasterHits,rasterRendered,cacheHit:cached.hit,bundleMs,mediaMs});succeeded=true;
 }else{
  const path=await raster(item.extension==='png'||embeddedAudio?media.props:silentVisualProps(media.props),item.extension);
  if(item.extension==='png'||embeddedAudio)copyFileSync(path,item.path,fsConstants.COPYFILE_FICLONE);
  else await remixHybridAudio(path,media.props.document,item,{publicRoot:join(buildRoot,'public'),outputPath:item.path,workRoot:directory,onProgress:emit,signal});
  result({engine:'remotion',cacheHit:cached.hit,rasterHits,rasterRendered,bundleMs,mediaMs,concurrency:policy.concurrency,hardwareAcceleration:hardware});succeeded=true;
 }
}finally{if(browser)await browser.close({silent:true});}
if(succeeded)emit({stage:'verifying'});
