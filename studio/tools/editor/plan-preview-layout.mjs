const primaryKinds=new Set(['narration','animation']);
function lineCount(value,width,fontSize=13){
 const limit=Math.max(fontSize,width-16);let lines=0;
 for(const paragraph of String(value??'').split('\n')){
  let used=0;lines++;
  for(const char of paragraph){const advance=/[\u0000-\u00ff]/.test(char)?fontSize*.57:fontSize;if(used+advance>limit&&used){lines++;used=0;}used+=advance;}
 }
 return lines;
}
function contentHeight(sections,width){
 return sections.reduce((sum,section)=>sum+29+section.items.reduce((height,item)=>height+lineCount(item.text,width)*21+(item.detail?lineCount(item.detail,width,12)*20+5:0)+(item.time?18:0)+(item.status?18:0)+10,0)+14,0);
}
/** Allocate surrounding text first; keep the largest preview that still fits it. */
export function calculatePlanPreviewLayout({width,height,ratio,sections=[]}){
 const w=Math.max(1,width),h=Math.max(1,height),aspect=ratio>0?ratio:16/9,gap=16;
 const primary=sections.filter(s=>primaryKinds.has(s.kind)),secondary=sections.filter(s=>!primaryKinds.has(s.kind));
 const candidates=[];
 const add=(mode,leftWidth,rightWidth,leftSections,rightSections,mediaHeight,textHeight=0)=>{
  const availableWidth=mode==='stack'?w:w-leftWidth-rightWidth-gap*(rightSections.length?2:1);
  if(availableWidth<=0||mediaHeight<=0)return;
  const mediaWidth=Math.min(availableWidth,mediaHeight*aspect),actualHeight=mediaWidth/aspect;
  candidates.push({mode,leftWidth,rightWidth,leftSections,rightSections,mediaWidth,mediaHeight:actualHeight,textHeight,gap,overflow:false});
 };
 if(secondary.length){
  for(let left=180;left<=Math.min(420,w-440);left+=20)for(let right=180;right<=Math.min(420,w-left-280);right+=20){
   if(contentHeight(primary,left)<=h&&contentHeight(secondary,right)<=h)add('sides',left,right,primary,secondary,h);
  }
 }
 for(let left=200;left<=Math.min(540,w-280);left+=20){
  if(contentHeight(sections,left)<=h)add('aside',left,0,sections,[],h);
 }
 const split=secondary.length>0&&w>=600,leftSections=split?primary:sections,rightSections=split?secondary:[];
 const textWidth=split?(w-gap)/2:w;
 const estimatedHeight=Math.max(contentHeight(leftSections,textWidth),rightSections.length?contentHeight(rightSections,textWidth):0);
 const mediaSpace=h-estimatedHeight-gap;
 if(mediaSpace>=Math.min(120,h*.3))add('stack',textWidth,split?textWidth:0,leftSections,rightSections,mediaSpace,estimatedHeight);
 if(candidates.length)return candidates.reduce((best,item)=>item.mediaWidth*item.mediaHeight>best.mediaWidth*best.mediaHeight?item:best);
 // Very long notes remain scrollable and complete, with a usable preview above them.
 const mediaHeight=Math.min(w/aspect,Math.max(1,Math.min(180,h*.34))),mediaWidth=mediaHeight*aspect;
 return {mode:'stack',leftWidth:textWidth,rightWidth:split?textWidth:0,leftSections,rightSections,mediaWidth,mediaHeight,textHeight:Math.max(1,h-mediaHeight-gap),gap,overflow:true};
}
