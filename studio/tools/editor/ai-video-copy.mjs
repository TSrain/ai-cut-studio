/** Synchronous selection copy keeps the browser user gesture. No clipboard reads or permission prompts. */
export function copyAiVideoPrompt(text,environment={}){
 const doc=environment.document??globalThis.document;
 if(typeof text!=='string'||!text||!doc?.body||typeof doc.execCommand!=='function')return false;
 let source;
 const previous=doc.activeElement;
 try{
  source=doc.createElement('textarea');source.value=text;source.readOnly=true;
  source.setAttribute('aria-hidden','true');
  Object.assign(source.style,{position:'fixed',left:'0',top:'0',opacity:'0',pointerEvents:'none'});
  doc.body.appendChild(source);source.focus({preventScroll:true});source.select();source.setSelectionRange(0,text.length);
  return doc.execCommand('copy')===true;
 }catch{return false;}
 finally{
  source?.remove();
  try{previous?.focus?.({preventScroll:true});}catch{}
 }
}
