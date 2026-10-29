export const PIP_DEFAULTS = {size:30, x:78, y:72, cropX:50, cropY:50, radius:32, borderWidth:2, borderColor:'#ffffff', shadow:24, entrance:'shrink', exit:'expand', transitionSeconds:0.35, editorBackground:'transparent'};
export const PIP_MOTIONS = ['none','fade','slide-left','slide-right','slide-up','slide-down','pop','flip'];
export const pipTrimBefore = (source, instance) => (source?.startFrame ?? 0) + instance.startFrame;
export function activePip(source, instances, frame) {
  if (!source) return null;
  return instances.filter(i => i.assetId === 'source-pip' && i.props?.sourceMode !== 'media' && frame >= i.startFrame && frame < i.startFrame+i.durationFrames)
    .sort((a,b)=>a.zIndex-b.zIndex).at(-1) ?? null;
}
const clamp = (n,min=0,max=1) => Math.max(min,Math.min(max,n));
const ease = n => {const t=clamp(n); return t*t*(3-2*t);};
const mix = (a,b,t) => a+(b-a)*t;
export function cropRect(props, sourceAspect) {
  if (props.crop) return {...props.crop};
  const width=Math.min(1,1/sourceAspect),height=Math.min(1,sourceAspect);
  return {x:(1-width)*(props.cropX??50)/100,y:(1-height)*(props.cropY??50)/100,width,height,sourceAspect};
}
export function editCropRect(rect,handle,dx,dy) {
  const r={...rect},right=r.x+r.width,bottom=r.y+r.height;
  if(handle==='move') {r.x=clamp(r.x+dx,0,1-r.width); r.y=clamp(r.y+dy,0,1-r.height); return r;}
  if(handle.includes('w')) {r.x=clamp(r.x+dx,0,right-.05); r.width=right-r.x;}
  if(handle.includes('e')) r.width=clamp(r.width+dx,.05,1-r.x);
  if(handle.includes('n')) {r.y=clamp(r.y+dy,0,bottom-.05); r.height=bottom-r.y;}
  if(handle.includes('s')) r.height=clamp(r.height+dy,.05,1-r.y);
  return r;
}
export function pipDimensions(width,height,props) {
  const p={...PIP_DEFAULTS,...props},crop=cropRect(p,width/height);
  const ratio=crop.width*crop.sourceAspect/crop.height,side=Math.min(width,height)*p.size/100;
  return {width:side*Math.min(1,ratio),height:side/Math.max(1,ratio)};
}
export function pipFitSize(width,height,props) {
  const base=pipDimensions(width,height,{...props,size:100});
  return clamp(100*Math.min(width/base.width,height/base.height),10,300);
}
export function pipPositionPercent(position,span,fallback=50) {
  return Math.abs(span)<1e-6 ? fallback : clamp(position/span*100,0,100);
}
/** Pixel offsets preserve legacy percentage anchors, including zero/negative free space. */
export function pipPosition(width,height,props) {
  const p={...PIP_DEFAULTS,...props},size=pipDimensions(width,height,p);
  return {x:(width-size.width)*p.x/100+(p.offsetX??0),y:(height-size.height)*p.y/100+(p.offsetY??0)};
}
export function positionPip(width,height,props,position) {
  const anchor=pipPosition(width,height,{...props,offsetX:0,offsetY:0});
  return {offsetX:clamp(position.x-anchor.x,-32768,32768),offsetY:clamp(position.y-anchor.y,-32768,32768)};
}
export function pipGeometry(width,height,duration,frame,fps,props) {
  const p={...PIP_DEFAULTS,...props},crop=cropRect(p,width/height);
  const edge=Math.max(0,Math.min(Math.round(p.transitionSeconds*fps),Math.floor((duration-1)/2)));
  const entering=edge ? ease(frame/edge) : 1, leaving=edge ? ease((duration-1-frame)/edge) : 1;
  const shape=Math.min(p.entrance==='shrink'?entering:1,p.exit==='expand'?leaving:1);
  const target=pipDimensions(width,height,p);
  const position=pipPosition(width,height,p);
  const g={left:position.x*shape,top:position.y*shape,
    width:mix(width,target.width,shape),height:mix(height,target.height,shape),
    radius:p.radius*shape,borderWidth:p.borderWidth*shape,shadow:p.shadow*shape,opacity:1,scale:1,rotateY:0,
    cropX:mix(50,p.cropX,shape),cropY:mix(50,p.cropY,shape)};
  // Match crop aspect to the animated window at every frame; never stretch the person.
  const aspect=crop.sourceAspect,ratio=g.width/g.height;
  const targetFitWidth=Math.min(1,(target.width/target.height)/aspect);
  const zoom=mix(1,crop.width/targetFitWidth,shape);
  const cw=Math.min(1,ratio/aspect)*zoom,ch=Math.min(1,aspect/ratio)*zoom;
  const cx=mix(.5,crop.x+crop.width/2,shape),cy=mix(.5,crop.y+crop.height/2,shape);
  g.crop={x:clamp(cx-cw/2,0,1-cw),y:clamp(cy-ch/2,0,1-ch),width:cw,height:ch,sourceAspect:aspect};
  const motion=(mode,t)=>{
    if(mode==='fade'||mode==='pop'||mode==='flip') g.opacity=Math.min(g.opacity,t);
    if(mode==='slide-left') g.left=mix(-g.width-2*g.shadow,g.left,t);
    if(mode==='slide-right') g.left=mix(width+2*g.shadow,g.left,t);
    if(mode==='slide-up') g.top=mix(-g.height-2*g.shadow,g.top,t);
    if(mode==='slide-down') g.top=mix(height+2*g.shadow,g.top,t);
    if(mode==='pop') {const u=t-1; g.scale*=1+2.70158*u*u*u+1.70158*u*u;}
    if(mode==='flip') g.rotateY+=(1-t)*90;
  };
  motion(p.entrance,entering); motion(p.exit,leaving);
  return g;
}

export function pipMediaTiming(media,frame,fps) {
 const total=Math.max(1,Math.ceil((media.durationSeconds??1)*fps-1e-6));
 const trim=Math.max(0,Math.min(total-1,Math.round((media.startSeconds??0)*fps)));
 const available=total-trim;
 return {trim,available,sourceFrame:trim+Math.max(0,Math.min(frame,available-1))};
}
