// 资产面板的**写入层**:上传、删除、起 Studio、渲皮肤预览。
//
// 面板从这一版起不再是只读画册,而是一个能改磁盘的本地控制台。
// 所以这个文件里每一个能写的入口都必须自己守住边界——浏览器传上来的路径**一律当敌意输入**,
// 哪怕它只在 localhost 上跑:一个手滑的 `../../..` 就能删掉 docs/ 或 templates/。
// 三道闸门:①白名单前缀 ②resolve 后必须仍在 ROOT 内 ③文件名不许含分隔符。

import {execFile, execFileSync, spawn} from 'node:child_process';
import {get as httpGet} from 'node:http';
import {createHash} from 'node:crypto';
import {copyFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {ROOT, TPL, duBytes, readJSON} from './panel-scan.mjs';

// ─────────────────────────────── 上传 ───────────────────────────────

/** 分类 → 落盘目录。**只有这张表里的分类允许写**,别处一律 400 */
export const UPLOAD_DIRS = {
  fonts: {dir: 'assets/inbox/fonts', label: '字体', accept: '.ttf,.otf,.woff2', after: '我登记进字体菜单,你在面板里挑中后接进字体套装'},
  sfx: {dir: 'assets/inbox/sfx', label: '音效', accept: '.wav,.mp3,.m4a,.aac', after: '我写中文说明、分类、入库'},
  images: {dir: 'assets/inbox/images', label: '图片 / 截图 / logo', accept: '.png,.jpg,.jpeg,.webp,.svg', after: '我登记版权来源,按需入库'},
  footage: {dir: 'assets/inbox/footage', label: '你拍的视频', accept: '.mp4,.mov,.m4v', after: '我转码规范化、写一句话说明、进 assets/library/footage/'},
  refs: {dir: 'assets/inbox/refs', label: '看到的好画面截图', accept: '.png,.jpg,.jpeg,.webp', after: '进审美参考帧库,做设计时当对标物'},
};

const MAX_UPLOAD = 512 * 1024 * 1024; // 单文件 512MB:够放一段手机视频,又不至于被误传的大文件塞满盘

/** 文件名消毒:去掉任何路径成分,只留最后一段,并挡住隐藏文件和空名 */
const safeName = (raw) => {
  const base = String(raw || '').split(/[/\\]/).pop().trim();
  if (!base || base.startsWith('.')) return null;
  if (base.length > 180) return null;
  return base;
};

export async function handleUpload(req, res) {
  const cat = req.headers['x-category'];
  const spec = UPLOAD_DIRS[cat];
  if (!spec) return json(res, 400, {error: `未知分类:${cat}`});
  const name = safeName(decodeURIComponent(req.headers['x-filename'] || ''));
  if (!name) return json(res, 400, {error: '文件名不合法'});

  const dir = join(ROOT, spec.dir);
  mkdirSync(dir, {recursive: true});
  // 同名不覆盖:加 -2 -3 后缀。覆盖是不可逆的,上传这种高频动作不该带不可逆副作用
  let target = join(dir, name);
  if (existsSync(target)) {
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let i = 2;
    while (existsSync(join(dir, `${stem}-${i}${ext}`))) i++;
    target = join(dir, `${stem}-${i}${ext}`);
  }

  let size = 0;
  const ws = createWriteStream(target);
  try {
    await new Promise((ok, bad) => {
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_UPLOAD) {
          ws.destroy();
          bad(new Error('文件超过 512MB'));
        }
      });
      req.on('error', bad);
      ws.on('error', bad);
      ws.on('finish', ok);
      req.pipe(ws);
    });
  } catch (e) {
    try {
      rmSync(target, {force: true});
    } catch {}
    return json(res, 400, {error: e.message});
  }
  return json(res, 200, {ok: true, saved: spec.dir + '/' + target.split(sep).pop(), bytes: size, after: spec.after});
}

/** inbox 里现在躺着什么(上传完立刻能看到,不用去 IDE 里找) */
export function inboxState() {
  const out = {};
  for (const [k, spec] of Object.entries(UPLOAD_DIRS)) {
    const dir = join(ROOT, spec.dir);
    let files = [];
    try {
      files = readdirSync(dir)
        .filter((f) => !f.startsWith('.'))
        .map((f) => ({name: f, bytes: statSync(join(dir, f)).size}));
    } catch {}
    out[k] = {...spec, files};
  }
  return out;
}

// ─────────────────────────────── 删除 ───────────────────────────────

/**
 * 允许删除的路径前缀白名单。**只列产物,不列源码。**
 * 少一条前缀最多是某个目录删不掉(用户去 Finder 删就行);多一条前缀可能删掉 docs/ 或 tools/。
 */
const DELETABLE = ['projects/', 'benchmarks/runs/', 'assets/previews', 'workspace/', '.trash-stale'];
/** 项目里也有不许删的:合同、分镜、交付说明是这个项目存在过的全部证据 */
const PROTECTED = [/^projects\/[^/]+\/(brief|storyboard|proposals|assets|review|DELIVERY)\.(md|json)$/, /^projects\/[^/]+\/visual-contract\.json$/];

