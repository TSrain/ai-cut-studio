import {createHash} from 'node:crypto';
import {openSync,readSync,closeSync,statSync,realpathSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {join,resolve,extname,sep,isAbsolute} from 'node:path';
import {execFileSync} from 'node:child_process';
import {mediaMetadata} from './editor-media.mjs';
import {presetCatalogById} from './preset-catalog.mjs';
function hashFile(path){const hash=createHash('sha256'),fd=openSync(path,'r'),buffer=Buffer.alloc(1024*1024);try{let n;while((n=readSync(fd,buffer,0,buffer.length,null)))hash.update(buffer.subarray(0,n));}finally{closeSync(fd);}return hash.digest('hex');}
export function stageCompositionFile(media,{root,base,quality=true}){
 const publicRoot=realpathSync(join(root,'templates/remotion-base/public'));
 let actual;
 if(media.path){if(typeof media.path!=='string'||media.path.includes('://'))throw new Error('Expected local media path');actual=realpathSync(resolve(base,media.path));}
 else {const rel=media.publicPath;if(typeof rel!=='string'||isAbsolute(rel)||rel.split(/[\\/]/).some(x=>x==='..'||!x))throw new Error('Unsafe publicPath');actual=realpathSync(join(publicRoot,rel));if(!actual.startsWith(publicRoot+sep))throw new Error('Media symlink escapes public');}
 if(!statSync(actual).isFile())throw new Error('Media must be a file');
 const kind=media.kind;if(!['image','video'].includes(kind))throw new Error('Unsupported media kind');
 const suffix=extname(actual).toLowerCase();if(!(kind==='video'?['.mp4','.mov','.m4v','.webm']:['.png','.jpg','.jpeg','.webp']).includes(suffix))throw new Error('Unsupported media extension');
 const raw=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',actual],{encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024}));
 const stream=raw.streams?.find(s=>s.codec_type==='video'&&!s.disposition?.attached_pic);if(!stream)throw new Error('Missing visual stream');
 if(quality&&Math.min(stream.width,stream.height)<720)throw new Error('Media below 720px short side');
 let width=stream.width,height=stream.height,durationSeconds,hasAlpha=false;
 if(kind==='video'){
  const measured=mediaMetadata(raw);width=measured.canvas.width;height=measured.canvas.height;durationSeconds=measured.durationSeconds;hasAlpha=measured.hasAlpha;
  execFileSync('ffmpeg',['-v','error','-xerror','-i',actual,'-map','0:v:0','-frames:v','1','-f','null','-'],{timeout:30000,maxBuffer:2*1024*1024});
 } else {
  // Decode the actual image, including indexed PNG transparency; an RGBA label
  // alone does not prove that any pixel is translucent.
  const alpha=execFileSync('ffmpeg',['-v','error','-xerror','-i',actual,'-frames:v','1','-vf','format=rgba,alphaextract,signalstats,metadata=mode=print:file=-','-f','null','-'],{encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
  const minimum=alpha.match(/lavfi\.signalstats\.YMIN=(\d+(?:\.\d+)?)/);
  if(!minimum)throw new Error('Cannot verify image alpha');
  hasAlpha=Number(minimum[1])<255;
 }
 const startSeconds=media.startSeconds??0;
 if(typeof startSeconds!=='number'||!Number.isFinite(startSeconds)||startSeconds<0||(kind==='video'&&startSeconds>=durationSeconds))throw new Error('Media start exceeds source');
 const directory=join(publicRoot,'editor-imports');mkdirSync(directory,{recursive:true});if(!realpathSync(directory).startsWith(publicRoot+sep))throw new Error('Import directory escapes public');
 const key=hashFile(actual),publicPath=`editor-imports/compose-${key.slice(0,32)}${suffix}`,destination=join(publicRoot,publicPath);
 if(existsSync(destination)){if(!realpathSync(destination).startsWith(publicRoot+sep)||hashFile(destination)!==key)throw new Error('Cached media integrity mismatch');}else {copyFileSync(actual,destination);if(hashFile(destination)!==key)throw new Error('Staged media integrity mismatch');}
 return {kind,publicPath,width,height,hasAlpha,sha256:key,...(kind==='video'?{durationSeconds,startSeconds}:{} )};
}
export function stageCompositionMedia(input,{root,base,defaults=()=>({}),itemDefaults=(id,index)=>({id})}){
 const data=structuredClone(input),catalog=presetCatalogById();
 if(data.source){const media=stageCompositionFile({kind:'video',path:data.source.path,publicPath:data.source.publicPath},{root,base,quality:false});data.source={...data.source,path:`templates/remotion-base/public/${media.publicPath}`,publicPath:media.publicPath,startFrame:data.source.startFrame??0};}
 for(const shot of data.shots){const option=shot.options.find(o=>o.id===shot.recommended);option.props={...defaults(option.assetId),...option.props};
  const props=option.props;
  if(['media-stack','media-split'].includes(option.assetId)&&Array.isArray(props.items))props.items=props.items.map((item,index)=>({...itemDefaults(item.id,index),...item}));
  for(const item of props.items??[])if(item&&typeof item==='object'&&item.media)item.media=stageCompositionFile(item.media,{root,base});
  if(option.assetId==='source-pip'&&props.sourceMode==='media'&&props.media)props.media=stageCompositionFile(props.media,{root,base});
  for(const [slot,descriptor] of Object.entries(catalog.get(option.assetId)?.slots??{})){
   if(!['image','video'].includes(descriptor.type)||!props.slots?.[slot])continue;
   const value=props.slots[slot];const source=isAbsolute(value)?{path:value}:{publicPath:value.includes('/')?value:`${descriptor.assetDir}/${value}`};
   const meta=stageCompositionFile({kind:descriptor.type,...source},{root,base});props.slots[slot]=meta.publicPath;
  }
 }
 return data;
}
