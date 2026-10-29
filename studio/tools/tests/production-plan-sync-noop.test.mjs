import assert from 'node:assert/strict';
import test from 'node:test';
import {mergeServerDelta, syncPlanHistory} from '../editor/production-plan-sync.mjs';
import {undoHistory, redoHistory} from '../editor/history.mjs';

const document = () => ({
  id: 'project', revision: 1,
  instances: [{id: 'a', startFrame: 0, props: {label: 'original'}}],
  productionPlan: {shots: [{id: 'shot', candidates: []}]},
});

function assertIdle(h, base, remote) {
  let historyReads = 0;
  const guarded = {
    present: h.present,
    get past() { historyReads++; return h.past; },
    get future() { historyReads++; return h.future; },
  };
  const next = syncPlanHistory(guarded, base, remote, true);
  assert.equal(next, guarded, 'an ineffective poll must preserve history identity');
  assert.equal(historyReads, 0, 'an ineffective poll must not visit undo/redo snapshots');
}

test('unchanged remote polling preserves history identity and never visits snapshots', () => {
  const base = document();
  assertIdle({past: [structuredClone(base)], present: structuredClone(base), future: []}, base, structuredClone(base));
});

test('unchanged remote polling leaves unsaved edits and redo snapshots untouched', () => {
  const base = document();
  const edited = structuredClone(base);
  edited.instances[0].props.label = 'local draft';
  const redo = structuredClone(edited);
  redo.instances[0].startFrame = 30;
  assertIdle({past: [base], present: edited, future: [redo]}, base, structuredClone(base));
  assert.equal(edited.instances[0].props.label, 'local draft');
  assert.equal(redo.instances[0].startFrame, 30);
});

test('server changes already present locally do not rebuild history', () => {
  const base = document();
  const remote = structuredClone(base);
  remote.revision++;
  remote.productionPlan.shots[0].candidates.push({id: 'candidate'});
  assertIdle({past: [base], present: structuredClone(remote), future: [base]}, base, remote);
});

test('a server delta fully overridden by local edits does not rebuild history', () => {
  const base = document(), local = structuredClone(base), remote = structuredClone(base);
  local.instances[0].props.label = 'keep local';
  remote.instances[0].props.label = 'remote proposal';
  assertIdle({past: [base], present: local, future: []}, base, remote);
});

test('real server candidates rebase undo and redo while retaining local edits', () => {
  const base = document(), local = structuredClone(base), remote = structuredClone(base);
  local.instances[0].props.label = 'local edit';
  remote.revision++;
  remote.productionPlan.shots[0].candidates.push({id: 'candidate'});
  const h = {past: [base], present: local, future: []};
  const next = syncPlanHistory(h, base, remote);
  assert.notEqual(next, h);
  assert.equal(next.present.instances[0].props.label, 'local edit');
  const undone = undoHistory(next);
  assert.equal(undone.present.instances[0].props.label, 'original');
  assert.deepEqual(undone.present.productionPlan.shots[0].candidates, [{id: 'candidate'}]);
  assert.equal(redoHistory(undone).present.instances[0].props.label, 'local edit');
  assert.deepEqual(base.productionPlan.shots[0].candidates, []);
});

test('public mergeServerDelta still clones unchanged local content', () => {
  const base = document(), local = structuredClone(base);
  const next = mergeServerDelta(base, local, structuredClone(base));
  assert.deepEqual(next, local);
  assert.notEqual(next, local);
  assert.notEqual(next.instances, local.instances);
});
