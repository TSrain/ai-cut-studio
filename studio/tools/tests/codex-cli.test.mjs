import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {codexConfig,codexExecArgs,codexModelArgs,codexBinary} from '../lib/codex-cli.mjs';
import {chapterWorkerArgs} from '../lib/editor-chapters.mjs';
import {coverWorkerArgs} from '../lib/editor-cover-jobs.mjs';
const config={binary:'/x/codex',fallbackBinaries:[],model:'m-pinned',reasoningEffort:'high'};
const clean=t=>{const saved={};for(const k of ['CODEX_BIN','EDITOR_CODEX_BIN','EDITOR_CODEX_BINARY','CODEX_MODEL','CODEX_REASONING_EFFORT']){saved[k]=process.env[k];delete process.env[k];}t.after(()=>{for(const [k,v] of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;});};
test('codex exec argv always carries explicit model and effort',t=>{
 clean(t);
 assert.deepEqual(codexExecArgs(['-'],{config}),['--ask-for-approval','never','exec','--model','m-pinned','-c','model_reasoning_effort="high"','-']);
 assert.deepEqual(codexExecArgs(['-'],{config,approval:'auto'}).slice(0,4),['exec','--approve-for-me','--model','m-pinned']);
 for(const args of [chapterWorkerArgs('/tmp/j'),coverWorkerArgs({workflowRoot:'/w',artifactRoot:'/a',dir:'/d'})]){
  assert.ok(!args.includes('--model'));assert.ok(!args.some(a=>a.startsWith('model_reasoning_effort=')));
 }
});
test('env overrides and effort validation',t=>{
 clean(t);process.env.CODEX_MODEL='m-env';process.env.CODEX_REASONING_EFFORT='low';process.env.CODEX_BIN='/env/codex';
 assert.deepEqual(codexModelArgs(config),['--model','m-env','-c','model_reasoning_effort="low"']);
 assert.equal(codexBinary(config),'/env/codex');
 process.env.CODEX_REASONING_EFFORT='max';assert.throws(()=>codexModelArgs(config),/effort/);
});
test('reads the workflow repo config file',()=>{
 const dir=mkdtempSync(join(tmpdir(),'codex-cfg-'));try{
  writeFileSync(join(dir,'codex.json'),JSON.stringify({model:'from-file',reasoningEffort:'medium'}));
  const value=codexConfig(join(dir,'codex.json'));assert.equal(value.model,'from-file');assert.equal(value.reasoningEffort,'medium');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('no hand-built codex exec argv outside codex-cli.mjs',()=>{
 const dir=new URL('../lib/',import.meta.url).pathname;const offenders=[];
 for(const name of readdirSync(dir).filter(n=>n.endsWith('.mjs')&&n!=='codex-cli.mjs')){
  const text=readFileSync(join(dir,name),'utf8');if(/\[\s*['"]exec['"]\s*,/.test(text)||/spawn\(\s*["']codex["']/.test(text))offenders.push(name);
 }
 assert.deepEqual(offenders,[]);
});
