export function defaultCoverRatio(document){
 const size=document.source?.displaySize??document.canvas;
 return size.width>=size.height?'4:3':'3:4';
}
export function showCoverAtFrame(document,renderMode,globalFrame){
 return !!document.cover?.publicPath&&renderMode==='full'&&globalFrame===0;
}
