import test from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../../templates/remotion-base/src/editor/media-layout.mjs';
const layouts=['stack','spread','fan','staircase','alternating','deck'];
const make=(n,layout)=>({...m.defaultMediaProps('media-stack'),framing:'contained',layout,items:Array.from({length:n},(_,i)=>({...m.defaultMediaItem(`media-${i+1}`,i),media:{kind:'image',width:1080,height:1920,publicPath:'portrait.png'}}))});
const center=g=>[g.left+g.width/2,g.top+g.height/2];
test('all six arrangements accept 1–9 full portrait images on either canvas',()=>{
 assert.deepEqual(m.STACK_LAYOUT_OPTIONS,layouts);
 for(const layout of layouts)for(let n=1;n<=9;n++)for(const [w,h] of [[1920,1080],[1080,1920]]){
  const p=make(n,layout);m.validateMediaProps('media-stack',p);
  const gs=m.mediaGeometry('media-stack',p,w,h);assert.equal(gs.length,n);
  for(const g of gs){assert.ok(Math.abs(g.width/g.height-9/16)<1e-9);assert.deepEqual(g.crop,{x:0,y:0,width:1,height:1,sourceAspect:9/16});assert.ok(g.width>0&&g.height>0);}
 }
});
test('new arrangements are visibly different and preserve stable item placement on reorder',()=>{
 for(const [w,h] of [[1920,1080],[1080,1920]])for(const n of [2,3,5,9]){
  const signatures=[];
  for(const layout of layouts.filter(x=>x!=='spread')){
   const p=make(n,layout),a=m.mediaGeometry('media-stack',p,w,h);signatures.push(JSON.stringify(a));
   const reordered={...p,items:[...p.items].reverse()},b=m.mediaGeometry('media-stack',reordered,w,h);assert.deepEqual(a,[...b].reverse());
   if(layout!=='stack'){
    const centers=a.map(center);assert.equal(new Set(centers.map(JSON.stringify)).size,n);
    for(const g of a){const [cx,cy]=center(g);assert.ok(cx>w*.08&&cx<w*.92&&cy>h*.08&&cy<h*.92);}
   }
  }
  assert.equal(new Set(signatures).size,signatures.length);
 }
});
test('each new single-item arrangement centers a large image regardless of ID',()=>{
 for(const layout of layouts.slice(2))for(const [w,h] of [[1920,1080],[1080,1920]]){
  const p=make(1,layout);p.items[0].id='later-9';const [g]=m.mediaGeometry('media-stack',p,w,h);
  assert.deepEqual(center(g),[w/2,h/2]);assert.ok(g.height>=h*.7);assert.equal(g.rotation,0);
 }
});
test('arrangements respect independent position scale rotation and crop',()=>{
 for(const layout of layouts){const p=make(3,layout),a=m.mediaGeometry('media-stack',p,1920,1080);const item=p.items[1];Object.assign(item,{x:8,y:-6,scale:1.4,rotation:23});const b=m.mediaGeometry('media-stack',p,1920,1080);assert.deepEqual(a[0],b[0]);assert.equal(b[1].left,a[1].left+153.6);assert.equal(b[1].top,a[1].top-64.8);assert.equal(b[1].scale,1.4);assert.equal(b[1].rotation,a[1].rotation+23);item.crop={x:.1,y:.2,width:.6,height:.5,sourceAspect:9/16};const g=m.mediaGeometry('media-stack',p,1920,1080)[1];assert.ok(Math.abs(g.width/g.height-.6*9/16/.5)<1e-9);assert.deepEqual(g.crop,item.crop);}
});
test('individual motion overrides are validated and inherit each group edge independently',()=>{
 assert.equal(typeof m.resolveMediaMotion,'function');
 const p=make(3,'fan'),i=p.items[0];p.motion='slide';p.exitMotion='fade';
 assert.equal(m.resolveMediaMotion(i,p),'slide');assert.equal(m.resolveMediaMotion(i,p,'exit'),'fade');
 for(const motion of m.MOTION_OPTIONS){i.motion=motion;i.exitMotion=motion;m.validateMediaProps('media-stack',p);assert.equal(m.resolveMediaMotion(i,p),motion);assert.equal(m.resolveMediaMotion(i,p,'exit'),motion);}
 delete i.exitMotion;assert.equal(m.resolveMediaMotion(i,p,'exit'),'fade');delete p.exitMotion;assert.equal(m.resolveMediaMotion(i,p,'exit'),'slide');
 for(const key of ['motion','exitMotion']){i[key]='invalid';assert.throws(()=>m.validateMediaProps('media-stack',p),/方式/);delete i[key];}
});
test('replacement preserves all independent properties and updates only source aspect',()=>{
 const p=make(1,'fan'),i={...p.items[0],x:12,y:-8,scale:1.2,rotation:17,motion:'flip',exitMotion:'wipe',enterSeconds:.7,exitSeconds:4,crop:{x:.1,y:.2,width:.7,height:.6,sourceAspect:9/16}};
 const media={kind:'image',publicPath:'new.png',width:1920,height:1080},r=m.replaceMediaItem(i,media);
 assert.deepEqual(r,{...i,media,crop:{...i.crop,sourceAspect:16/9}});
});
test('new splits default to diagonal while explicit legacy horizontal stays horizontal',()=>{
 const p=m.defaultMediaProps('media-split');assert.equal(p.layout,'diagonal');assert.equal(p.separatorAngle,20);
 p.layout='horizontal';delete p.mode;m.validateMediaProps('media-split',p);const [a,b]=m.mediaGeometry('media-split',p,1920,1080);assert.equal(a.clipPath,undefined);assert.equal(b.left-a.width,p.gap);
});
test('four sequential clips retain angled and biased cuts through both replacements',()=>{
 for(const angle of [-20,20])for(const pos of [35,65])for(const [w,h] of [[1920,1080],[1080,1920]]){
  const p={...m.defaultMediaProps('media-split'),layout:'diagonal',separatorAngle:angle,separatorPosition:pos,items:make(4,'stack').items.map((i,n)=>({...i,enterSeconds:n,media:{kind:'video',publicPath:'clip.mp4',width:1920,height:1080,durationSeconds:8}}))};
  m.validateMediaProps('media-split',p);const settled=m.mediaSequenceState(p,50,30,6,w,h),late=m.mediaSequenceState(p,110,30,6,w,h);
  assert.deepEqual(late.filter(s=>s.timing.visible).map(s=>s.index),[2,3]);
  for(let n=0;n<2;n++){const a=late[n+2].geometry,b=settled[n].geometry;for(const key of ['left','top','width','height','rotation','scale'])assert.ok(Math.abs(a[key]-b[key])<1e-8);for(const key of ['x','y','width','height'])assert.ok(Math.abs(a.crop[key]-b.crop[key])<1e-8);const nums=g=>[...g.clipPath.matchAll(/([\d.]+)px/g)].map(v=>Number(v[1]));nums(a).forEach((v,k)=>assert.ok(Math.abs(v-nums(b)[k])<1e-8));assert.ok(late[n+2].geometry.clipPath.startsWith('polygon('));}
  const before=m.mediaSequenceState(p,59,30,6,w,h)[1],at=m.mediaSequenceState(p,60,30,6,w,h)[1];assert.equal(at.timing.sourceFrame,before.timing.sourceFrame+1);
 }
});

test('new arrangements retain mixed source aspects and stay inside rotated canvas bounds',()=>{
 for(const layout of layouts.slice(2))for(const [w,h] of [[1920,1080],[1080,1920]])for(const n of [1,4,9]){
  const p=make(n,layout);p.items.forEach((i,k)=>{i.id=['random-alpha','a0','zebra-482','uuid-test','media-100','media-2','media-20','bbb','ccc'][k];if(k%2)i.media={...i.media,width:1920,height:1080};});
  const gs=m.mediaGeometry('media-stack',p,w,h);
  gs.forEach((g,k)=>{assert.ok(Math.abs(g.width/g.height-p.items[k].media.width/p.items[k].media.height)<1e-9);const [cx,cy]=center(g),r=g.rotation*Math.PI/180;const bw=g.width*Math.abs(Math.cos(r))+g.height*Math.abs(Math.sin(r)),bh=g.height*Math.abs(Math.cos(r))+g.width*Math.abs(Math.sin(r));assert.ok(cx-bw/2>=0&&cx+bw/2<=w&&cy-bh/2>=0&&cy+bh/2<=h);});
  assert.deepEqual(m.mediaGeometry('media-stack',{...p,items:[...p.items].reverse()},w,h),[...gs].reverse());
 }
});
