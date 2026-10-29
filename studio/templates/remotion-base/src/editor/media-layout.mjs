import {immersiveCard} from './immersive-stack.mjs';
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
export const STACK_LAYOUT_OPTIONS=['stack','spread','fan','staircase','alternating','deck'];
export const MOTION_OPTIONS=['slide','fade','none','zoom','pop','flip','drop','wipe'];
export const isMediaAsset=id=>['media-stack','media-split'].includes(id);
export function defaultMediaItem(id,index=0){return {id,label:`素材 ${index+1}`,media:null,crop:null,enterSeconds:index*.35,exitSeconds:null,transitionSeconds:.4,entrance:['left','right','up','down'][index%4],x:0,y:0,scale:1,rotation:0};}
export function defaultMediaProps(assetId){if(!isMediaAsset(assetId))throw Error('未知媒体模板');return {items:Array.from({length:assetId==='media-stack'?3:2},(_,i)=>({...defaultMediaItem(`media-${i+1}`,i),...(assetId==='media-split'?{enterSeconds:i*2}:{})})),...(assetId==='media-split'?{mode:'sequence'}:{framing:'immersive',stackFill:1.15}),layout:assetId==='media-stack'?'stack':'diagonal',seed:1,gap:16,tilt:7,shadow:30,separatorPosition:50,separatorAngle:20,playback:'freeze',motion:'slide',editorBackground:'original',backgroundColor:'#141821'};}
export function validateMediaProps(assetId,p,{durationSeconds=6,requireAssets=false,fps=30}={}){
 const fail=s=>{throw Error(s);},num=(v,label,min,max)=>{if(!Number.isFinite(v)||v<min||v>max)fail(`${label}超出范围`);};
 if(!isMediaAsset(assetId))fail('未知媒体模板');
 const sequence=assetId==='media-split'&&p.mode==='sequence';
 if(assetId==='media-split'&&p.mode!==undefined&&!['sequence','simultaneous'].includes(p.mode))fail('分屏模式无效');
 if(!Array.isArray(p.items)||p.items.length<1||p.items.length>9||(assetId==='media-split'&&(sequence?p.items.length>4:p.items.length!==2)))fail('素材数量无效');
 if(!(assetId==='media-stack'?STACK_LAYOUT_OPTIONS:['horizontal','vertical','diagonal']).includes(p.layout))fail('布局无效');
 if(p.framing!==undefined&&!['immersive','contained'].includes(p.framing))fail('堆叠构图无效');
 if(p.layerMode!==undefined&&!['automatic','manual'].includes(p.layerMode))fail('层级模式无效');
 if(p.stackFill!==undefined)num(p.stackFill,'铺叠幅度',.7,2);
 if(!['freeze','loop'].includes(p.playback))fail('播放方式无效');
 if(!MOTION_OPTIONS.includes(p.motion))fail('入场方式无效');
 if(p.exitMotion!==undefined&&!MOTION_OPTIONS.includes(p.exitMotion))fail('退场方式无效');
 if(sequence){num(fps,'帧率',.001,1000);if(p.items[0].enterSeconds!==0)fail('第一项入场时间必须为0');p.items.forEach((item,index)=>{if(index&&item.enterSeconds<=p.items[index-1].enterSeconds)fail('入场时间必须严格递增');const startFrame=Math.round(item.enterSeconds*fps);if(startFrame>=Math.round(durationSeconds*fps)||(index&&startFrame<=Math.round(p.items[index-1].enterSeconds*fps)))fail('入场时间必须占据不同帧且早于结束帧');if(item.exitSeconds!=null)fail('依次分屏不支持独立退场时间');});}
 num(p.tilt??7,'倾斜幅度',0,45);num(p.shadow??30,'阴影强度',0,100);
 num(p.seed,'随机种子',0,2147483647);num(p.gap,'间隔',0,200);num(p.separatorPosition,'分隔位置',10,90);num(p.separatorAngle,'分隔角度',-45,45);
 if(!/^#[0-9a-f]{6}$/i.test(p.backgroundColor))fail('背景颜色无效');
 const ids=new Set();for(const i of p.items){
 if(!i||typeof i.id!=='string'||!i.id||ids.has(i.id))fail('素材 ID 为空或重复');ids.add(i.id);
 if(typeof i.label!=='string'||i.label.length>300)fail('素材名称无效');
 if(i.radius!==undefined)num(i.radius,'素材圆角',0,300);
 if(i.borderWidth!==undefined)num(i.borderWidth,'素材边框粗细',0,80);
 if(i.borderColor!==undefined&&!/^#[0-9a-f]{6}$/i.test(i.borderColor))fail('素材边框颜色无效');
 if(i.motion!==undefined&&!MOTION_OPTIONS.includes(i.motion))fail('素材入场方式无效');
 if(i.exitMotion!==undefined&&!MOTION_OPTIONS.includes(i.exitMotion))fail('素材退场方式无效');
 if(i.entrance!==undefined&&!['left','right','up','down'].includes(i.entrance))fail('素材入场方向无效');
 num(i.enterSeconds,'素材入场时间',0,durationSeconds-.000001);if(i.exitSeconds!=null)num(i.exitSeconds,'素材退场时间',i.enterSeconds+.000001,durationSeconds);
 num(i.transitionSeconds,'素材过渡时长',0,5);num(i.x,'水平偏移',-100,100);num(i.y,'垂直偏移',-100,100);num(i.scale,'素材缩放',.1,4);num(i.rotation,'素材旋转',-180,180);
 const m=i.media;if(m!=null){
 if(!['image','video'].includes(m.kind))fail('素材类型无效');
 if(typeof m.publicPath!=='string'||!m.publicPath||/^[\\/]|[\\\x00-\x1f]|(^|\/)\.\.?(\/|$)|[:?#%]/.test(m.publicPath))fail('素材路径不安全');
 num(m.width,'素材宽度',1,32768);num(m.height,'素材高度',1,32768);
 if(m.kind==='video'){num(m.durationSeconds,'素材时长',.001,86400);num(m.startSeconds??0,'素材起点',0,m.durationSeconds-.001);}
 }else if(requireAssets)fail(`${i.label}缺少素材`);
 if(i.crop!=null){const c=i.crop;num(c.x,'裁切 x',0,1);num(c.y,'裁切 y',0,1);num(c.width,'裁切宽度',.05,1);num(c.height,'裁切高度',.05,1);num(c.sourceAspect,'素材比例',.01,100);if(c.x+c.width>1.000001||c.y+c.height>1.000001)fail('裁切超出素材');}
 }
 return p;
}
export function mediaItemTiming(item,frame,fps,durationSeconds,playback='freeze'){
 const start=Math.round(item.enterSeconds*fps),end=Math.round((item.exitSeconds??durationSeconds)*fps),local=frame-start;
 const edge=Math.min(Math.round(item.transitionSeconds*fps),Math.max(0,Math.floor((end-start)/2)));
 const enterProgress=edge?clamp(local/edge):1,exitProgress=edge?clamp((end-1-frame)/edge):1;
 const smooth=v=>v*v*(3-2*v),progress=Math.min(enterProgress,exitProgress);
 const total=Math.max(1,Math.ceil((item.media?.durationSeconds??durationSeconds)*fps-1e-6)),trim=clamp(Math.round((item.media?.startSeconds??0)*fps),0,total-1),available=total-trim;
 return {start,end,local,enterProgress:smooth(enterProgress),exitProgress:smooth(exitProgress),visible:frame>=start&&frame<end,progress:progress*progress*(3-2*progress),trim,available,sourceFrame:trim+(playback==='loop'?Math.max(0,local)%available:clamp(local,0,available-1))};
}
export function fitMediaCrop(crop,width,height){const ratio=width/height,c={...crop};if(c.width*c.sourceAspect/c.height>ratio){const w=c.height*ratio/c.sourceAspect;c.x+=(c.width-w)/2;c.width=w;}else{const h=c.width*c.sourceAspect/ratio;c.y+=(c.height-h)/2;c.height=h;}return c;}
const noise=(id,seed)=>{let h=seed|0;for(const c of id)h=Math.imul(h^c.charCodeAt(0),16777619);return ((h>>>0)%10001)/10000;};
/** Each edge inherits its own group default; item overrides never affect siblings. */
export function resolveMediaMotion(item,props,edge='enter'){
 return edge==='exit'?(item.exitMotion??props.exitMotion??props.motion):(item.motion??props.motion);
}
/** Sorted stable IDs define spatial slots; array order exclusively defines z-order. */
function arrangedCard(p,item,crop,width,height){
 const ids=p.items.map(i=>i.id).sort((a,b)=>a<b?-1:a>b?1:0),n=ids.length,rank=ids.indexOf(item.id);
 const t=n===1?0:rank/(n-1)-.5,ratio=crop.width*crop.sourceAspect/crop.height;
 const spacing=1+Math.min(p.gap,200)/1000,tilt=p.tilt??7;
 let ax=0,ay=0,box=.76,rotation=0;
 if(n>1){
  if(p.layout==='fan'){ax=t*.6;ay=t*t*.4-.045;box=n>5?.49:.59;rotation=t*tilt*3;}
  if(p.layout==='staircase'){ax=t*.5;ay=t*.5;box=n>5?.42:.5;rotation=0;}
  if(p.layout==='alternating'){
   const rows=Math.ceil(n/2),row=Math.floor(rank/2),isLastUnpaired=n%2===1&&rank===n-1;
   ax=isLastUnpaired?0:(rank%2===0?-.23:.23);
   ay=rows===1?0:(row/(rows-1)-.5)*.64;
   box=Math.min(.49,1.42/rows);rotation=(rank%2===0?-1:1)*tilt*.65;
  }
  if(p.layout==='deck'){ax=t*.24;ay=t*-.24;box=.68;rotation=t*tilt*.65;}
 }
 const cx=width*(.5+ax*spacing),cy=height*(.5+ay*spacing);
 let w=Math.min(width*box,height*box*ratio),h=w/ratio;
 // Keep the rotated default cards on canvas; explicit user transforms apply later.
 const radians=rotation*Math.PI/180,cos=Math.abs(Math.cos(radians)),sin=Math.abs(Math.sin(radians));
 const fit=Math.min(1,Math.max(0,Math.min(cx,width-cx)-width*.025)*2/(w*cos+h*sin),Math.max(0,Math.min(cy,height-cy)-height*.025)*2/(h*cos+w*sin));
 w*=fit;h*=fit;
 return {left:cx-w/2,top:cy-h/2,width:w,height:h,rotation,crop};
}
export function mediaGeometry(assetId,p,width,height){
 const n=p.items.length,short=Math.min(width,height),gap=Math.min(p.gap,short*.09);
 return p.items.map((i,index)=>{
 const crop=i.crop??{x:0,y:0,width:1,height:1,sourceAspect:i.media?i.media.width/i.media.height:4/3};
 let g;
 if(assetId==='media-stack'&&p.framing==='immersive'&&p.layout!=='spread'){
 g=immersiveCard(p,i,crop,width,height);
 }else if(assetId==='media-stack'&&!['stack','spread'].includes(p.layout)){
 g=arrangedCard(p,i,crop,width,height);
 }else if(assetId==='media-stack'){
 const ratio=crop.width*crop.sourceAspect/crop.height,spread=p.layout==='spread';
 const cols=spread?Math.ceil(Math.sqrt(n*width/height)):1,rows=Math.ceil(n/cols);
 // Placement is keyed to the item ID, so reordering only changes its layer.
 const slot=(Number(/(\d+)$/.exec(i.id)?.[1]??Math.floor(noise(i.id,p.seed)*9))-1+9)%9;
 const anchors=[[-.24,-.18],[.24,.17],[0,0],[-.22,.23],[.24,-.23],[-.31,.02],[.01,-.29],[.06,.29],[0,0]];
 const [ax,ay]=n===1?[0,0]:anchors[slot],hero=slot===2||slot===8;
 const size=hero?.66:.48+noise(i.id,p.seed+23)*.09;
 const boxW=spread?(width-gap*(cols+1))/cols:width*size,boxH=spread?(height-gap*(rows+1))/rows:height*size;
 const w=Math.min(boxW,boxH*ratio),h=w/ratio;
 const cx=spread?(index%cols+.5)*(width/cols):width/2+ax*width*(.96+p.gap*.0025)+(noise(i.id,p.seed)-.5)*short*.025;
 const cy=spread?(Math.floor(index/cols)+.5)*(height/rows):height/2+ay*height*(.96+p.gap*.0025)+(noise(i.id,p.seed+13)-.5)*short*.025;
 g={left:cx-w/2,top:cy-h/2,width:w,height:h,rotation:spread?0:(noise(i.id,p.seed+91)-.5)*2*(p.tilt??7),crop};
 }else{
 const pos=p.separatorPosition/100;
 if(p.layout==='vertical'){const cut=height*pos;g={left:0,top:index?cut+gap/2:0,width,height:index?height-cut-gap/2:cut-gap/2};}
 else if(p.layout==='diagonal'){
 const cut=width*pos,delta=Math.tan(p.separatorAngle*Math.PI/180)*height/2,top=clamp(cut+delta,0,width),bottom=clamp(cut-delta,0,width);
 const a=clamp(top-gap/2,0,width),b=clamp(bottom-gap/2,0,width),c=clamp(top+gap/2,0,width),d=clamp(bottom+gap/2,0,width);
 // Fit each source to its own visible panel, not the entire canvas.
 // Polygon coordinates are local to that panel's bounding rectangle.
 const panelLeft=index?Math.min(c,d):0,panelWidth=index?width-panelLeft:Math.max(a,b);
 g={left:panelLeft,top:0,width:panelWidth,height,clipPath:index?`polygon(${c-panelLeft}px 0,100% 0,100% 100%,${d-panelLeft}px 100%)`:`polygon(0 0,${a}px 0,${b}px 100%,0 100%)`};
 }else{const cut=width*pos;g={left:index?cut+gap/2:0,top:0,width:index?width-cut-gap/2:cut-gap/2,height};}
 g={...g,rotation:0,crop:fitMediaCrop(crop,g.width,g.height)};
 }
 return {...g,left:g.left+i.x*width/100,top:g.top+i.y*height/100,rotation:g.rotation+i.rotation,scale:i.scale};
 });
}
/** Replacing content keeps the user's crop boundaries and placement. */
export function replaceMediaItem(item,media){return {...item,media,crop:item.crop?{...item.crop,sourceAspect:media.width/media.height}:null};}

export function mediaEntrance(item,progress,width,height){
 if(progress>=1)return {x:0,y:0};
 const direction=item.entrance??'down';
 const distance=(1-progress)*Math.min(width,height)*.18;
 return {x:direction==='left'?-distance:direction==='right'?distance:0,y:direction==='up'?-distance:direction==='down'?distance:0};
}

/** Event time is absolute within the group. Replacement never restarts the other pane. */
export function mediaSequenceState(p,frame,fps,durationSeconds,width,height){
 const starts=p.items.map(i=>Math.round(i.enterSeconds*fps)),end=Math.round(durationSeconds*fps);
 const edges=p.items.map((i,n)=>Math.max(0,Math.min(Math.round(i.transitionSeconds*fps),(starts[n+1]??end)-starts[n])));
 const ease=v=>{const x=clamp(v);return x*x*(3-2*x);};
 const eventProgress=n=>edges[n]?ease((frame-starts[n])/edges[n]):(frame>=starts[n]?1:0);
 return p.items.map((item,index)=>{
  const replacement=index+2<p.items.length?index+2:null;
  const stop=replacement===null?end:starts[replacement]+edges[replacement];
  const timing=mediaItemTiming({...item,exitSeconds:null},frame,fps,durationSeconds,p.playback);
  timing.end=stop;timing.visible=frame>=starts[index]&&frame<stop;
  let geometry=mediaGeometry('media-split',{...p,items:[item,item]},width,height)[index%2];
  if(index===0){
   const q=p.items.length>1?eventProgress(1):0;
   const crop=item.crop??{x:0,y:0,width:1,height:1,sourceAspect:item.media?item.media.width/item.media.height:4/3};
   const w=width+(geometry.width-width)*q,h=height+(geometry.height-height)*q;
   let clipPath=geometry.clipPath;
   if(clipPath){const matches=[...clipPath.matchAll(/([\d.]+)px/g)].map(m=>Number(m[1]));clipPath=`polygon(0 0,${width+(matches[0]-width)*q}px 0,${width+(matches[1]-width)*q}px 100%,0 100%)`;}
   geometry={...geometry,width:w,height:h,crop:fitMediaCrop(crop,w,h),clipPath};
  }
  return {index,geometry,timing,enterProgress:eventProgress(index),exitProgress:replacement===null?1:1-eventProgress(replacement)};
 });
}
/** Progress always means visibility: 0 absent, 1 settled, for either edge. */
export function mediaMotionStyle(item,motion,progress,width,height){
 const p=clamp(progress),remaining=1-p,offset=mediaEntrance(item,p,width,height);
 let transform='none',opacity=motion==='none'?1:p,clipPath;
 if(motion==='slide')transform=`translate(${offset.x}px,${offset.y}px) scale(${.94+.06*p}) rotate(${remaining*5}deg)`;
 if(motion==='zoom')transform=`scale(${.65+.35*p})`;
 if(motion==='pop')transform=`scale(${.7+.3*p+Math.sin(Math.PI*p)*.16})`;
 if(motion==='flip')transform=`perspective(1200px) rotateY(${remaining*80}deg)`;
 if(motion==='drop')transform=`translateY(${-remaining*height*.25}px) rotate(${remaining*-8}deg)`;
 if(motion==='wipe'){opacity=1;const side=item.entrance??'left';clipPath=`inset(${side==='up'?remaining*100:0}% ${side==='right'?remaining*100:0}% ${side==='down'?remaining*100:0}% ${side==='left'?remaining*100:0}%)`;}
 return {opacity,transform,clipPath};
}
