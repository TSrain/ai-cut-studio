// Shared browser/generator contract. Preview only; original RGBA frames remain export inputs.
export const PRESENTER_ATLAS_VERSION='preview-mask-v1';
export function presenterAtlasLayout(matte){
 const scale=Math.min(1,640/Math.max(matte.width,matte.height));
 return {width:Math.max(1,Math.round(matte.width*scale)),height:Math.max(1,Math.round(matte.height*scale)),columns:8,rows:8,capacity:64};
}
export function presenterAtlasTile(matte,index){
 if(!Number.isInteger(index)||index<0||index>=matte.frameCount)throw Error('Preview mask frame outside foreground range');
 const l=presenterAtlasLayout(matte),page=Math.floor(index/l.capacity),tile=index%l.capacity;
 return {...l,page,x:(tile%l.columns)*l.width,y:Math.floor(tile/l.columns)*l.height,path:`${matte.framesPublicPath}/${PRESENTER_ATLAS_VERSION}/${String(page).padStart(4,'0')}.png`};
}
