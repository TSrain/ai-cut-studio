import{execFileSync}from'node:child_process';import{mkdtempSync,renameSync,rmSync,existsSync,writeFileSync,readFileSync,readdirSync}from'node:fs';import{join}from'node:path';
import{PRESENTER_ATLAS_VERSION,presenterAtlasLayout}from'../../templates/remotion-base/src/editor/presenter-atlas.mjs';
export function preparePresenterPreview(directory,manifest){
 const output=join(directory,PRESENTER_ATLAS_VERSION);if(existsSync(join(output,'ready.json')))return output;
 for(let n=0;n<manifest.frameCount;n++)if(!existsSync(join(directory,`${String(n).padStart(6,'0')}.png`)))throw Error(`Preview source mask missing frame ${n}`);
 const temp=mkdtempSync(join(directory,'.preview-'));const l=presenterAtlasLayout(manifest);
 try{
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-threads','2','-framerate',String(manifest.fps),'-start_number','0','-i',join(directory,'%06d.png'),'-vf',`alphaextract,negate,scale=${l.width}:${l.height}:flags=area,tile=${l.columns}x${l.rows}:nb_frames=${l.capacity}:padding=0:margin=0:color=white`,'-filter_threads','1','-frames:v',String(Math.ceil(manifest.frameCount/l.capacity)),'-fps_mode','passthrough','-start_number','0',join(temp,'%04d.png')],{stdio:'inherit'});
  const pages=readdirSync(temp).filter(f=>f.endsWith('.png'));
  if(pages.length!==Math.ceil(manifest.frameCount/l.capacity))throw Error('Preview atlas missing pages');
  for(const page of pages){const png=readFileSync(join(temp,page));if(png.readUInt32BE(16)!==l.width*l.columns||png.readUInt32BE(20)!==l.height*l.rows)throw Error('Preview atlas invalid dimensions');}
  writeFileSync(join(temp,'ready.json'),JSON.stringify({version:PRESENTER_ATLAS_VERSION,...l,frameCount:manifest.frameCount}));
  renameSync(temp,output);return output;
 }finally{rmSync(temp,{force:true,recursive:true});}
}