export function checkDeletable(relPath) {
  const p = String(relPath || '').replace(/^\/+/, '');
  if (!p) return '空路径';
  if (p.includes('\0')) return '非法字符';
  if (!DELETABLE.some((d) => p.startsWith(d))) return `不在可删白名单内:${p}`;
  if (PROTECTED.some((re) => re.test(p))) return `受保护(项目档案):${p}`;
  const abs = resolve(ROOT, p);
  // resolve 之后必须仍在 ROOT 里 —— 这一条挡住所有 ../ 花招
  if (abs !== ROOT && !abs.startsWith(ROOT + sep)) return `越界:${p}`;
  if (abs === ROOT) return '不能删仓库根';
  return null;
}

export function doDelete(paths) {
  const done = [];
  const failed = [];
  let freed = 0;
  for (const p of paths) {
    const err = checkDeletable(p);
    if (err) {
      failed.push({path: p, error: err});
      continue;
    }
    const abs = resolve(ROOT, p);
    if (!existsSync(abs)) {
      failed.push({path: p, error: '已经不存在'});
      continue;
    }
    const before = duBytes(abs);
    try {
      rmSync(abs, {recursive: true, force: true});
      freed += before;
      done.push({path: p, bytes: before});
    } catch (e) {
      failed.push({path: p, error: e.message});
    }
  }
  return {done, failed, freed};
}

// ─────────────────────────── Remotion Studio ───────────────────────────

/**
 * Studio 是个长跑进程,同一时刻只留一个。
 * 换目标(从模板切到某个项目)= 先杀旧的再起新的,否则端口冲突而且你会对着错的工程调参。
 */
const studio = {child: null, target: null, port: 3333, startedAt: null};

/**
 * Studio 起来了没 —— **进程活着 ≠ 能用**。
 * 首次启动要 webpack 编译整个工程,实测 20 秒以上端口才开始应答。
 * 上一版按固定 9 秒就开新标签页,于是标签页打开时服务还没起来,
 * 用户看到连接失败、手动重进就落到了根路径(= 侧栏第一个合成)。
 * 所以状态里必须带一个**真探测过端口**的 ready,前端轮询它、就绪了才开页面。
 */
function probePort(port, timeoutMs = 900) {
  return new Promise((ok) => {
    const req = httpGet({host: '127.0.0.1', port, path: '/', timeout: timeoutMs}, (res) => {
      res.resume();
      ok(true);
    });
    req.on('error', () => ok(false));
    req.on('timeout', () => {
      req.destroy();
      ok(false);
    });
  });
}

export async function studioStatus() {
  const running = Boolean(studio.child && !studio.child.killed);
  return {
    running,
    ready: running ? await probePort(studio.port) : false,
    target: studio.target,
    url: running ? `http://localhost:${studio.port}` : null,
    startedAt: studio.startedAt,
  };
}

export async function studioStart(target) {
  // target: 'template' 或 'projects/<id>'
  const cwd = target === 'template' ? TPL : join(ROOT, target, 'build');
  if (!existsSync(join(cwd, 'package.json'))) return {error: `${target} 下没有可用的 Remotion 工程`};
  // 已经在跑同一个目标就直接复用 —— 每点一次就杀了重启,等于每次都罚你再等一轮编译,
  // 而深链本来就是"我想快点看到那个模板"的动作
  if (studio.child && !studio.child.killed && studio.target === target) return studioStatus();
  studioStop();
  const child = spawn('npx', ['remotion', 'studio', '--port', String(studio.port)], {
    cwd,
    stdio: 'ignore',
    detached: false,
  });
  studio.child = child;
  studio.target = target;
  studio.startedAt = Date.now();
  child.on('exit', () => {
    if (studio.child === child) {
      studio.child = null;
      studio.target = null;
    }
  });
  return studioStatus();
}

export function studioStop() {
  if (studio.child && !studio.child.killed) {
    try {
      studio.child.kill('SIGTERM');
    } catch {}
  }
  studio.child = null;
  studio.target = null;
  return {running: false};
}

// ─────────────────────────── 皮肤实时调参 ───────────────────────────

const PREVIEW_DIR = join(ROOT, 'assets/previews/skin');

/**
 * 渲一张皮肤预览。走 StyleBible 的第 page 页(每页 30 帧,取第 15 帧的定格)。
 * --scale=0.5 是有意的:面板上就显示这么大,全分辨率只是让你多等三秒。
 */
export function renderSkinPreview({skin = 'abyss', accentHue, neutralHue, page = 1}) {
  mkdirSync(PREVIEW_DIR, {recursive: true});
  const props = {skin};
  if (accentHue !== undefined) props.accentHue = Number(accentHue);
  if (neutralHue !== undefined) props.neutralHue = Number(neutralHue);
  const stamp = `${skin}-${props.accentHue ?? 'x'}-${props.neutralHue ?? 'x'}-${page}`;
  const out = join(PREVIEW_DIR, `${stamp}.png`);
  const url = `previews/skin/${stamp}.png`;
  if (existsSync(out)) return Promise.resolve({url, cached: true});
  const frame = Number(page) * 30 + 15;
  return new Promise((ok) => {
    execFile(
      'npx',
      ['remotion', 'still', 'StyleBible', `--frame=${frame}`, `--props=${JSON.stringify(props)}`, '--scale=0.5', out],
      {cwd: TPL, timeout: 180000},
      (err) => (err ? ok({error: String(err.message || err).slice(0, 400)}) : ok({url, cached: false})),
    );
  });
}

/**
 * 存一组调好的皮肤参数。**不直接改 baseline.tsx** —— 那是代码,程序化改写很容易改坏,
 * 而且皮肤升版本要连带重渲全套样张、写 changelog、通知下游,那是主 agent 的活。
 * 这里只把参数记进 baseline.json 的 pendingTune,面板告诉你"跟我说一声就固化"。
 */
