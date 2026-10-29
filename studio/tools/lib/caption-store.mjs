// 「改字幕」的服务端:读、存、备份、量波形、对拍一帧、重新出片。
//
// 存在的理由很具体:一支 191 秒的口播字幕有 78 块 141 行,里面总会有几处转写错字、
// 一两处断句不合适、几处出现得早了半拍。这些都是**十秒钟就能判断、但要人来判断**的事,
// 走一轮"告诉 Codex → Codex 找 → Codex 改 → 重渲"的成本远大于问题本身。
// 所以这一层要让人自己改,而且改完立刻看得见。
//
// 边界和面板其他写入口一致:项目名只认单段目录名(不许带分隔符),
// 落盘前必须通过结构校验,每次保存先备份——**改字幕是高频操作,高频操作不该带不可逆副作用**。

import {execFile, spawn} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {basename, join} from 'node:path';
import {ROOT} from './panel-scan.mjs';
import {CAPTION_ENGINE, FULL_FONT_REL, captionSpec, lintScript} from './caption-spec.mjs';

const PROJECTS = join(ROOT, 'projects');
const SCRIPT_NAME = 'caption-script.json';
const HISTORY_KEEP = 40;

const run = (bin, args, opts = {}) =>
  new Promise((ok) =>
    execFile(bin, args, {maxBuffer: 64 * 1024 * 1024, ...opts}, (err, stdout, stderr) =>
      ok({err, stdout: String(stdout || ''), stderr: String(stderr || '')}),
    ),
  );

/** 项目名消毒:只认 projects/ 下的一段目录名。挡住 ../ 和绝对路径 */
function projectDir(name) {
  const n = String(name || '');
  if (!n || n.includes('/') || n.includes('\\') || n.includes('\0') || n.startsWith('.')) return null;
  const dir = join(PROJECTS, n);
  if (!existsSync(join(dir, SCRIPT_NAME))) return null;
  return dir;
}

// ─────────────────────────────── 列表 ───────────────────────────────

const statOf = (p) => {
  try {
    const st = statSync(p);
    return {bytes: st.size, mtime: st.mtimeMs};
  } catch {
    return null;
  }
};

/** 哪些项目有字幕脚本可以改 */
export function listCaptionProjects() {
  let names = [];
  try {
    names = readdirSync(PROJECTS).filter((d) => !d.startsWith('.') && existsSync(join(PROJECTS, d, SCRIPT_NAME)));
  } catch {}
  return names.sort().reverse().map((name) => {
    const dir = join(PROJECTS, name);
    let s = null;
    try {
      s = JSON.parse(readFileSync(join(dir, SCRIPT_NAME), 'utf8'));
    } catch {}
    const lines = s?.blocks?.reduce((a, b) => a + (b.lines?.length ?? 0), 0) ?? 0;
    const end = s?.blocks?.length ? Math.max(...s.blocks.map((b) => b.out)) : 0;
    return {
      name,
      blocks: s?.blocks?.length ?? 0,
      lines,
      end,
      source: s?._source ?? '',
      audio: findAudio(dir) ? true : false,
      outputs: OUTPUTS.map((o) => ({...o, stat: statOf(join(dir, o.file))})),
      scriptMtime: statOf(join(dir, SCRIPT_NAME))?.mtime ?? 0,
    };
  });
}

const OUTPUTS = [
  {file: 'out/preview-with-audio.mp4', label: '带音预览'},
  {file: 'out/caption-layer-hevc.mov', label: 'HEVC 带 alpha'},
  {file: 'out/caption-layer.mov', label: 'ProRes 4444'},
];

