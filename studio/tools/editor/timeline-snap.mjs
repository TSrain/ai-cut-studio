/** Edit points are in project time; source offsets are deliberately ignored. */
export function timelineSnapPoints(document) {
 const duration=document.canvas.durationFrames;
 const clips=[...(document.source?.clips??[]),...(document.instances??[]),...(document.audioClips??[])];
 return [...new Set([0,duration-1,...clips.flatMap(c=>[c.startFrame,c.startFrame+c.durationFrames]),
  ...(document.captions?.cues??[]).flatMap(c=>[c.startFrame,c.endFrame])])]
  .filter(n=>Number.isInteger(n)&&n>=0&&n<duration).sort((a,b)=>a-b);
}
function lowerBound(points,value){let lo=0,hi=points.length;while(lo<hi){const mid=(lo+hi)>>>1;if(points[mid]<value)lo=mid+1;else hi=mid;}return lo;}
/** Screen-space hysteresis: easy to acquire, deliberate to release. */
export function createTimelineSnap(){
 let held=null;
 return {
  reset(){held=null;},
  resolve(raw,{points,px,duration,enabled=true}){
   const frame=Math.max(0,Math.min(duration-1,Math.round(raw)));
   if(!enabled||!Number.isFinite(raw)||!Number.isFinite(px)||px<=0){held=null;return {frame,snapped:false};}
   const heldIndex=held===null?-1:lowerBound(points,held);
   if(held!==null&&points[heldIndex]===held){
    const neighbor=points[heldIndex+(raw<held?-1:1)];
    // A dense neighboring edit must remain reachable. The middle half of
    // the gap stays sticky in either direction, avoiding midpoint flicker.
    const release=Math.min(14,neighbor===undefined?Infinity:Math.abs(neighbor-held)*px*.75);
    if(Math.abs(raw-held)*px<=release)return {frame:held,snapped:true};
   }
   held=null;
   const i=lowerBound(points,raw);
   let distance=7;
   for(const candidate of [points[i-1],points[i]]){
    if(candidate===undefined)continue;
    const delta=Math.abs(raw-candidate)*px;
    if(delta<=distance){distance=delta;held=candidate;}
   }
   return {frame:held??frame,snapped:held!==null};
  },
 };
}
