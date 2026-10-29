// 剪映导出的结构测试(不需要剪映,只验生成的草稿本身)。
//
// 这条链路真正会咬人的地方是**静默错位**:时间轴差几微秒导致段重叠、
// 字幕被压成一种字号、末段越界——前两个会抛异常,第三个曾经直接 ValueError。
// 所以测的是「导出跑得通 + 轨道结构对 + 时间轴不重叠」。
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';

const PY = 'tools/jianying/.venv/bin/python';
const hasVenv = existsSync(PY);

test('剪映导出:字幕工程生成的草稿结构正确', {skip: hasVenv ? false : '没装 venv(tools/jianying/.venv)'}, () => {
  const r = spawnSync(PY, ['tools/jianying/export.py', 'projects/2026-08-19-dsh-caption',
    '--no-install', '--name', 'test-export'], {encoding: 'utf8'});
  assert.equal(r.status, 0, `导出失败:\n${r.stderr}`);

  const p = 'tools/jianying/staging/test-export/draft_content.json';
  assert.ok(existsSync(p), '没生成 draft_content.json');
  const d = JSON.parse(readFileSync(p, 'utf8'));

  const text = d.tracks.filter((t) => t.type === 'text');
  const video = d.tracks.filter((t) => t.type === 'video');
  const audio = d.tracks.filter((t) => t.type === 'audio');
  assert.ok(video.length >= 1, '缺底片轨 —— 文本轨没有视频轨定义画布时时间轴是空的');
  assert.ok(audio.length >= 1, '缺音轨');
  // 按角色分轨:剪映一个文本段只能一种字号,不分轨字幕会全被压成一种大小
  assert.ok(text.length >= 4, `字幕轨只有 ${text.length} 条,角色没分开`);

  // 同轨段不许重叠 —— 这是 pyJianYingDraft 会直接拒绝的事,但重叠也可能因为
  // 微秒取整而只差 1µs 悄悄溜过去,所以自己再验一遍
  for (const track of d.tracks) {
    const segs = [...track.segments].sort((a, b) => a.target_timerange.start - b.target_timerange.start);
    for (let i = 1; i < segs.length; i++) {
      const prev = segs[i - 1].target_timerange;
      assert.ok(
        prev.start + prev.duration <= segs[i].target_timerange.start,
        `轨道 ${track.name ?? track.type} 第 ${i} 段与前一段重叠`,
      );
    }
  }
});