export function saveSkinProposal(tune) {
  const p = join(ROOT, 'docs/presets/baseline.json');
  const j = readJSON(p, {});
  j.pendingTune = {
    ...tune,
    proposedAt: new Date().toISOString().slice(0, 10),
    note: '用户在资产面板里调的,尚未固化。固化时:改 baseline.tsx 的 SKINS、升 baselineVersion、重渲 StyleBible 样张、写 changelog。',
  };
  writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  return {ok: true, saved: 'docs/presets/baseline.json → pendingTune'};
}


// ─────────────────────────── 「做片子」:预览 + 导出 ───────────────────────────

/**
 * 导出成片落**用户的下载文件夹**,不落仓库。
 *
 * 这里曾经是 assets/quick-exports/ —— 那等于把用户的交付物混进系统的资产库:
 * 它会跟着「成片库」「存储清理」一起被扫、被算体积、被列进可删清单,
 * 可它根本不是这套系统的素材,而是用户要拿走的东西。搬到 ~/Downloads 之后
 * 归属就清楚了 —— 文件是用户的,控制台只负责生成和「在访达中显示」。
 *
 * 代价是它不在 ROOT 里,静态服务托不了(那道 `p.startsWith(ROOT)` 是越界防线,
 * 不能为了播一支导出片给它开口子)。所以导出后给的是 Finder 入口,不是播放器。
 */
const EXPORT_DIR = join(homedir(), 'Downloads');
const PREVIEW_DIR2 = join(ROOT, 'assets/previews/make');
let previewTempSeq = 0;

// Remotion creates the output before it has finished writing the MP4. Publishing that path
// directly lets a second request (or the browser) mistake a partial file for a cache hit.
const previewTempPath = (out) => `${out}.render-${process.pid}-${++previewTempSeq}${out.endsWith('.mp4') ? '.mp4' : '.png'}`;

/** props 里只允许出现这些顶层键 —— 浏览器传上来的东西会原样喂给 remotion render */
// canvas/preview 是 2026-08-31 lindsey 批 preset 加的:canvas 横竖两档("WxH",
// Root.calculateMetadata 解析),preview 让透明底 preset 在预览通道垫演播室底
const ALLOWED_PROP_KEYS = new Set(['durationSeconds', 'slots', 'variant', 'tune', 'brand', 'sfx', 'canvas', 'preview']);

/**
 * 校验并规整前端传来的 props。
 *
 * 这一步不是形式主义:props 会被 JSON.stringify 后塞进命令行喂给 remotion,
 * 里面多一个来路不明的键,轻则 zod 校验失败渲染报错,重则把不该暴露的参数带进渲染进程。
 * 所以**白名单进、类型收窄**,而不是原样透传。
 */
function sanitizeProps(raw) {
  const out = {};
  for (const k of Object.keys(raw || {})) {
    if (!ALLOWED_PROP_KEYS.has(k)) continue;
    out[k] = raw[k];
  }
  if (typeof out.durationSeconds !== 'number' || !(out.durationSeconds > 0)) out.durationSeconds = 3;
  // 时长钳到 preset 的合法区间由 zod 兜底,这里只挡住明显离谱的值(比如渲一小时)
  out.durationSeconds = Math.min(20, Math.max(1, out.durationSeconds));
  if (out.brand && !out.brand.file) delete out.brand;
  if (out.sfx && !out.sfx.file) delete out.sfx;
  if (out.canvas !== undefined && !/^\d{2,4}x\d{2,4}$/.test(String(out.canvas))) delete out.canvas;
  if (out.preview !== undefined) out.preview = Boolean(out.preview);
  // 空字符串的可选槽位要删掉,不能传空串 —— 组件里 `slots.en ? ... : null` 判的是真假,
  // 空串会走进"有值"分支渲出一个空元素,画面上留一块莫名其妙的空隙
  if (out.slots && typeof out.slots === 'object') {
    for (const [k, v] of Object.entries(out.slots)) {
      // 数组槽(list):滤掉空行,整个空了就当没填
      if (Array.isArray(v)) {
        const items = v.filter((x) => typeof x === 'string' && x.trim() !== '');
        if (items.length === 0) delete out.slots[k];
        else out.slots[k] = items;
        continue;
      }
      if (v === '' || v === null || v === undefined) delete out.slots[k];
    }
  }
  return out;
}

