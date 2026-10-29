import {setMediaCount} from './media-count.mjs';
import {defaultMediaItem} from '../../templates/remotion-base/src/editor/media-layout.mjs';
/** Reserve destinations before asynchronous uploads; failed files retain their slot. */
export function planMediaBatch(props,names,limit,{fps=30}={}){
 const items=props.items.map(i=>({...i})),empty=items.filter(i=>!i.media),targets=[];
 for(const [index,name] of names.entries()){
  let item=empty.shift();
  if(!item){if(items.length>=limit)break;let n=1;while(items.some(i=>i.id===`media-${n}`))n++;if(props.mode==='sequence'){try{item=setMediaCount('media-split',{...props,items},items.length+1,{fps}).items.at(-1);}catch{break;}}else{item=defaultMediaItem(`media-${n}`,items.length);item.enterSeconds=Math.min(item.enterSeconds,Math.max(0,(props.durationSeconds??6)-.1));}items.push(item);}
  item.label=name;targets.push({id:item.id,fileIndex:index});
 }
 return {props:{...props,items},targets,overflow:names.length-targets.length};
}
