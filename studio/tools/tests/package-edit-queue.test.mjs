import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {branchValueHash,branchOperationId,enqueueBranchOperation,drainBranchOperations} from '../lib/package-branch-application.mjs';
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
function setup(){
 const outputRoot=mkdtempSync(join(tmpdir(),'edit-package-'));
 const base={id:'p',revision:1,captions:{text:'原话',color:'white'},productionPlan:{changes:[]}};
 let doc=structuredClone(base),calls=0;
 const basePath=join(outputRoot,'base.json');writeFileSync(basePath,JSON.stringify({document:base}));
 const payload={value:{text:'原话',color:'blue'}};
 const op={schemaVersion:1,packageOrchestrationVersion:2,projectId:'p',runId:'r',branchId:'captions',attemptId:'a',kind:'captions',dependencyFingerprint:'a'.repeat(64),payload,payloadSha256:branchValueHash(payload),readSet:[{path:['captions'],beforeHash:branchValueHash(base.captions)}],writeSet:[{path:['captions'],beforeHash:branchValueHash(base.captions)}],dependsOn:[],files:[{path:basePath,sha256:sha(basePath)}]};
 op.operationId=branchOperationId(op);
 const receipt={status:'passed',projectId:'p',runId:'r',branchId:'captions',attemptId:'a',dependencyFingerprint:op.dependencyFingerprint,payloadSha256:op.payloadSha256,reconciliationBasePath:basePath,reconciliationBaseSha256:sha(basePath)};
 op.validationReceiptPath=join(outputRoot,'gate.json');writeFileSync(op.validationReceiptPath,JSON.stringify(receipt));op.validationReceiptSha256=sha(op.validationReceiptPath);
 const context={outputRoot,projectId:'p',runId:'r',packageOrchestrationVersion:2,load:()=>structuredClone(doc),save:(next,revision)=>{assert.equal(revision,doc.revision);doc={...next,revision:revision+1};return structuredClone(doc)},adapters:{captions:(d,o)=>({...d,captions:o.payload.value})},reconcile:(b,p,c,o)=>{calls++;assert.deepEqual(b,base);return {document:{...c,captions:{...p.captions,text:c.captions.text}},report:{status:'rebased',preserved:['captions.text']}}}};
 return {op,context,get doc(){return doc},set doc(d){doc=d},get calls(){return calls}};
}
test('queue reconciles frozen proposal against latest manual edit and keeps proof unchanged',async()=>{
 const f=setup(),frozen=JSON.stringify(f.op);f.doc={...f.doc,revision:2,captions:{text:'人工校正',color:'white'}};
 await enqueueBranchOperation(f.op,f.context);const rows=await drainBranchOperations('p',f.context);
 assert.equal(rows[0].status,'applied');assert.equal(f.doc.captions.text,'人工校正');assert.equal(f.doc.captions.color,'blue');assert.equal(JSON.stringify(f.op),frozen);assert.equal(rows[0].reconciliation.status,'rebased');
 const receipt=JSON.parse(readFileSync(rows[0].receiptPath));assert.equal(receipt.reconciliation.status,'rebased');
 await drainBranchOperations('p',f.context);assert.equal(f.calls,1);
});
test('reconciliation without frozen base proof fails closed',async()=>{
 const f=setup();delete f.context.reconcile;f.doc.captions.text='人工';await enqueueBranchOperation(f.op,f.context);const rows=await drainBranchOperations('p',f.context);assert.equal(rows[0].status,'stale');assert.equal(f.doc.captions.text,'人工');
});
test('only SHA-bound applied caption readbacks enter later reconciliation',async()=>{
 const f=setup();f.context.acceptCaptionReadback=(b,p,c)=>c;
 await enqueueBranchOperation(f.op,f.context);await drainBranchOperations('p',f.context);
 const second=structuredClone(f.op);second.attemptId='b';second.operationId=branchOperationId(second);second.validationReceiptPath=join(f.context.outputRoot,'gate2.json');const receipt=JSON.parse(readFileSync(f.op.validationReceiptPath));receipt.attemptId='b';writeFileSync(second.validationReceiptPath,JSON.stringify(receipt));second.validationReceiptSha256=sha(second.validationReceiptPath);
 let trusted;f.context.reconcile=(b,p,c,o,metadata)=>{trusted=metadata.acceptedCaptionDocuments;return {document:c,report:{}}};
 await enqueueBranchOperation(second,f.context);await drainBranchOperations('p',f.context);
 assert.equal(trusted.length,1);assert.equal(trusted[0].captions.color,'blue');
});
test('CAS conflict retries reconciliation against new manual edit',async()=>{
 const f=setup();f.doc.captions.text='第一次手改';let attempts=0;const save=f.context.save;
 f.context.save=(next,rev)=>{if(!attempts++){f.doc={...f.doc,revision:rev+1,captions:{...f.doc.captions,text:'保存瞬间再次手改'}};const e=Error('Revision conflict');e.status=409;throw e;}return save(next,rev)};
 await enqueueBranchOperation(f.op,f.context);const rows=await drainBranchOperations('p',f.context);
 assert.equal(rows[0].status,'applied');assert.equal(f.doc.captions.text,'保存瞬间再次手改');assert.equal(f.calls,2);
});