/** 文件名安全化:用户可能把标题直接当文件名 */
const slugName = (s) =>
  String(s || 'shot')
    .replace(/[\n\r]/g, ' ')
    .replace(/[/\\:*?"<>|]/g, '')
    .trim()
    .slice(0, 40) || 'shot';

/**
 * ============ 可中断的渲染 ============
 *
 * 面板改成"改一下就自动预览"之后,**中断能力从可有可无变成必需**:
 * 你在卡片群收束上敲了两个字又切到截图推近,旧那次渲染如果还在跑,
 * 就是一个占满一核 CPU、还要开一个 Chromium 的僵尸活儿 —— 切五次模板就是五个。
 *
 * 两道回收:
 * 1. **同一条 lane 的新请求顶掉旧的** —— 预览只有一条 lane,后来的永远赢;
 * 2. **浏览器断开连接就杀** —— 你关标签页/切走时 fetch 被 abort,服务端 req 触发 'close',
 *    顺手把那次渲染也带走。
 *
 * 必须用 `detached: true` + `kill(-pid)` 杀**进程组**:npx 只是个壳,
 * 真正吃 CPU 的是它拉起的 node 和 Chromium。只 kill npx 的话孙子进程会活下来继续渲,
 * 表面上"停了",风扇照样转 —— 这是这类实现最常见的假修复。
 */
const lanes = new Map();

const killLane = (lane) => {
  const job = lanes.get(lane);
  if (!job) return;
  lanes.delete(lane);
  try {
    // 负号 = 杀整个进程组(npx → node → chromium),不是只杀壳
    process.kill(-job.child.pid, 'SIGKILL');
  } catch {
    try {
      job.child.kill('SIGKILL');
    } catch {
      /* 已经退了 */
    }
  }
  job.settle({cancelled: true});
};

/**
 * 无 lane 的渲染(导出成片用:它不该被下一次预览顶掉)。
 *
 * **这里也必须 detached + kill(-pid)**,和 lane 版同一个理由:超时时 execFile 只杀 npx 壳,
 * 它拉起的 node 和 chrome-headless-shell 会被 launchd 收养(ppid=1)继续占内存。
 * 2026-08-28 那次「控制台模板全渲不出来」就是这么攒出 85 个孤儿把 swap 吃光的 ——
 * 表面是渲染 bug,实际是上几次会话的尸体没埋,见 reapOrphanChrome 头注。
 */
const runRemotion = (args, cwd = TPL, timeout = 300000) =>
  new Promise((ok) => {
    const render=args[0]==='remotion'&&args[1]==='render';
    const child = spawn(render?process.execPath:'npx', render?[join(ROOT,'tools/remotion-export-cached.mjs'),'--cwd',cwd,'--',...args]:args, {cwd, stdio: ['ignore', 'ignore', 'pipe'], detached: true});
    let err = '';
    child.stderr?.on('data', (d) => {
      err += d;
      if (err.length > 4000) err = err.slice(-4000);
    });
    let done = false;
    const settle = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ok(v);
    };
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL'); // 负号 = 整个进程组,只杀壳等于没杀
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          /* 已经退了 */
        }
      }
      settle({error: `渲染超时(${Math.round(timeout / 1000)} 秒),已连进程组一起杀掉`});
    }, timeout);
    child.on('error', (e) => settle({error: String(e.message || e)}));
    child.on('exit', (code) => settle(code === 0 ? {ok: true} : {error: err.slice(-600) || `退出码 ${code}`}));
  });

/**
 * ============ 孤儿 Chrome 回收 ============
 *
 * 2026-08-28 的现场:控制台里每个模板都渲不出来,一直转圈。看着像模板代码坏了,
 * 实际上 `npx remotion still` 直接跑也失败 —— `Timed out after 25000 ms while trying to
 * connect to the browser`,而且 Chrome 自己一行日志都没有。真因在机器层:
 * **85 个 chrome-headless-shell 从 8/19 一路堆到 8/28 没退**,swap 25.6GB 用掉 23.9GB,
 * 整台机器泡在换页里,Chrome 25 秒内起不来。清掉之后同一条命令 4 分 21 秒失败 → 21 秒成功。
 *
 * 来源不止面板:任何一次 Ctrl+C 掉 build-catalog-thumbs / build-asset-previews /
 * render-queue / npx remotion,npx 壳先死,它拉起的 chrome-headless-shell 被 launchd
 * 收养继续占内存。单个 8–65MB,没人收就是一天堆几个,**症状要到一周后才出现,
 * 而且伪装成渲染 bug** —— 所以必须在启动时无条件收一次,不能指望谁记得手动清。
 *
 * 判据:**ppid === 1 即孤儿**。活着的渲染,它的 chrome 主进程父亲一定是活着的 node。
 * 只认本仓库 templates 下那个 .remotion 里的二进制,**不碰用户自己开的 Chrome 浏览器**。
 */
export function reapOrphanChrome() {
  const bin = join(TPL, 'node_modules/.remotion/chrome-headless-shell');
  let rows = '';
  try {
    rows = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    return {killed: 0};
  }

  const procs = [];
  for (const line of rows.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    if (!m || !m[3].includes(bin)) continue;
    procs.push({pid: Number(m[1]), ppid: Number(m[2])});
  }
  if (!procs.length) return {killed: 0};

  // 孤儿的树根 = ppid 为 1 的那些;它们的 gpu/renderer 子进程 ppid 指向树根,一并收走
  const doomed = new Set(procs.filter((p) => p.ppid === 1).map((p) => p.pid));
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of procs) {
      if (!doomed.has(p.pid) && doomed.has(p.ppid)) {
        doomed.add(p.pid);
        grew = true;
      }
    }
  }

  let killed = 0;
  for (const pid of doomed) {
    try {
      process.kill(pid, 'SIGKILL');
      killed++;
    } catch {
      /* 自己已经退了 */
    }
  }
  return {killed};
}

