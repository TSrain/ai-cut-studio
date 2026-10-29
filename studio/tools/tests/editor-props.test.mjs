import test from "node:test";
import assert from "node:assert/strict";
import { validateEditorProps } from "../lib/editor-props.mjs";
import {mkdtempSync, mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test("invalid editable props fail before saving and rendering", () => {
  assert.throws(() =>
    validateEditorProps({ assetId: "number-beat", props: {} }, 300),
  );
  assert.throws(() =>
    validateEditorProps(
      {
        assetId: "number-beat",
        props: {
          slots: { value: 4, label: "x" },
          variant: { layout: "side", celebrate: "confetti" },
        },
      },
      300,
    ),
  );
  assert.throws(() =>
    validateEditorProps(
      {
        assetId: "pill-stack",
        props: {
          slots: { items: ["x"] },
          elements: { "item-0": { opacity: 2 } },
        },
      },
      300,
    ),
  );
  assert.doesNotThrow(() =>
    validateEditorProps(
      {
        assetId: "number-beat",
        props: {
          slots: { value: 4, label: "x" },
          elements: { number: { fontSize: 90 } },
        },
      },
      300,
    ),
  );
});

test('all documented presets validate their slot and variant contracts', () => {
  assert.doesNotThrow(() => validateEditorProps({assetId: 'title-reveal', props: {slots: {title: '完整模板'}, variant: {style: 'marker'}}}, 300));
  assert.throws(() => validateEditorProps({assetId: 'title-reveal', props: {slots: {}, variant: {style: 'marker'}}}, 300), /标题/);
  assert.throws(() => validateEditorProps({assetId: 'title-reveal', props: {slots: {title: '完整模板'}, variant: {style: 'invalid'}}}, 300), /选项/);
  assert.throws(() => validateEditorProps({assetId: 'aspect-embed', props: {slots: {title: '素材镜'}}}, 300), /视频素材必须先放入本地/);
});

test('registered preset chrome remains legitimate editor props', () => {
  assert.doesNotThrow(() => validateEditorProps({assetId: 'title-reveal', props: {slots: {title: '带品牌'}, brand: {text: 'ACME'}, sfx: {src: 'sfx/hit.wav'}}}, 300));
});

test('generic editor transforms are valid saved props with finite bounds', () => {
  assert.doesNotThrow(() => validateEditorProps({assetId: 'title-reveal', props: {slots: {title: '可拖动'}, tune: {x: 240, y: -180, scale: 1.4}}}, 300));
  assert.throws(() => validateEditorProps({assetId: 'title-reveal', props: {slots: {title: '坏位置'}, tune: {x: Infinity}}}, 300), /整体横向位置/);
  assert.throws(() => validateEditorProps({assetId: 'title-reveal', props: {slots: {title: '坏缩放'}, tune: {scale: 0}}}, 300), /整体缩放/);
});

test('generated Zod constraints reject invalid slot numbers', () => {
  const base = {assetId: 'screen-push', props: {slots: {image: 'sample.png', imgW: 100, imgH: 100, focusX: 0.5, focusY: 0.5}}};
  assert.doesNotThrow(() => validateEditorProps(base, 300));
  assert.throws(() => validateEditorProps({assetId: 'screen-push', props: {slots: {...base.props.slots, focusX: 1.1}}}, 300), /不能大于 1/);
  assert.throws(() => validateEditorProps({assetId: 'screen-push', props: {slots: {...base.props.slots, imgW: 1.5}}}, 300), /必须是整数/);
  assert.throws(() => validateEditorProps({assetId: 'card-swarm', props: {slots: {total: 7, keep: 2}}}, 300), /不能小于 8/);
});

test('material paths are draft-friendly on save and strict before export', () => {
  const publicRoot = mkdtempSync(join(tmpdir(), 'editor-public-'));
  mkdirSync(join(publicRoot, 'footage'));
  writeFileSync(join(publicRoot, 'footage/demo.mp4'), 'fixture');
  const instance = {assetId: 'aspect-embed', props: {slots: {clip: 'demo.mp4', title: '素材'}}};
  assert.doesNotThrow(() => validateEditorProps(instance, 300, {publicRoot}));
  assert.doesNotThrow(() => validateEditorProps(instance, 300, {publicRoot, requireAssets: true}));
  assert.doesNotThrow(() => validateEditorProps({assetId: 'aspect-embed', props: {slots: {clip: 'later.mp4', title: '草稿'}}}, 300, {publicRoot}));
  assert.throws(() => validateEditorProps({assetId: 'aspect-embed', props: {slots: {clip: 'later.mp4', title: '导出'}}}, 300, {publicRoot, requireAssets: true}), /素材不存在.*public\/footage\/later\.mp4/);
  assert.throws(() => validateEditorProps({assetId: 'aspect-embed', props: {slots: {clip: '../escape.mp4', title: '越界'}}}, 300, {publicRoot}), /安全的相对路径/);
});
