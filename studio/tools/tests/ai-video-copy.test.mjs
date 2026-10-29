import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {aiVideoPromptText} from '../editor/ai-video-candidates.mjs';
const helper=await import('../editor/ai-video-copy.mjs').catch(()=>({}));
const candidate={id:'office',title:'办公室场景',prompt:'办公室中一个人看着屏幕，随后起身离开。\n保持中景跟拍。',promptVersion:1,requirementVersion:1,sourceCueIds:[1],reason:'情境示意',aspectRatio:'16:9',durationSeconds:5,references:[{path:'/tmp/office.png',label:'办公室',purpose:'环境关系'}]};
const expected=aiVideoPromptText(candidate);
function fakeBrowser({accepted=true,throws=false}={}){
 let copied='旧fixture：汽车收费站',selected=null,asyncCalls=0,restored=0;
 const children=[],commands=[];
 const original={focus(){restored++;}};
 const document={activeElement:original,body:{appendChild(node){children.push(node);node.parentNode=this;},removeChild(node){children.splice(children.indexOf(node),1);}},createElement(){return {value:'',style:{},readOnly:false,setAttribute(){},focus(){document.activeElement=this;},select(){selected=this;},setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;},remove(){if(this.parentNode)this.parentNode.removeChild(this);}};},execCommand(command){commands.push(command);if(throws)throw Error('copy denied');if(accepted)copied=selected.value;return accepted;}};
 return {document,navigator:{clipboard:{writeText:async()=>{asyncCalls++;},readText:async()=>copied}},get copied(){return copied;},get asyncCalls(){return asyncCalls;},get restored(){return restored;},children,commands};
}
test('copy runs synchronously inside the gesture even when async clipboard falsely resolves',()=>{
 assert.equal(typeof helper.copyAiVideoPrompt,'function');
 const browser=fakeBrowser();const outcome=helper.copyAiVideoPrompt(expected,browser);
 assert.equal(browser.copied,expected);assert.equal(outcome,true);assert.deepEqual(browser.commands,['copy']);assert.equal(browser.asyncCalls,0);assert.equal(browser.children.length,0);assert.equal(browser.restored,1);
});
for(const options of [{accepted:false},{throws:true}])test('a rejected selection command never reports copy success '+JSON.stringify(options),()=>{
 assert.equal(typeof helper.copyAiVideoPrompt,'function');const browser=fakeBrowser(options);
 assert.equal(helper.copyAiVideoPrompt(expected,browser),false);assert.equal(browser.copied,'旧fixture：汽车收费站');assert.equal(browser.children.length,0);assert.equal(browser.asyncCalls,0);
});
test('missing copy command falls back without throwing or trusting stale async clipboard',()=>{
 assert.equal(typeof helper.copyAiVideoPrompt,'function');const browser=fakeBrowser();delete browser.document.execCommand;
 assert.equal(helper.copyAiVideoPrompt(expected,browser),false);assert.equal(browser.copied,'旧fixture：汽车收费站');assert.equal(browser.children.length,0);
});
async function cardHarness(browser){
 const require=createRequire(new URL('../../templates/remotion-base/package.json',import.meta.url)),React=require('react');
 const {build}=require('esbuild');
 const compiled=await build({entryPoints:[fileURLToPath(new URL('../editor/AiVideoCandidateCard.tsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'cjs',external:['react','react-dom','react-dom/*'],nodePaths:[fileURLToPath(new URL('../../templates/remotion-base/node_modules',import.meta.url))]});
 const values=[];let cursor=0;
 const mock={...React,useState(initial){const i=cursor++;if(!(i in values))values[i]=typeof initial==='function'?initial():initial;return [values[i],value=>{values[i]=typeof value==='function'?value(values[i]):value;}];},useRef(initial){const i=cursor++;return values[i]??(values[i]={current:initial});},useEffect(){},useContext(){return {projectId:'p',getProjectId:()=> 'p'};}};
 const module={exports:{}};runInNewContext(compiled.outputFiles[0].text,{module,exports:module.exports,require:name=>name==='react'?mock:require(name),document:browser.document,navigator:browser.navigator,structuredClone});
 const shot={id:'s',requirementVersion:1,bindings:[]},doc={id:'p',instances:[]};
 const render=()=>{cursor=0;return module.exports.AiVideoCandidateCard({document:doc,shot,candidate,controller:{jobs:[]}});};
 const walk=(node,predicate)=>{if(!node||typeof node!=='object')return; if(predicate(node))return node;for(const child of React.Children.toArray(node.props?.children)){const found=walk(child,predicate);if(found)return found;}};
 return {render,walk};
}
test('real card click copies the current office candidate synchronously and does not claim verified clipboard success',async()=>{
 const browser=fakeBrowser(),{render,walk}=await cardHarness(browser);let tree=render();
 walk(tree,n=>n.type==='button'&&n.props.children==='复制提示词').props.onClick();
 assert.equal(browser.copied,expected);
 tree=render();assert.equal(walk(tree,n=>n.type==='button'&&n.props.children==='已复制提示词'),undefined);
 assert.ok(walk(tree,n=>n.props?.role==='status'&&String(n.props.children).includes('粘贴核对')));
});
test('manual fallback exposes and selects the full prompt including ratio, duration and ordered references',async()=>{
 const browser=fakeBrowser({accepted:false}),{render,walk}=await cardHarness(browser);let tree=render();
 const textarea=walk(tree,n=>n.type==='textarea'&&n.props['aria-label']==='完整AI视频提示词');assert.ok(textarea);assert.equal(textarea.props.value,expected);assert.equal(textarea.props.readOnly,true);
 const source=browser.document.createElement('textarea');source.value=expected;textarea.ref.current=source;
 const details=walk(tree,n=>n.type==='details');details.ref.current={open:false};
 walk(tree,n=>n.type==='button'&&n.props.children==='复制提示词').props.onClick();
 assert.equal(details.ref.current.open,true);assert.equal(source.selectionStart,0);assert.equal(source.selectionEnd,expected.length);
 tree=render();assert.ok(walk(tree,n=>n.type==='button'&&n.props.children==='全选手动复制'));assert.equal(browser.copied,'旧fixture：汽车收费站');
 assert.ok(walk(tree,n=>n.props?.role==='status'&&String(n.props.children).includes('Ctrl+C')));
});
