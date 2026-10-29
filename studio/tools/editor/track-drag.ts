/** Pointer drag in scroll coordinates. One lifecycle owns RAF and all cancellation listeners. */
export function trackDrag(event:React.PointerEvent,px:number,apply:(delta:number)=>void,finish:()=>void,abort:()=>void){
 const target=event.currentTarget as HTMLElement,scroll=target.closest('.timeline-scroll') as HTMLElement|null,start=event.clientX,startScroll=scroll?.scrollLeft??0;let x=start,active=false,raf=0,closed=false;
 const update=()=>{if(!active)return;apply(Math.round((x-start+(scroll?.scrollLeft??0)-startScroll)/px));};
 const tick=()=>{if(closed)return;if(active&&scroll){const r=scroll.getBoundingClientRect(),speed=x<r.left+40?-Math.min(18,(r.left+40-x)/3):x>r.right-40?Math.min(18,(x-r.right+40)/3):0;if(speed){scroll.scrollLeft+=speed;update();}}raf=requestAnimationFrame(tick);};
 const move=(e:PointerEvent)=>{x=e.clientX;if(Math.abs(x-start)>=4)active=true;update();};
 const clean=()=>{closed=true;cancelAnimationFrame(raf);window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancel);window.removeEventListener('blur',cancel);window.removeEventListener('keydown',key,true);};
 const up=()=>{clean();finish();};const cancel=()=>{if(closed)return;clean();abort();};const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();cancel();}};
 window.addEventListener('pointermove',move);window.addEventListener('pointerup',up,{once:true});window.addEventListener('pointercancel',cancel,{once:true});window.addEventListener('blur',cancel,{once:true});window.addEventListener('keydown',key,true);raf=requestAnimationFrame(tick);return cancel;
}
export function snapDelta(delta:number,edges:number[],boundaries:number[],px:number){let adjustment=0,distance=6/px,guide:number|null=null;for(const edge of edges)for(const boundary of boundaries){const d=boundary-edge-delta;if(Math.abs(d)<=distance){distance=Math.abs(d);adjustment=d;guide=boundary;}}return {delta:delta+adjustment,guide};}
export function trackBoundaries(doc:any){return [0,doc.canvas.durationFrames,...(doc.instances??[]).flatMap((c:any)=>[c.startFrame,c.startFrame+c.durationFrames]),...(doc.source?.clips??[]).flatMap((c:any)=>[c.startFrame,c.startFrame+c.durationFrames])];}
