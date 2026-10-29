// Editor documents are immutable values (edits produce new objects), so a document's
// content key is computed once per object instead of re-serializing it on every check.
const contentKeys=new WeakMap();
export function documentContentKey(document){
 const cacheable=document!==null&&typeof document==='object';
 if(cacheable&&contentKeys.has(document))return contentKeys.get(document);
 const {revision,assetSourceHash,...content}=document;const key=JSON.stringify(content);
 if(cacheable)contentKeys.set(document,key);return key;
}
/** Seed the key for a structural copy (structuredClone) so it is not serialized again. */
export function shareContentKey(source,copy){if(copy!==null&&typeof copy==='object')contentKeys.set(copy,documentContentKey(source));return copy;}
/** One write at a time; a response acknowledges only the content actually sent. */
export function createProjectAutosave({read,write,accept,onStatus,delay=700,setTimer=setTimeout,clearTimer=clearTimeout}){
 let timer=null,inFlight=null,disposed=false,paused=false;const acknowledged=new Map();
 const clear=()=>{if(timer!==null)clearTimer(timer);timer=null;};
 // Dirty = current content differs from what the server last acknowledged for this document.
 const isDirty=()=>{const doc=read(),prior=acknowledged.get(doc.id);return !prior||prior.key!==documentContentKey(doc)||prior.result.revision<doc.revision;};
 const status=value=>{if(!disposed)onStatus(value);};
 const flush=async({force=false}={})=>{
  clear();if(disposed)return read();
  if(inFlight){await inFlight;return flush({force});}
  const id=read().id;
  inFlight=(async()=>{
   let result=read();
   while(!disposed&&!paused&&read().id===id){
    const prior=acknowledged.get(id);
    const live=read(),snapshot=shareContentKey(live,structuredClone(live));if(prior)snapshot.revision=Math.max(snapshot.revision,prior.result.revision);
    const key=documentContentKey(snapshot);
    if(!force&&prior?.key===key&&prior.result.revision===snapshot.revision){accept({...snapshot,revision:prior.result.revision,assetSourceHash:prior.result.assetSourceHash},snapshot);status({state:'saved',id});result=read();break;}
    force=false;status({state:'saving',id});
    try{result=await write(snapshot);acknowledged.set(id,{key,result});if(!disposed)accept(result,snapshot);}
    catch(error){status({state:'error',id,message:error.message,conflict:/Revision conflict/i.test(error.message)});throw error;}
    if(read().id!==id)break;
    if(documentContentKey(read())===key){status({state:'saved',id});break;}
   }
   return result;
  })();
  try{return await inFlight;}finally{inFlight=null;}
 };
 return {flush,pause(){paused=true;clear();},resume(){paused=false;},isDirty,schedule(){clear();if(disposed||paused)return;if(!isDirty()){status({state:'saved',id:read().id});return;}status({state:'pending',id:read().id});timer=setTimer(()=>{timer=null;return flush().catch(()=>{});},delay);},cancel:clear,async settled(){if(inFlight)await inFlight.catch(()=>{});},dispose(){disposed=true;clear();}};
}
