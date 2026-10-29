// 声音链路的结构测试。
//
// 这条链路的失败方式几乎全是**静默**的:音效目录少了中文说明(用户在控制台里看不懂)、
// 卡点网格没验收就拿去分镜(片子拼完和原声对不上)、分发红线忘了(公开仓库时连素材一起公开)。
// 三样都不会报错,所以要测。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, access} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join} from 'node:path';

const assetTest = (name, fn) => test(name, {skip: process.env.STUDIO_ASSET_TESTS !== '1' && 'Personal audio library is not distributed'}, fn);
const catalog = process.env.STUDIO_ASSET_TESTS === '1' ? JSON.parse(await readFile('assets/library/sfx/CATALOG.json', 'utf8')) : {items: []};
const cine = catalog.items.filter((i) => String(i.file).startsWith('cinematic/'));

assetTest('每个音效条目都有中文名和真实文件 —— 只有文件名的素材等于没入库', async () => {
  assert.ok(cine.length >= 149, `电影系音效应有 149 条,实到 ${cine.length}`);
  for (const item of cine) {
    await access(join('assets/library/sfx', item.file));
    assert.ok(item.name && item.name !== item.file, `${item.file} 缺中文名`);
    assert.ok(item.cat, `${item.file} 缺类别`);
    assert.ok(typeof item.dur === 'number' && item.dur > 0, `${item.file} 缺时长`);
  }
});

assetTest('ui/ 逐条标了质感判定 —— 这一类不许整目录放行', () => {
  const ui = cine.filter((i) => i.cat === 'ui');
  assert.ok(ui.length > 0);
  for (const item of ui) {
    assert.ok(['ok', 'maybe', 'no'].includes(item.verdict), `${item.file} 的 verdict 不合法:${item.verdict}`);
  }
  // 判定图例必须在,否则 ok/maybe/no 三个词对读的人没有意义
  for (const key of ['ok', 'maybe', 'no']) assert.ok(catalog.verdictLegend?.[key]);
});

assetTest('分发红线写在目录里 —— 忘了它就会在公开仓库时连素材一起公开', () => {
  const cineSource = catalog.sources.find((s) => s.set === 'cinematic');
  assert.ok(cineSource, '缺 cinematic 的来源记录');
  assert.match(cineSource.redistribution, /不允许把素材作为独立文件再分发/);
  assert.ok(existsSync('assets/library/sfx/cinematic/ATTRIBUTION.md'), '缺逐条授权记录');
});

assetTest('每首 BGM 都有节拍网格,且网格自带验收结论', async () => {
  const {readdirSync} = await import('node:fs');
  const bgms = readdirSync('assets/library/bgm').filter((f) => f.endsWith('.mp3'));
  assert.ok(bgms.length >= 5, `BGM 应有 5 首,实到 ${bgms.length}`);
  for (const f of bgms) {
    const p = join('assets/library/bgm', f.replace(/\.mp3$/, '.beats.json'));
    assert.ok(existsSync(p), `${f} 没跑过 beat-grid`);
    const b = JSON.parse(await readFile(p, 'utf8'));
    // accepted 是分镜前的闸门:不通过的歌不该拿去卡点
    assert.equal(typeof b.accepted, 'boolean');
    assert.ok(b.bpm > 40 && b.bpm < 220, `${f} 的 BPM ${b.bpm} 不在乐理合理范围 —— 多半是倍频滑出去了`);
    assert.ok(b.grid.length > 0);
    // 时间线要按拍号写,所以每拍必须给出帧号
    assert.ok(b.grid.every((g) => Number.isInteger(g.frame)));
  }
});
