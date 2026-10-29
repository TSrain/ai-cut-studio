import test from 'node:test';import assert from 'node:assert/strict';
const {planRevisionStatus}=await import('../editor/plan-revision-status.mjs').catch(()=>({}));
test('worker completion alone does not claim saved success',()=>{assert.equal(typeof planRevisionStatus,'function');assert.equal(planRevisionStatus({status:'complete',results:[{kind:'shot-revision',state:'pending'}]}).state,'saving');});
test('saving success requires applied results and no gaps',()=>{assert.equal(planRevisionStatus({status:'complete',results:[{kind:'shot-revision',state:'applied',patches:[{before:'旧',after:'新'}],gaps:[]}]}).label,'修改成功');assert.equal(planRevisionStatus({status:'partial',results:[{kind:'shot-revision',state:'applied',patches:[{before:'旧',after:'新'}],gaps:['需制作新素材']}]}).state,'partial');});
test('conflicts failed jobs and queued tasks retain visible status outside the editor',()=>{assert.equal(planRevisionStatus({status:'complete',results:[{kind:'shot-revision',state:'conflict'}]}).state,'failed');assert.equal(planRevisionStatus({status:'failed',error:'失败'}).label,'修改失败');assert.equal(planRevisionStatus({status:'queued'}).label,'修改中…');});

test('an applied no-op never reports that content was modified',()=>{for(const patches of [[],[{before:'原文',after:'原文'}]])assert.equal(planRevisionStatus({status:'partial',results:[{kind:'shot-revision',state:'applied',patches,gaps:['缺少可替换素材']}]}).label,'未修改');});

test('partial worker output without applied patches does not claim partial completion',()=>{assert.equal(planRevisionStatus({status:'partial',results:[{kind:'shot-revision',state:'pending',patches:[{before:'旧',after:'新'}],gaps:['写回失败']}]}).label,'修改未写回');});
test('a saved semantic change cannot report completion while its footage execution is active',()=>{
 const result={kind:'shot-revision',state:'applied',patches:[{before:'旧',after:'电脑操作'}],gaps:[],execution:{kind:'footage',instructions:'搜集电脑镜头'}};
 for(const executionStatus of [undefined,'queued','running'])assert.equal(planRevisionStatus({status:'complete',results:[result],executionStatus}).state,'working');
 assert.equal(planRevisionStatus({status:'complete',results:[result],executionStatus:'complete'}).label,'修改成功');
 assert.equal(planRevisionStatus({status:'complete',results:[result],executionStatus:'failed'}).label,'素材修改失败');
 assert.equal(planRevisionStatus({status:'complete',results:[result],executionStatus:'partial'}).label,'素材尚未完成');
});
test('media-only feedback succeeds only after the actual footage placement was saved',()=>{
 const job={status:'complete',results:[{kind:'shot-revision',state:'applied',patches:[],gaps:[],execution:{kind:'footage',instructions:'找电脑操作素材'}}]};
 assert.equal(planRevisionStatus({...job,executionStatus:'running'}).label,'正在搜集素材…');
 assert.equal(planRevisionStatus({...job,executionStatus:'complete'}).label,'修改成功');
});
