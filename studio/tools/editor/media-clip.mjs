import {assignPipMedia} from './pip-media.mjs';
import {pipFitSize} from '../../templates/remotion-base/src/editor/source-pip.mjs';
/** Build a plain independent media layer, retaining the source aspect and main footage. */
export function configureMediaClip(base,meta,kind,document,name){
 const width=meta.canvas?.width??meta.width,height=meta.canvas?.height??meta.height;
 if(![width,height].every(v=>Number.isFinite(v)&&v>0))throw Error('无法读取素材尺寸');
 if(kind==='video'&&!(Number.isFinite(meta.durationSeconds)&&meta.durationSeconds>0))throw Error('无法读取素材时长');
 const fps=document.canvas.fps.num/document.canvas.fps.den;
 const durationFrames=Math.max(1,Math.min(Math.round((kind==='video'?meta.durationSeconds:3)*fps),document.canvas.durationFrames-base.startFrame));
 const props={...assignPipMedia(base.props,meta,kind),mediaName:name,crop:{x:0,y:0,width:1,height:1,sourceAspect:width/height},x:50,y:50,offsetX:0,offsetY:0,radius:0,borderWidth:0,shadow:0,entrance:'none',exit:'none',transitionSeconds:0,durationSeconds:durationFrames/fps};
 props.size=pipFitSize(document.canvas.width,document.canvas.height,props);
 return {...base,name,durationFrames,props};
}
