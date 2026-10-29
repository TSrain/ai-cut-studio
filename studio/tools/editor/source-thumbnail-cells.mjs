/** One complete thumbnail per regular cell; only the clip edge crops a cell. */
export function sourceThumbnailCells({thumbnails,start,duration,width,cellWidth=80}) {
 if(!thumbnails.length||!Number.isFinite(width)||width<=0||!Number.isFinite(duration)||duration<=0)return [];
 const count=Math.min(512,Math.ceil(width/Math.max(1,cellWidth))),step=Math.max(cellWidth,width/count);
 let sample=0;
 return Array.from({length:count},(_,index)=>{
  const left=index*step,time=start+(left+Math.min(step,width-left)/2)/width*duration;
  while(sample+1<thumbnails.length&&thumbnails[sample+1].time<=time)sample++;
  return {left,width:step,url:thumbnails[sample].url};
 });
}
