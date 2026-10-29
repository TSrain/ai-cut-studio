const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
export function stageGeometry(width,height,ratio,scale=1){
 const maxW=width*.86,maxH=height*.71;
 const h=Math.min(maxH,maxW/ratio)*scale,w=h*ratio;
 return {x:(width-w)/2,y:height*.575-h/2,width:w,height:h};
}
export function stageVideoTiming(seconds=1,startSeconds=0,fps=30){
 const total=Math.max(1,Math.floor(seconds*fps));
 const trim=clamp(Math.round(startSeconds*fps),0,total-1);
 return {trim,available:Math.max(1,total-trim)};
}
export function stageImportSlots(kind,meta){
 const width=meta.canvas?.width??meta.width,height=meta.canvas?.height??meta.height;
 return kind==='video'?{clip:meta.publicPath,srcW:width,srcH:height,srcDur:meta.durationSeconds,image:'',startSeconds:0}:{image:meta.publicPath,imgW:width,imgH:height,clip:'',startSeconds:0};
}
export function titleCharacterState(frame,fps,index,count,mode='stagger'){
 const stagger=mode==='stagger'?Math.min(.045,.32/Math.max(1,count-1)):0;
 const raw=clamp((frame/fps-.08-index*stagger)/.52,0,1),t=1-Math.pow(1-raw,3);
 return {opacity:t,y:mode==='tracking'?0:105*(1-t),x:mode==='tracking'&&t<1?(index-(count-1)/2)*.45*(1-t):0};
}