/** 带 lane 的渲染:同 lane 的新请求会先把旧的连进程组一起杀掉 */
const runRemotionInLane = (lane, args, cwd = TPL) =>
  new Promise((ok) => {
    killLane(lane);
    const child = spawn('npx', args, {cwd, stdio: ['ignore', 'ignore', 'pipe'], detached: true});
    let err = '';
    child.stderr?.on('data', (d) => {
      err += d;
      if (err.length > 4000) err = err.slice(-4000);
    });
    let done = false;
    const settle = (v) => {
      if (done) return;
      done = true;
      ok(v);
    };
    lanes.set(lane, {child, settle});
    child.on('error', (e) => {
      lanes.delete(lane);
      settle({error: String(e.message || e)});
    });
    child.on('exit', (code, sig) => {
      if (lanes.get(lane)?.child === child) lanes.delete(lane);
      if (sig === 'SIGKILL') return settle({cancelled: true});
      settle(code === 0 ? {ok: true} : {error: err.slice(-600) || `退出码 ${code}`});
    });
  });

/** 供路由层用:浏览器断开时把这条 lane 的活儿一起收掉 */
export const cancelLane = (lane) => killLane(lane);

/**
 * 模板源码指纹(src/ 下最新 mtime)。**必须进预览缓存键**:2026-08-19 改了 AnnotationMark
 * 的笔迹曲线后,用户在面板里看到的还是旧波浪线——参数没变,哈希命中了改代码之前渲的图,
 * 而且"重新渲染"按钮之外没有任何东西会戳穿它。指纹一变,旧缓存自然失效。
 */
let tplFp = {t: 0, v: ''};
function tplFingerprint() {
  if (Date.now() - tplFp.t < 2000) return tplFp.v;
  let latest = 0;
  const walk = (d) => {
    for (const f of readdirSync(d, {withFileTypes: true})) {
      if (f.name === 'node_modules' || f.name.startsWith('.')) continue;
      const p = join(d, f.name);
      if (f.isDirectory()) walk(p);
      else {
        const m = statSync(p).mtimeMs;
        if (m > latest) latest = m;
      }
    }
  };
  try {
    walk(join(TPL, 'src'));
  } catch {}
  tplFp = {t: Date.now(), v: String(latest)};
  return tplFp.v;
}

/** 预览一帧。frame 默认取时长的 60%——入场都走完、退场还没开始的那一段 */
export async function makePreview({compositionId, props, frame}) {
  mkdirSync(PREVIEW_DIR2, {recursive: true});
  const p = sanitizeProps(props);
  const fps = 30;
  const f = frame ?? Math.round(p.durationSeconds * fps * 0.6);
  // 文件名带内容哈希:同样的参数不重渲,改一个字就换一张新图(浏览器也不会吃到旧缓存)。
  // 哈希里还有模板源码指纹——改了组件/preset 代码,同参数也要重渲,见 tplFingerprint 头注
  const h = createHash('md5').update(compositionId + JSON.stringify(p) + f + tplFingerprint()).digest('hex').slice(0, 12);
  const out = join(PREVIEW_DIR2, `${h}.png`);
  const url = `previews/make/${h}.png`;
  if (existsSync(out)) return {url, cached: true};
  const temp = previewTempPath(out);
  const r = await runRemotionInLane('preview', [
    'remotion',
    'still',
    compositionId,
    `--frame=${f}`,
    '--scale=0.4',
    `--props=${JSON.stringify(p)}`,
    temp,
  ]);
  if (r.cancelled || r.error) {
    rmSync(temp, {force: true});
    return r.cancelled ? {cancelled: true} : r;
  }
  renameSync(temp, out);
  return {url, cached: false};
}

/**
 * 预览**动效**(不是一帧)。
 *
 * 为什么必须能看动的:模板的价值一半在版式、一半在时序。只给一张静帧,
 * 用户没法判断"入场是不是太生硬""末段静止够不够长"——而这恰恰是他要确认的东西。
 * 3 秒的片子在 --scale=0.5 下约 2–3 秒渲完,完全够做交互反馈。
 */
export async function makePreviewVideo({compositionId, props}) {
  mkdirSync(PREVIEW_DIR2, {recursive: true});
  const p = sanitizeProps(props);
  const h = createHash('md5').update('v:' + compositionId + JSON.stringify(p) + tplFingerprint()).digest('hex').slice(0, 12);
  const out = join(PREVIEW_DIR2, `${h}.mp4`);
  const url = `previews/make/${h}.mp4`;
  if (existsSync(out)) return {url, cached: true};
  const temp = previewTempPath(out);
  const r = await runRemotionInLane('preview-video', [
    'remotion',
    'render',
    compositionId,
    `--props=${JSON.stringify(p)}`,
    // 半分辨率:面板上就显示这么大,全分辨率只是让你多等一倍时间
    '--scale=0.5',
    '--color-space=bt709',
    temp,
  ]);
  if (r.cancelled || r.error) {
    rmSync(temp, {force: true});
    return r.cancelled ? {cancelled: true} : r;
  }
  renameSync(temp, out);
  return {url, cached: false};
}