/** 找项目的口播音频。约定放在 audio/ 下,取第一个音频文件 */
function findAudio(dir) {
  const d = join(dir, 'audio');
  try {
    const f = readdirSync(d).find((x) => /\.(wav|mp3|m4a|aac|flac)$/i.test(x));
    return f ? join(d, f) : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────── 读 ───────────────────────────────

export async function loadCaption(name) {
  const dir = projectDir(name);
  if (!dir) return {error: `没找到项目或它没有 ${SCRIPT_NAME}:${name}`};
  const script = JSON.parse(readFileSync(join(dir, SCRIPT_NAME), 'utf8'));
  const spec = await captionSpec();
  const audio = findAudio(dir);
  const audioDuration = audio ? await probeDuration(audio) : null;
  return {
    name,
    script,
    spec,
    fullFont: '/' + FULL_FONT_REL,
    audioUrl: audio ? '/' + relFromRoot(audio) : null,
    audioDuration,
    lint: lintScript(spec, script, audioDuration),
    history: historyOf(name),
    outputs: OUTPUTS.map((o) => ({...o, url: '/' + relFromRoot(join(dir, o.file)), stat: statOf(join(dir, o.file))})),
  };
}

const relFromRoot = (abs) => abs.slice(ROOT.length + 1).split('\\').join('/');

async function probeDuration(file) {
  const r = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  const d = Number(String(r.stdout).trim());
  return Number.isFinite(d) ? d : null;
}

// ─────────────────────────────── 写 ───────────────────────────────

/**
 * 落盘前的结构校验。**这一关和 lint 不是一回事**:
 * lint 判断"这版字幕好不好"(超宽、断句),这里判断"这坨 JSON 能不能算字幕脚本"。
 * 前者可以带着警告存盘(改到一半很正常),后者不行——存进去就等于把文件毁了。
 */
function assertShape(s) {
  if (!s || typeof s !== 'object') throw new Error('不是对象');
  if (!Array.isArray(s.blocks) || !s.blocks.length) throw new Error('blocks 为空 —— 拒绝把空脚本写进去');
  s.blocks.forEach((b, i) => {
    if (typeof b.in !== 'number' || typeof b.out !== 'number') throw new Error(`块#${i + 1} 时间不是数字`);
    if (!Array.isArray(b.lines) || !b.lines.length) throw new Error(`块#${i + 1} 没有行`);
    b.lines.forEach((l, j) => {
      if (typeof l.in !== 'number') throw new Error(`块#${i + 1} 行${j + 1} 缺 in`);
      if (!Array.isArray(l.runs) || !l.runs.length) throw new Error(`块#${i + 1} 行${j + 1} 没有 runs`);
      l.runs.forEach((r) => {
        if (typeof r.t !== 'string') throw new Error(`块#${i + 1} 行${j + 1} 有一段不是字符串`);
      });
    });
  });
}

const histDir = (dir) => join(dir, '.caption-history');

export function historyOf(name) {
  const dir = projectDir(name);
  if (!dir) return [];
  try {
    return readdirSync(histDir(dir))
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, HISTORY_KEEP)
      .map((f) => ({stamp: f.replace(/\.json$/, ''), bytes: statSync(join(histDir(dir), f)).size}));
  } catch {
    return [];
  }
}

/** 数字统一保留两位小数:时间是拖出来的,不裁的话 JSON 里会出现 4.520000000000001 */
function tidy(s) {
  const r2 = (n) => Math.round(n * 100) / 100;
  for (const b of s.blocks) {
    b.in = r2(b.in);
    b.out = r2(b.out);
    for (const l of b.lines) {
      l.in = r2(l.in);
      if (l.center !== undefined) l.center = Math.round(l.center * 100) / 100;
      for (const r of l.runs) if (r.in !== undefined) r.in = r2(r.in);
    }
  }
  return s;
}

/** 一块一行地写,不用 JSON.stringify 的默认缩进 —— 那样 78 块会摊成两千行,git diff 没法看 */
function serialize(s) {
  const head = {};
  for (const k of Object.keys(s)) if (k !== 'blocks') head[k] = s[k];
  const lines = s.blocks.map((b) => {
    const rows = b.lines.map((l) => '    ' + JSON.stringify(l));
    const extra = b.ghost !== undefined ? `, "ghost": ${b.ghost}` : '';
    return `  {"in": ${b.in.toFixed(2)}, "out": ${b.out.toFixed(2)}${extra}, "lines": [\n${rows.join(',\n')}\n  ]}`;
  });
  const headJson = JSON.stringify(head, null, 2).replace(/^\{\n?/, '').replace(/\n?\}$/, '');
  return `{\n${headJson}${headJson.trim() ? ',' : ''}\n  "blocks": [\n${lines.join(',\n')}\n  ]\n}\n`;
}

export async function saveCaption(name, script) {
  const dir = projectDir(name);
  if (!dir) return {error: `没找到项目:${name}`};
  try {
    assertShape(script);
  } catch (e) {
    return {error: '结构不合法,没有写入:' + e.message};
  }
  const file = join(dir, SCRIPT_NAME);

  // 备份先于写入。备份失败就不写——宁可这次存不上,也不能存上又没退路
  mkdirSync(histDir(dir), {recursive: true});
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  writeFileSync(join(histDir(dir), `${stamp}.json`), readFileSync(file));
  const old = readdirSync(histDir(dir)).filter((f) => f.endsWith('.json')).sort();
  for (const f of old.slice(0, Math.max(0, old.length - HISTORY_KEEP))) rmSync(join(histDir(dir), f), {force: true});

  // 原地换名写入:中途断电也不会留下半个 JSON
  const tmp = file + '.tmp';
  writeFileSync(tmp, serialize(tidy(script)));
  renameSync(tmp, file);

  const spec = await captionSpec();
  const audio = findAudio(dir);
  return {ok: true, stamp, lint: lintScript(spec, script, audio ? await probeDuration(audio) : null)};
}

export function restoreCaption(name, stamp) {
  const dir = projectDir(name);
  if (!dir) return {error: `没找到项目:${name}`};
  const safe = String(stamp || '').replace(/[^0-9T-]/g, '');
  const src = join(histDir(dir), `${safe}.json`);
  if (!safe || !existsSync(src)) return {error: '没有这个版本:' + stamp};
  const script = JSON.parse(readFileSync(src, 'utf8'));
  return {ok: true, script};
}

// ─────────────────────────────── 波形 ───────────────────────────────

/**
 * 时间轴上没有波形的话,拖块头就只能靠反复试听——而"这句话什么时候开口"
 * 恰恰是波形一眼就能看出来的东西。50 个采样点/秒足够看清词的边界,191 秒也才 9550 个数。
 */
export async function waveform(name) {
  const dir = projectDir(name);
  if (!dir) return {error: `没找到项目:${name}`};
  const audio = findAudio(dir);
  if (!audio) return {error: '这个项目的 audio/ 里没有音频文件'};
  const cacheDir = join(dir, '.caption-cache');
  const cache = join(cacheDir, 'peaks.json');
  const mt = statSync(audio).mtimeMs;
  try {
    const c = JSON.parse(readFileSync(cache, 'utf8'));
    if (c.mtime === mt) return c;
  } catch {}

  const SR = 4000;
  const PER_SEC = 50;
  const r = await run('ffmpeg', ['-v', 'quiet', '-i', audio, '-ac', '1', '-ar', String(SR), '-f', 's16le', '-'], {
    encoding: 'buffer',
  });
  if (r.err) return {error: 'ffmpeg 抽波形失败:' + r.err.message};
  const buf = Buffer.isBuffer(r.stdout) ? r.stdout : Buffer.from(r.stdout, 'binary');
  const n = Math.floor(buf.length / 2);
  const step = SR / PER_SEC;
  const peaks = [];
  for (let i = 0; i < n; i += step) {
    let max = 0;
    for (let j = i; j < Math.min(i + step, n); j++) {
      const v = Math.abs(buf.readInt16LE(j * 2));
      if (v > max) max = v;
    }
    peaks.push(Math.round((max / 32768) * 100));
  }
  const out = {mtime: mt, perSec: PER_SEC, duration: n / SR, peaks};
  mkdirSync(cacheDir, {recursive: true});
  writeFileSync(cache, JSON.stringify(out));
  return out;
}

// ─────────────────────────── 对拍一帧 ───────────────────────────

/**
 * 控制台的预览是 CaptionLayer.tsx 的**浏览器孪生体**——同一套常数、同一个 Chromium,
 * 但终究是两份代码,会漂。这个按钮用真渲染器渲同一时刻的同一帧,让漂移当场现形。
 *
 * 用**完整字体**渲:子集里没有你刚打的新字,不换的话对拍图上会是方框,
 * 那不是漂移,是假警报。
 */
export async function compareFrame(name, script, t) {
  const dir = projectDir(name);
  if (!dir) return {error: `没找到项目:${name}`};
  try {
    assertShape(script);
  } catch (e) {
    return {error: '脚本结构不合法:' + e.message};
  }
  const cacheDir = join(dir, '.caption-cache');
  mkdirSync(cacheDir, {recursive: true});
  const props = join(cacheDir, 'compare-props.json');
  writeFileSync(props, JSON.stringify({...script, fontFile: 'fonts/NotoSerifSC-Bold.otf'}));
  const frame = Math.max(0, Math.round(Number(t) * 30));
  const out = join(cacheDir, 'compare.png');
  const r = await run(
    'npx',
    ['remotion', 'still', 'CaptionFromProps', `--props=${props}`, `--frame=${frame}`, '--scale=0.5', out],
    {cwd: CAPTION_ENGINE, timeout: 180000},
  );
  if (r.err || !existsSync(out)) return {error: '渲染失败:' + (r.stderr.split('\n').filter(Boolean).slice(-3).join(' / ') || r.err?.message)};
  return {ok: true, url: '/' + relFromRoot(out) + '?v=' + Date.now(), frame, t: frame / 30};
}

// ─────────────────────────── 重新出片 ───────────────────────────

/**
 * 一个任务槽,不排队。字幕出片是整台机器最吃 CPU 的活(几千帧 × 全画幅),
 * 同时跑两支只会两支都慢,不如挡住。
 */
let job = null;

export const captionJob = () =>
  job && {
    ...job,
    proc: undefined,
    log: job.log.slice(-40),
  };

export function cancelCaptionJob() {
  if (!job || job.done) return {ok: true};
  job.cancelled = true;
  // 连进程组一起杀:只 kill npx 壳的话 node 和 Chromium 会活下来继续烧 CPU
  try {
    if (job.proc?.pid) process.kill(-job.proc.pid, 'SIGKILL');
  } catch {}
  return {ok: true};
}

const step = (bin, args, cwd, label) => ({bin, args, cwd, label});
/** 纯 JS 的一步(改名、删文件这类)。跑外部命令的步骤和它走同一个进度/取消模型 */
const jstep = (label, fn) => ({fn, label});

/**
 * 完整出片管线。步骤顺序和 README 里手敲的那串命令一模一样,
 * 差别只是**子集化不再靠人记得跑**——加了新字忘了子集化,成片里就是一片方框,
 * 而且不报错。这是这条管线里最容易静默失败的一步,所以把它焊在第一位。
 */
export async function startCaptionRender(name) {
  if (job && !job.done) return {error: '已经有一支在出片了:' + job.project};
  const dir = projectDir(name);
  if (!dir) return {error: `没找到项目:${name}`};
  const script = JSON.parse(readFileSync(join(dir, SCRIPT_NAME), 'utf8'));
  const audio = findAudio(dir);
  const scriptPath = join(dir, SCRIPT_NAME);
  const outDir = join(dir, 'out');
  mkdirSync(outDir, {recursive: true});

  const fontName = basename(script.fontFile || `${name}.otf`).replace(/\.otf$/, '');
  const subsetDir = join(CAPTION_ENGINE, 'public/fonts/subset');
  const prores = join(outDir, 'caption-layer.mov');
  const stripped = join(outDir, '.strip.mov');
  const hevc = join(outDir, 'caption-layer-hevc.mov');
  const preview = join(outDir, 'preview-with-audio.mp4');
  const dur = script.durationSeconds || Math.max(...script.blocks.map((b) => b.out)) + 1.3;
  // 预览底片的尺寸跟着脚本的画幅走:横屏项目(canvas 1920×1080)套竖屏底片会把字幕压成一条
  const CW = script.canvas?.width ?? 1080, CH = script.canvas?.height ?? 1920;

  const steps = [
    step('node', [join(ROOT, 'tools/subset-caption-font.mjs'), scriptPath, '--out', subsetDir, '--name', fontName], ROOT, '子集化字体'),
    step(process.execPath, [join(ROOT,'tools/remotion-export-cached.mjs'),'--cwd',CAPTION_ENGINE,'--','remotion', 'render', 'CaptionFromProps', `--props=${scriptPath}`,
      '--codec=prores', '--prores-profile=4444', '--image-format=png', '--pixel-format=yuva444p10le',
      '--concurrency=5', prores], CAPTION_ENGINE, '渲 ProRes 4444(带 alpha,最慢的一步)'),
    // Remotion 会给带 alpha 的 ProRes 挂一条空 PCM 音轨(几十 MB)。**必须换回原文件**,
    // 只写到临时文件而不替换,交付的那一份就还带着它 —— 实测踩过一次:
    // 文件大了 37MB,剪映里那一层还多出一条静音轨。
    step('ffmpeg', ['-y', '-i', prores, '-map', '0:v:0', '-c:v', 'copy', '-an', stripped], ROOT, '去掉空音轨'),
    jstep('换回交付文件', () => renameSync(stripped, prores)),
    step('ffmpeg', ['-y', '-i', prores, '-c:v', 'hevc_videotoolbox', '-alpha_quality', '0.95', '-q:v', '65',
      '-tag:v', 'hvc1', '-pix_fmt', 'bgra', hevc], ROOT, '转 HEVC 小体积版'),
  ];
  if (audio) {
    steps.push(step('ffmpeg', ['-y', '-f', 'lavfi', '-i', `color=c=0x141414:s=${CW}x${CH}:r=30:d=${dur.toFixed(2)}`,
      '-i', prores, '-i', audio,
      '-filter_complex', '[0:v][1:v]overlay=format=auto[v]',
      '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-crf', '24', '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-shortest', preview], ROOT, '合成带音预览片'));
  }

  job = {
    id: String(Date.now()),
    project: name,
    steps: steps.map((s) => s.label),
    current: 0,
    log: [],
    done: false,
    error: null,
    cancelled: false,
    startedAt: Date.now(),
    proc: null,
  };

  (async () => {
    for (let i = 0; i < steps.length; i++) {
      if (job.cancelled) break;
      job.current = i;
      const s = steps[i];
      job.log.push(`▶ ${s.label}`);
      if (s.fn) {
        try {
          s.fn();
          job.log[job.log.length - 1] = `✓ ${s.label}`;
          continue;
        } catch (e) {
          job.error = `「${s.label}」失败:${e.message}`;
          job.log.push('✗ ' + job.error);
          break;
        }
      }
      const code = await new Promise((ok) => {
        // detached:true 才有进程组,取消时能连 Chromium 一起收掉
        const p = spawn(s.bin, s.args, {cwd: s.cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe']});
        job.proc = p;
        const feed = (buf) => {
          const line = String(buf).replace(/\r/g, '\n').split('\n').map((x) => x.trim()).filter(Boolean).pop();
          if (line) job.log[job.log.length - 1] = `▶ ${s.label} · ${line.slice(0, 120)}`;
        };
        p.stdout.on('data', feed);
        p.stderr.on('data', feed);
        p.on('close', (c) => ok(c));
        p.on('error', (e) => {
          job.log.push('✗ ' + e.message);
          ok(1);
        });
      });
      job.proc = null;
      if (job.cancelled) break;
      if (code !== 0) {
        job.error = `「${s.label}」失败(退出码 ${code})`;
        job.log.push('✗ ' + job.error);
        break;
      }
      job.log[job.log.length - 1] = `✓ ${s.label}`;
    }
    try {
      rmSync(stripped, {force: true});
    } catch {}
    if (job.cancelled) job.log.push('已取消');
    job.done = true;
    job.finishedAt = Date.now();
  })();

  return {ok: true, id: job.id, steps: job.steps};
}
