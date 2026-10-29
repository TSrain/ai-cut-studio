import {defaultMediaItem} from '../../templates/remotion-base/src/editor/media-layout.mjs';
export function setMediaCount(assetId,props,count,{fps=30}={}){
 const sequence=assetId==='media-split'&&props.mode==='sequence';
 const limit=assetId==='media-stack'?9:sequence?4:2;
 if(!Number.isInteger(count)||count<1||count>limit||(!sequence&&assetId==='media-split'&&count!==2))throw Error('素材数量超出范围');
 const items=props.items.slice(0,count),duration=props.durationSeconds??6,oldLength=items.length;
 const last=items.at(-1)?.enterSeconds??0,extra=count-oldLength;
 const endFrame=Math.round(duration*fps),lastFrame=Math.round(last*fps);
 if(sequence&&extra>0&&endFrame-1-lastFrame<extra)throw Error('剩余时间不足，请提前最后一段入场或延长组合');
 for(let index=oldLength;index<count;index++){
  let n=1;while(items.some(i=>i.id===`media-${n}`))n++;
  const item=defaultMediaItem(`media-${n}`,index);
  item.enterSeconds=sequence?(oldLength?(lastFrame+Math.floor((endFrame-lastFrame)*(index-oldLength+1)/(extra+1)))/fps:Math.floor(endFrame*index/count)/fps):Math.min(item.enterSeconds,Math.max(0,duration-.05));
  items.push(item);
 }
 return {...props,items};
}
export function setMediaMode(props,mode,{fps=30}={}){
 if(!['sequence','simultaneous'].includes(mode))throw Error('编排模式无效');
 let p={...props,mode};
 if(mode==='simultaneous')return setMediaCount('media-split',p,2,{fps});
 const duration=p.durationSeconds??6;
 if(Math.round(duration*fps)<p.items.length)throw Error('组合时间不足，请延长后再使用依次分屏');
 return {...p,items:p.items.map((i,index)=>({...i,enterSeconds:Math.floor(Math.round(duration*fps)*index/p.items.length)/fps,exitSeconds:null}))};
}
export function moveMediaItem(props,id,to){
 const items=[...props.items],from=items.findIndex(i=>i.id===id);
 if(from<0||to<0||to>=items.length)return props;
 const times=items.map(i=>i.enterSeconds);
 items.splice(to,0,items.splice(from,1)[0]);
 return {...props,items:props.mode==='sequence'?items.map((i,index)=>({...i,enterSeconds:times[index]})):items};
}

export function mediaEntryBounds(props,index,fps=30){
 const min=index===0?0:(Math.round(props.items[index-1].enterSeconds*fps)+1)/fps;
 const max=index===0?0:((props.items[index+1]?Math.round(props.items[index+1].enterSeconds*fps):Math.round((props.durationSeconds??6)*fps))-1)/fps;
 return {min,max};
}
export function setMediaEntry(props,id,value,fps=30){
 const index=props.items.findIndex(i=>i.id===id);if(index<0)return props;
 const {min,max}=mediaEntryBounds(props,index,fps);if(max<min)throw Error('没有可用入场时间，请延长组合');
 const time=Math.max(min,Math.min(max,Math.round(value*fps)/fps));
 return {...props,items:props.items.map(i=>i.id===id?{...i,enterSeconds:time}:i)};
}