/** 导出成片。产物落用户的 ~/Downloads,不进仓库 */
export async function makeExport({compositionId, props, name, alpha}) {
  mkdirSync(EXPORT_DIR, {recursive: true});
  const p = sanitizeProps(props);
  // 导出必须**显式** preview:false——Remotion 把 inputProps 和 defaultProps 浅合并,
  // 透明 preset 的 defaultProps 带 preview:true(样例循环片要垫底),只 delete 的话
  // 那个 true 会合并回来,深灰垫底混进交付、整层变实心(2026-08-31 实测:品红 0%)
  p.preview = false;
  const stem = slugName(name);
  if (alpha) return exportAlpha({compositionId, props: p, stem});
  let out = join(EXPORT_DIR, `${stem}.mp4`);
  let i = 2;
  // 不覆盖:导出是"我要留着这个"的动作,同名直接盖掉等于默默弄丢上一版。
  // 下载文件夹里本来就有别人的东西,撞名的概率比在专用目录里高得多,这条更要紧
  while (existsSync(out)) out = join(EXPORT_DIR, `${stem}-${i++}.mp4`);
  const r = await runRemotion([
    'remotion',
    'render',
    compositionId,
    `--props=${JSON.stringify(p)}`,
    // 和生产队列同一套:bt709 出限范围 yuv420p,拼接时免转码
    '--color-space=bt709',
    out,
  ]);
  if (r.error) return r;
  const st = statSync(out);
  return {ok: true, name: out.split(sep).pop(), dir: EXPORT_DIR, bytes: st.size};
}

/**
 * 双通道导出:透明底 preset(pill-stack / word-cascade 的 transparent 档)出带 alpha 的
 * HEVC .mov,拖进剪映直接叠在实拍上。链路与 tools/caption-finalize.mjs 同一套:
 * ProRes4444(yuva444p10le)只作中间物 → hevc_videotoolbox 带 alpha → 删中间物。
 * 验 alpha 也照抄那边的品红底法:HEVC 带 alpha 时 ffprobe 会报 yuv420p,看不出来,
 * 叠品红底数颜色才作数。
 */
async function exportAlpha({compositionId, props, stem}) {
  let out = join(EXPORT_DIR, `${stem}.mov`);
  let i = 2;
  while (existsSync(out)) out = join(EXPORT_DIR, `${stem}-${i++}.mov`);
  const master = out.replace(/\.mov$/, '.master.mov');
  const r = await runRemotion([
    'remotion', 'render', compositionId,
    `--props=${JSON.stringify(props)}`,
    '--codec=prores', '--prores-profile=4444', '--image-format=png', '--pixel-format=yuva444p10le',
    master,
  ]);
  if (r.error) return r;
  try {
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', master, '-map', '0:v:0', '-an',
      '-c:v', 'hevc_videotoolbox', '-alpha_quality', '0.95', '-q:v', '65',
      '-tag:v', 'hvc1', '-pix_fmt', 'bgra', out], {maxBuffer: 1 << 28});
    // 品红底验 alpha:把层叠到品红底上抽一帧原始像素,数品红占比。
    // 透明层大部分面积应该透出品红;占比 <30% 说明层是实心的,alpha 没写进去
    const raw = execFileSync('ffmpeg', ['-v', 'error',
      '-f', 'lavfi', '-i', 'color=c=magenta:s=64x64:d=1:r=30',
      '-ss', '0.5', '-i', out,
      '-filter_complex', '[1:v]scale=64:64[a];[0:v][a]overlay=format=auto,format=rgb24',
      '-frames:v', '1', '-f', 'rawvideo', '-'], {maxBuffer: 1 << 22});
    let magenta = 0;
    for (let o = 0; o + 2 < raw.length; o += 3) {
      if (raw[o] > 180 && raw[o + 1] < 90 && raw[o + 2] > 180) magenta += 1;
    }
    const pct = (magenta / (raw.length / 3)) * 100;
    if (pct < 30) {
      rmSync(master, {force: true});
      rmSync(out, {force: true});
      return {error: `alpha 校验失败:品红透出仅 ${pct.toFixed(0)}%,这层是实心的,别交付`};
    }
  } catch (e) {
    rmSync(master, {force: true});
    return {error: '转 HEVC alpha 失败:' + String(e.message || e).slice(0, 200)};
  }
  rmSync(master, {force: true});
  const st = statSync(out);
  return {ok: true, name: out.split(sep).pop(), dir: EXPORT_DIR, bytes: st.size, alpha: true};
}

/**
 * 在访达里选中一支导出的成片。
 *
 * 页面是 http:// 的,`file://` 链接会被浏览器直接拦掉,所以"打开文件夹"这件事
 * 必须由服务端代劳。**只收文件名、不收路径** —— 名字里出现任何分隔符即拒,
 * 拼出来的绝对路径还要再确认仍在 EXPORT_DIR 内。这和上传/删除是同一套标准:
 * 浏览器传上来的一律当敌意输入,哪怕它只在 localhost 上跑。
 */
export function revealExport(name) {
  const base = safeName(name);
  if (!base) return {error: '文件名不合法'};
  const abs = join(EXPORT_DIR, base);
  if (!abs.startsWith(EXPORT_DIR + sep)) return {error: `越界:${base}`};
  if (!existsSync(abs)) return {error: '文件已经不在下载文件夹里了'};
  try {
    execFileSync('open', ['-R', abs]);
    return {ok: true, path: abs};
  } catch (e) {
    return {error: String(e.message || e).slice(0, 200)};
  }
}

/**
 * 把收件箱里的图片装成品牌标记。
 * 渲染进程只能读 `public/` 下的东西(staticFile),所以必须**拷贝**过去而不是引用原处。
 */
export function installBrand(fileName) {
  const name = String(fileName || '').split(/[/\\]/).pop();
  if (!name || !/\.(png|jpg|jpeg|webp|svg)$/i.test(name)) return {error: '只支持 png / jpg / webp / svg'};
  const src = join(ROOT, 'assets/inbox/images', name);
  if (!existsSync(src)) return {error: '收件箱里没有这个文件:' + name};
  const dir = join(TPL, 'public/brand');
  mkdirSync(dir, {recursive: true});
  copyFileSync(src, join(dir, name));
  return {ok: true, file: name};
}

