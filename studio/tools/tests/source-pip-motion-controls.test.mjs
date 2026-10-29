import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=process.env.VISUALIZATION_ROOT??resolve(fileURLToPath(new URL('../..',import.meta.url)));
const require=createRequire(join(root,'templates/remotion-base/package.json'));
const {pipGeometry,PIP_DEFAULTS}=await import(join(root,'templates/remotion-base/src/editor/source-pip.mjs'));
const {configureMediaClip}=await import(join(root,'tools/editor/media-clip.mjs'));
const temp=mkdtempSync(join(tmpdir(),'pip-motion-controls-'));
const output=join(temp,'controls.cjs');
try {
 await require('esbuild').build({entryPoints:[join(root,'tools/editor/SourcePipControls.tsx')],outfile:output,bundle:true,platform:'node',format:'cjs',nodePaths:[join(root,'templates/remotion-base/node_modules')],logLevel:'silent'});
 const {SourcePipControls}=require(output);
 const canvas={width:1920,height:1080,fps:{num:30,den:1},durationFrames:300};
 const imported=kind=>configureMediaClip({id:'test',assetId:'source-pip',startFrame:0,props:{}},{publicPath:`test.${kind==='image'?'png':'mp4'}`,width:1920,height:1080,durationSeconds:3},kind,{canvas},'test').props;
 const find=(node,predicate)=>Array.isArray(node)?node.flatMap(n=>find(n,predicate)):node&&typeof node==='object'?[...(predicate(node)?[node]:[]),...find(node.props?.children,predicate)]:[];
 function controls(initial){
  let props=structuredClone(initial),writes=0;
  return {get props(){return props;},get writes(){return writes;},select(key,value){
   const tree=SourcePipControls({props,canvas,startFrame:0,onProp:(k,v)=>{props={...props,[k]:v};writes++;},onPatch:patch=>{props={...props,...(typeof patch==='function'?patch(props):patch)};writes++;}});
   const label=key==='entrance'?'小窗入场':'小窗退场';
   const select=find(tree,n=>n.type==='select'&&n.props['aria-label']===label)[0];
   assert.ok(select,`${label} control exists`);select.props.onChange({target:{value}});
  }};
 }
 for(const kind of ['image','video'])for(const key of ['entrance','exit'])test(`${kind}: selecting ${key} on zero-duration imported media visibly animates`,()=>{
  const c=controls(imported(kind));c.select(key,'fade');
  assert.equal(c.props.transitionSeconds,PIP_DEFAULTS.transitionSeconds);
  assert.equal(c.writes,1,'mode and duration form one undoable patch');
  const at=frame=>pipGeometry(1920,1080,90,frame,30,c.props);
  assert.equal(at(key==='entrance'?0:89).opacity,0);assert.equal(at(45).opacity,1);
  assert.ok(at(key==='entrance'?5:84).opacity>0&&at(key==='entrance'?5:84).opacity<1);
 });
 test('positive custom timing and the opposite effect survive selection',()=>{
  const c=controls({...imported('image'),transitionSeconds:.8,exit:'flip'});c.select('entrance','slide-left');
  assert.equal(c.props.transitionSeconds,.8);assert.equal(c.props.exit,'flip');
 });
 test('none does not enable transitions or change placement/crop',()=>{
  const original=imported('image'),c=controls(original);c.select('entrance','none');c.select('exit','none');
  assert.deepEqual(c.props,original);
  assert.deepEqual(pipGeometry(1920,1080,90,0,30,c.props),pipGeometry(1920,1080,90,89,30,c.props));
 });
 test('all effect choices recover zero duration on legacy media and synchronized windows',()=>{
  for(const sourceMode of ['main','media'])for(const key of ['entrance','exit'])for(const mode of ['fade','slide-left','slide-right','slide-up','slide-down','pop','flip',key==='entrance'?'shrink':'expand']){
   const c=controls({...PIP_DEFAULTS,sourceMode,entrance:'none',exit:'none',transitionSeconds:0});c.select(key,mode);
   assert.equal(c.props.transitionSeconds,.35,`${sourceMode}/${key}/${mode}`);
  }
 });
} finally {rmSync(temp,{recursive:true,force:true});}
