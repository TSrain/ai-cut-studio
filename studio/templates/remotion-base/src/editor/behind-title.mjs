import {sourceFrameAt} from './clip-time.mjs';
export function presenterPreparationRange(document,instance){
 const frames=[];
 for(let f=instance.startFrame;f<instance.startFrame+instance.durationFrames;f++){
  const n=sourceFrameAt(document.source,f,document.canvas.durationFrames);
  if(n===null||!Number.isInteger(n)||n<0)throw Error('文字区间缺少有效底片');frames.push(n);
 }
 if(!frames.length)throw Error('文字区间为空');
 const start=Math.min(...frames),count=Math.max(...frames)-start+1;
 if(count>1800)throw Error('跨剪辑源帧范围过大，请拆成短片段准备人物前景');
 return {sourceStartFrame:start,frameCount:count};
}
export function presenterBindingCurrent(before,instance,after,target){
 return before.id===after.id&&!!target&&instance.startFrame===target.startFrame&&instance.durationFrames===target.durationFrames&&JSON.stringify(before.source)===JSON.stringify(after.source)&&JSON.stringify(before.canvas)===JSON.stringify(after.canvas);
}
export function behindTitleMotion(frame,count,fps,enter=.18,exit=.15,options={}){
 const {enterFx='zoom',exitFx='zoom',width=1920,height=1080}=options;
 if(count<2)return {opacity:0,scale:enterFx==='zoom'?.72:1,x:0,y:0,blur:0};
 const length=count-1,a=Math.min(Math.max(1,enter*fps),length/2),b=Math.min(Math.max(1,exit*fps),length/2);
 const progress=Math.max(0,Math.min(1,frame/a)),out=Math.max(0,Math.min(1,(frame-(length-b))/b));
 const ease=1-Math.pow(1-progress,3),retire=out*out;
 const vector=(fx,incoming)=>{
  const sign=incoming?1:-1;
  if(fx==='slide-up')return {x:0,y:sign*height};
  if(fx==='slide-down')return {x:0,y:-sign*height};
  if(fx==='slide-left')return {x:sign*width,y:0};
  if(fx==='slide-right')return {x:-sign*width,y:0};
  return {x:0,y:0};
 };
 const incoming=vector(enterFx,true),outgoing=vector(exitFx,false);
 return {
  opacity:(enterFx==='fade'?ease:Math.min(progress*3,1))*(1-retire),
  scale:1-(enterFx==='zoom'?.28*(1-ease):0)-(exitFx==='zoom'?.12*retire:0),
  x:incoming.x*(1-ease)+outgoing.x*retire,
  y:(enterFx==='zoom'?46*(1-ease):incoming.y*(1-ease))+(exitFx==='zoom'?-22*retire:outgoing.y*retire),
  blur:(enterFx==='fade'?0:10*(1-ease))+(exitFx==='fade'?0:6*retire),
 };
}