/**
 * 把收件箱里的图片装成截图素材(public/screens/),并探测真实像素尺寸一起返回。
 * 尺寸必须由服务端探,不能让用户手输:KenBurns 拿它做焦点映射,填错只在推镜末帧才看出来。
 */
export function installScreen(fileName) {
  const name = String(fileName || '').split(/[/\\]/).pop();
  if (!name || !/\.(png|jpg|jpeg|webp)$/i.test(name)) return {error: '只支持 png / jpg / webp'};
  const src = join(ROOT, 'assets/inbox/images', name);
  if (!existsSync(src)) return {error: '收件箱里没有这个文件:' + name};
  const dir = join(TPL, 'public/screens');
  mkdirSync(dir, {recursive: true});
  copyFileSync(src, join(dir, name));
  let w = 0;
  let h = 0;
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', join(dir, name)], {encoding: 'utf8'});
    const [a, b] = out.trim().split(',').map(Number);
    w = a || 0;
    h = b || 0;
  } catch {
    /* 探不到就返回 0,前端会提示手填 */
  }
  return {ok: true, file: name, w, h};
}

/**
 * 把收件箱里的视频装成嵌入素材(public/footage/),并探测尺寸+时长一起返回。
 * aspect-embed 的 video 槽只认这里的文件;srcW/srcH/srcDur 由这三个探测值自动填——
 * 让人手输素材时长是必错的坑(错了 Loop 会循环出跳帧或渲到末尾定格)。
 */
export function installFootage(fileName) {
  const name = String(fileName || '').split(/[/\\]/).pop();
  if (!name || !/\.(mp4|mov|m4v)$/i.test(name)) return {error: '只支持 mp4 / mov / m4v'};
  // 收件箱优先,素材库兜底:两处都是上传流程的合法落点
  const src = [join(ROOT, 'assets/inbox/footage', name), join(ROOT, 'assets/library/footage', name)]
    .find((p) => existsSync(p));
  if (!src) return {error: '收件箱里没有这个文件:' + name};
  const dir = join(TPL, 'public/footage');
  mkdirSync(dir, {recursive: true});
  copyFileSync(src, join(dir, name));
  let w = 0;
  let h = 0;
  let dur = 0;
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height:format=duration', '-of', 'json', join(dir, name)], {encoding: 'utf8'});
    const info = JSON.parse(out);
    w = info.streams?.[0]?.width || 0;
    h = info.streams?.[0]?.height || 0;
    dur = Number(info.format?.duration) || 0;
  } catch {
    /* 探不到就返回 0,前端会提示手填 */
  }
  return {ok: true, file: name, w, h, dur: Math.round(dur * 100) / 100};
}

/** 把库里的音效拷进 public/sfx —— 同理,渲染进程只看得见 public/ */
export function installSfx(fileName) {
  const name = String(fileName || '').split(/[/\\]/).pop();
  if (!name || !/\.(wav|mp3|m4a)$/i.test(name)) return {error: '只支持 wav / mp3 / m4a'};
  const src = join(ROOT, 'assets/library/sfx', name);
  if (!existsSync(src)) return {error: '音效库里没有:' + name};
  const dir = join(TPL, 'public/sfx');
  mkdirSync(dir, {recursive: true});
  if (!existsSync(join(dir, name))) copyFileSync(src, join(dir, name));
  return {ok: true, file: name};
}


// ─────────────────────────── 资产就地删除 ───────────────────────────

/**
 * 各资产区自己的删除入口。
 *
 * **和「存储清理」不是一回事,别混。** 存储清理管的是"腾磁盘"——18.9GB 里几乎全是
 * 评测产物、node_modules 克隆、渲帧中间物,一样资产都不是(真资产统共 176MB)。
 * 这里管的是"管理我的资产":一款字体你不喜欢、一条音效用不上,就地删掉。
 * 目的不同,所以是两套入口、两套语义。
 *
 * 安全上不复用那套路径白名单,而是**只认类别 + 文件名**:浏览器传不进路径,
 * 目录由服务端从这张表里查,天然没有穿越的余地。
 */
const ASSET_KINDS = {
  font: {dir: 'assets/library/fonts', ext: /\.(ttf|otf|woff2)$/i, label: '字体'},
  sfx: {dir: 'assets/library/sfx', ext: /\.(wav|mp3|m4a)$/i, label: '音效'},
  lottie: {dir: 'templates/remotion-base/public/lottie', ext: /\.json$/i, label: 'Lottie'},
  brand: {dir: 'templates/remotion-base/public/brand', ext: /\.(png|jpg|jpeg|webp|svg)$/i, label: '品牌标记'},
  screen: {dir: 'templates/remotion-base/public/screens', ext: /\.(png|jpg|jpeg|webp)$/i, label: '截图素材'},
  hdri: {dir: 'assets/library/hdri', ext: /\.hdr$/i, label: 'HDRI'},
  footage: {dir: 'assets/library/footage', ext: /\.(mp4|mov|m4v)$/i, label: '个人视频'},
};

