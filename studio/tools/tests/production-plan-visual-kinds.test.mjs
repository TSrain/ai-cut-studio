import test from 'node:test';
import assert from 'node:assert/strict';
import {getPlanPreviewView} from '../editor/production-plan-view-model.mjs';
const doc=()=>({id:'p',canvas:{fps:{num:30,den:1},durationFrames:300},instances:[],tracks:[],audioClips:[],audioTracks:[]});
const shot=(extra={})=>({id:'s',requirementVersion:1,title:'本段',slots:[],bindings:[],candidates:[],timing:{ranges:[{id:'r',startFrame:0,durationFrames:120}]},...extra});
const ai=(extra={})=>({id:'ai',title:'办公环境',prompt:'固定机位，多人办公',promptVersion:1,requirementVersion:1,ignored:false,...extra});
test('animation alone has only the 动 type',()=>{
 const view=getPlanPreviewView(doc(),shot({animationNeed:'optional'}));
 assert.deepEqual(view.visualKinds,['animation']);
});
test('all three types coexist in 动 网 AI order',()=>{
 const view=getPlanPreviewView(doc(),shot({animationNeed:'required',candidates:[{id:'web',url:'https://example.com/office'}],aiVideoCandidates:[ai()]}));
 assert.deepEqual(view.visualKinds,['animation','footage','aiVideo']);
 assert.equal(view.sections.find(s=>s.kind==='aiVideo').items[0].text,'办公环境');
});
test('an AI return does not pretend to be network footage',()=>{
 const d=doc();d.instances=[{id:'return',assetId:'source-pip',startFrame:0,durationFrames:90,props:{sourceMode:'media',media:{publicPath:'/ai.mp4'},aiVideoIdentity:{aiVideoCandidateId:'ai'}}}];
 const view=getPlanPreviewView(d,shot({animationNeed:'none',aiVideoCandidates:[ai()]}));
 assert.deepEqual(view.visualKinds,['aiVideo']);
 assert.equal(view.sections.some(s=>s.kind==='footage'),false);
});
test('network candidates show 网 even without animation or AI',()=>{
 const view=getPlanPreviewView(doc(),shot({animationNeed:'none',candidates:[{id:'web',url:'https://example.com/office'}]}));
 assert.deepEqual(view.visualKinds,['footage']);assert.equal(view.visible,true);
});
test('search intent alone is not an existing network candidate',()=>{
 const view=getPlanPreviewView(doc(),shot({animationNeed:'none',footageIntent:{description:'寻找办公室'}}));
 assert.deepEqual(view.visualKinds,[]);
});
test('ignored, blank and old-requirement AI prompts do not get an AI badge',()=>{
 for(const candidate of [ai({ignored:true}),ai({prompt:'  '}),ai({requirementVersion:0})]){
  const view=getPlanPreviewView(doc(),shot({animationNeed:'optional',aiVideoCandidates:[candidate]}));
  assert.deepEqual(view.visualKinds,['animation']);
 }
});
test('a cancelled plan has no visual badges',()=>{
 const view=getPlanPreviewView(doc(),shot({cancelled:true,animationNeed:'required',aiVideoCandidates:[ai()]}));
 assert.deepEqual(view.visualKinds,[]);assert.equal(view.visible,false);
});

test('placed network footage retains its preview detail without an archived candidate report',()=>{
 const d=doc();d.instances=[{id:'office',name:'四人同框办公实拍',assetId:'source-pip',startFrame:0,durationFrames:90,props:{sourceMode:'media',media:{publicPath:'/office.mp4'},footageIdentity:{candidateId:'stock'}}}];
 const view=getPlanPreviewView(d,shot({animationNeed:'none'}));
 assert.deepEqual(view.visualKinds,['footage']);
 assert.equal(view.sections.find(s=>s.kind==='footage')?.items[0].text,'四人同框办公实拍');
 assert.equal(view.networkItems[0].instanceId,'office');
});
