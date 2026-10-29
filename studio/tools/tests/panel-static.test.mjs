import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, realpathSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {resolvePanelStatic} from '../lib/panel-static.mjs';

test('panel serves repository assets first and Remotion public assets as fallback', () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'panel-root-'));
  const publicRoot = join(repoRoot, 'templates/remotion-base/public');
  mkdirSync(join(repoRoot, 'assets'), {recursive: true});
  mkdirSync(join(publicRoot, 'footage'), {recursive: true});
  writeFileSync(join(repoRoot, 'assets/panel.mp4'), 'repo');
  writeFileSync(join(publicRoot, 'footage/demo.mp4'), 'public');
  assert.equal(resolvePanelStatic('/assets/panel.mp4', {repoRoot, publicRoot}), realpathSync(join(repoRoot, 'assets/panel.mp4')));
  assert.equal(resolvePanelStatic('/footage/demo.mp4', {repoRoot, publicRoot}), realpathSync(join(publicRoot, 'footage/demo.mp4')));
});

test('panel public fallback rejects traversal and symlink escape', () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'panel-root-'));
  const outside = mkdtempSync(join(tmpdir(), 'panel-outside-'));
  const publicRoot = join(repoRoot, 'public');
  mkdirSync(join(publicRoot, 'footage'), {recursive: true});
  writeFileSync(join(outside, 'secret.mp4'), 'secret');
  symlinkSync(join(outside, 'secret.mp4'), join(publicRoot, 'footage/link.mp4'));
  assert.equal(resolvePanelStatic('/../secret.mp4', {repoRoot, publicRoot}), null);
  assert.equal(resolvePanelStatic('/footage/link.mp4', {repoRoot, publicRoot}), null);
});