export function deleteAsset(kind, fileName) {
  const spec = ASSET_KINDS[kind];
  if (!spec) return {error: `未知资产类别:${kind}`};
  const name = String(fileName || '').split(/[/\\]/).pop();
  if (!name || name.startsWith('.') || !spec.ext.test(name)) return {error: `文件名不合法:${name}`};
  const abs = join(ROOT, spec.dir, name);
  if (!existsSync(abs)) return {error: '已经不存在'};
  const bytes = statSync(abs).size;
  rmSync(abs, {force: true});
  return {ok: true, kind, file: name, bytes, label: spec.label};
}

/** 参考帧在二级目录里(docs/reference/<组>/<文件>),单独一个入口 */
export function deleteReference(group, fileName) {
  const g = String(group || '').split(/[/\\]/).pop();
  const name = String(fileName || '').split(/[/\\]/).pop();
  if (!g || !name || !/\.(png|jpg|jpeg|webp)$/i.test(name)) return {error: '参数不合法'};
  const abs = join(ROOT, 'docs/reference', g, name);
  if (!existsSync(abs)) return {error: '已经不存在'};
  const bytes = statSync(abs).size;
  rmSync(abs, {force: true});
  return {ok: true, file: name, bytes, label: '参考帧'};
}

// ─────────────────────────────── 视频封面帧 ───────────────────────────────
//
// 成片墙以前是一排 `<video preload="none">` —— 浏览器不下载任何数据,于是每张卡都是
// 一个纯灰方块,你得逐个点开才知道哪支是哪支。48 支片子长得一模一样,等于没有索引。
//
// 现在抽一帧当封面。**抽的不是第 0 帧**:动画片子第一帧几乎必然是黑场或空场
// (入场动画还没开始),抽出来还是一块黑。取 40% 时刻 —— 这和 preset 印张用
// `--frame 0.4` 的理由是同一个:那时候入场结束、退场没开始,画面最"像它自己"。
//
// 缓存键带 mtime:重渲同名成片会自动换封面,不用手动清缓存。

const POSTER_DIR = join(ROOT, 'assets/.posters');
/** 同时最多 3 个 ffmpeg。一屏几十张卡会同时来要封面,不设闸会瞬间开几十个进程 */
const POSTER_LIMIT = 3;
let posterRunning = 0;
const posterQueue = [];
const posterInflight = new Map(); // 缓存键 → Promise,同一支片子的并发请求合并成一次抽帧

const posterSlot = () =>
  new Promise((ok) => {
    if (posterRunning < POSTER_LIMIT) { posterRunning++; return ok(); }
    posterQueue.push(ok);
  });
const posterRelease = () => {
  const next = posterQueue.shift();
  if (next) next();
  else posterRunning--;
};

const run = (bin, args) =>
  new Promise((ok, bad) =>
    execFile(bin, args, {timeout: 20000}, (e, stdout) => (e ? bad(e) : ok(String(stdout || '')))),
  );

/**
 * 取(必要时先生成)一支视频的封面 JPEG,返回绝对路径。
 * relPath 是仓库相对路径,只认成片会出现的两个位置 —— 这个接口会 spawn ffmpeg,
 * 路径白名单和上传/删除是同一套标准,不因为"只是读"就放松。
 */
export async function videoPoster(relPath) {
  const p = String(relPath || '');
  if (!/^projects\/[^/]+\/out\/[^/]+\.(mp4|mov|webm|m4v)$/i.test(p)) {
    return {error: '这个路径不是成片产物'};
  }
  const abs = resolve(ROOT, p);
  if (!abs.startsWith(ROOT + sep) || !existsSync(abs)) return {error: '文件不存在'};

  const key = createHash('sha1').update(`${p}:${statSync(abs).mtimeMs}`).digest('hex').slice(0, 16);
  const out = join(POSTER_DIR, `${key}.jpg`);
  if (existsSync(out) && statSync(out).size > 0) return {file: out};
  if (posterInflight.has(key)) return posterInflight.get(key);

  const job = (async () => {
    await posterSlot();
    try {
      mkdirSync(POSTER_DIR, {recursive: true});
      let at = 1;
      try {
        const dur = Number(
          await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', abs]),
        );
        if (Number.isFinite(dur) && dur > 0) at = Math.max(0.05, dur * 0.4);
      } catch {}
      // -ss 放在 -i 前面是关键帧粗定位,快一个数量级;封面不需要精确到帧
      await run('ffmpeg', ['-y', '-ss', at.toFixed(3), '-i', abs, '-frames:v', '1',
        '-vf', 'scale=480:-2', '-q:v', '4', out]);
      if (!existsSync(out) || statSync(out).size === 0) return {error: '抽帧没出图'};
      return {file: out};
    } catch (e) {
      return {error: String(e.message || e).slice(0, 200)};
    } finally {
      posterRelease();
      posterInflight.delete(key);
    }
  })();
  posterInflight.set(key, job);
  return job;
}

// ─────────────────────────────── 小工具 ───────────────────────────────

export function json(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, {'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(s)});
  res.end(s);
}

export function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((ok, bad) => {
    const chunks = [];
    let size = 0;
    let exceeded = false;
    req.on('data', (c) => {
      if (exceeded) return;
      const chunk = Buffer.isBuffer(c) ? c : Buffer.from(c);
      size += chunk.length;
      if (size > limit) {
        exceeded = true;
        chunks.length = 0;
        bad(new Error('请求体过大'));
        return;
      }
      chunks.push(chunk);
    });
    // Decode once: a UTF-8 character may span multiple request chunks.
    req.on('end', () => { if (!exceeded) ok(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', bad);
  });
}
