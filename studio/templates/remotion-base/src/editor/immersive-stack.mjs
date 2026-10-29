const noise=(id,seed)=>{let h=seed|0;for(const c of id)h=Math.imul(h^c.charCodeAt(0),16777619);return((h>>>0)%10001)/10000;};
// Clip the rotated rectangle against the canvas; bounding-box ratios overcount corners.
function visibleFraction(cx,cy,w,h,rotation,width,height){
 const c=Math.cos(rotation*Math.PI/180),s=Math.sin(rotation*Math.PI/180);
 let polygon=[[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]].map(([x,y])=>[cx+x*c-y*s,cy+x*s+y*c]);
 for(const [axis,edge,sign] of [[0,0,1],[0,width,-1],[1,0,1],[1,height,-1]]){
  const output=[];
  for(let i=0;i<polygon.length;i++){
   const a=polygon[i],b=polygon[(i+1)%polygon.length],insideA=(a[axis]-edge)*sign>=0,insideB=(b[axis]-edge)*sign>=0;
   if(insideA)output.push(a);
   if(insideA!==insideB){const t=(edge-a[axis])/(b[axis]-a[axis]);output.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}
  }
  polygon=output;
 }
 const area=Math.abs(polygon.reduce((sum,a,i)=>{const b=polygon[(i+1)%polygon.length];return sum+a[0]*b[1]-b[0]*a[1];},0))/2;
 return area/(w*h);
}
/** Large native-aspect sheets, with at least 84% visible before explicit user overrides. */
export function immersiveCard(p,item,crop,width,height){
 const ids=p.items.map(i=>i.id).sort(),rank=ids.indexOf(item.id),n=ids.length;
 const t=n===1?0:rank/(n-1)-.5,tilt=p.tilt??7,spacing=Math.min(2,.85+p.gap*.009375);
 const seeds=[[ -.30,.12],[.30,-.10],[-.20,-.17],[.23,.17],[-.08,.12],[.12,-.04],[-.34,-.10],[.34,.06],[0,0]];
 let [ax,ay]=n===1?[0,0]:seeds[rank%9];
 let rotation=(noise(item.id,p.seed+51)-.5)*tilt*3;
 if(p.layout==='fan'){ax=t*.85;ay=.08+t*t*.42;rotation=t*tilt*4;}
 if(p.layout==='staircase'){ax=t*.68;ay=t*.42;rotation=(rank%2?1:-1)*tilt*.5;}
 if(p.layout==='alternating'){const rows=Math.ceil(n/2);ax=n===1?0:(rank%2?1:-1)*.28;ay=rows===1?0:(Math.floor(rank/2)/(rows-1)-.5)*.44;rotation=(rank%2?1:-1)*tilt;}
 if(p.layout==='deck'){rotation=(rank%2?1:-1)*(tilt*.8+noise(item.id,p.seed)*tilt*.8);}
 if(n===1){ax=0;ay=0;rotation=0;}
 const ratio=crop.width*crop.sourceAspect/crop.height,fill=p.stackFill??1.15;
 const variation=.97+noise(item.id,p.seed+17)*.12;
 let w=(ratio<1?height*1.28*ratio:width*.86)*fill*variation,h=w/ratio;
 // Move the landing point inward before reducing size, retaining the spread and overlap.
 const c=Math.abs(Math.cos(rotation*Math.PI/180)),s=Math.abs(Math.sin(rotation*Math.PI/180));
 const insetCenter=(desired,extent,bounds)=>extent*.42>bounds/2?bounds/2:Math.max(extent*.42,Math.min(bounds-extent*.42,desired));
 const cx=insetCenter(width*(.5+ax*spacing),w*c+h*s,width),cy=insetCenter(height*(.5+ay*spacing),h*c+w*s,height);
 if(visibleFraction(cx,cy,w,h,rotation,width,height)<.84){
  let low=0,high=1;
  for(let k=0;k<22;k++){const mid=(low+high)/2;if(visibleFraction(cx,cy,w*mid,h*mid,rotation,width,height)>=.84)low=mid;else high=mid;}
  w*=low;h*=low;
 }
 return {left:cx-w/2,top:cy-h/2,width:w,height:h,rotation,crop};
}
/** Keep settled state exact while making the incoming sheet command attention. */
export function immersiveMotion(item,motion,progress,width,height,base){
 const p=Math.max(0,Math.min(1,progress)),r=1-p,dir=item.entrance??'down';
 const sx=dir==='left'?-1:dir==='right'?1:0,sy=dir==='up'?-1:dir==='down'?1:0;
 if(motion==='slide')return {...base,opacity:Math.min(1,p*4),transform:`translate(${sx*r*width*.6}px,${sy*r*height*.72}px) scale(${1.12-.12*p}) rotate(${r*(sx||sy)*13}deg)`};
 if(motion==='drop')return {...base,opacity:Math.min(1,p*4),transform:`translateY(${-r*height*.85}px) scale(${1.08-.08*p}) rotate(${-r*18}deg)`};
 if(motion==='pop')return {...base,transform:`scale(${.82+.18*p+Math.sin(Math.PI*p)*.12}) rotate(${r*(sx||sy)*8}deg)`};
 return base;
}

/** Later entrances sit above earlier sheets; equal-time items retain explicit list layering. */
export function immersiveLayer(items,index){
 const start=items[index].enterSeconds;
 return items.filter((item,n)=>item.enterSeconds<start||(item.enterSeconds===start&&n<index)).length;
}

/** Shared by the panel and renderer: manual order overrides automatic entry ordering. */
export function stackLayer(props,index){
 return props.layerMode!=='manual'&&props.framing==='immersive'&&props.layout!=='spread'?immersiveLayer(props.items,index):index;
}
export function stackFrontItems(props){
 return props.items.map((item,index)=>({item,layer:stackLayer(props,index)})).sort((a,b)=>b.layer-a.layer).map(({item})=>item);
}
export function moveStackLayer(props,id,to){
 const front=stackFrontItems(props),from=front.findIndex(i=>i.id===id);
 if(from<0||!Number.isInteger(to)||to<0||to>=front.length||from===to)return props;
 front.splice(to,0,front.splice(from,1)[0]);
 return {...props,layerMode:'manual',items:front.reverse()};
}
