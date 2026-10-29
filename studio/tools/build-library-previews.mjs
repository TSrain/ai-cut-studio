#!/usr/bin/env node
/**
 * 素材库缩略图:把 HDRI / PBR 材质渲成能看的图。
 *
 * 为什么要有这个:控制台的「素材库」原来只列文件名。`qwantani_dusk_2_2k.hdr`
 * 对人是零信息量——环境光和材质是**看效果才能选**的东西,和字体渲样句、音效可点响同一个道理。
 *
 * 每个素材出两张:
 *   assets/previews/library/hdri-<名>.jpg   三个球在这盏光下的样子(镜面/半哑光/白哑光)
 *   assets/previews/library/hdri-<名>-pano.jpg  环境全景本身(ffmpeg 直接 tonemap,不走渲染)
 *   assets/previews/library/mat-<名>.jpg    贴上这套 PBR 贴图的球 + 一块平铺样片
 *
 * 渲染走模板的 LibrarySample 合成。素材临时拷进 templates/remotion-base/public/_libpreview/,
 * 渲完删掉——不留在模板里,否则每次 `cp -Rc` 克隆工程都要背着十几 MB 的 .hdr。
 *
 * 用法:
 *   node tools/build-library-previews.mjs           # 只补缺的
 *   node tools/build-library-previews.mjs --force   # 全部重渲(换了 LibrarySample 之后用)
 */
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readdirSync, rmSync, cpSync, statSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TPL = join(ROOT, 'templates/remotion-base');
const LIB = join(ROOT, 'assets/library');
const OUT = join(ROOT, 'assets/previews/library');
const STAGE = join(TPL, 'public/_libpreview');
const FORCE = process.argv.includes('--force');

/** 材质模式的中性打光:影棚光,让金属/粗糙度差异看得出来 */
const NEUTRAL_HDRI = 'hdri/studio_small_08_2k.hdr';

const ls = (dir, filter = () => true) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => !f.startsWith('.')).filter(filter).sort() : [];

const fresh = (out, src) =>
  !FORCE && existsSync(out) && statSync(out).mtimeMs > statSync(src).mtimeMs;

const still = (outFile, props) => {
  execFileSync(
    'npx',
    [
      'remotion',
      'still',
      'LibrarySample',
      '--frame=0',
      `--props=${JSON.stringify(props)}`,
      outFile,
    ],
    {cwd: TPL, stdio: 'inherit'},
  );
};

/** ambientCG 的贴图命名:<集>_1K-JPG_Color.jpg / _Roughness.jpg / _Metalness.jpg / _NormalGL.jpg */
const pickMaps = (dir, files) => {
  const find = (re) => files.find((f) => re.test(f)) ?? null;
  const color = find(/_Color\.(jpg|png)$/i);
  if (!color) return null;
  return {
    color,
    roughness: find(/_Roughness\.(jpg|png)$/i),
    metalness: find(/_Metalness\.(jpg|png)$/i),
    // NormalGL 是 three.js 用的那套(Y 朝上);DX 是给 Unreal 那类引擎的,别拿错
    normal: find(/_NormalGL\.(jpg|png)$/i) ?? find(/_Normal\.(jpg|png)$/i),
  };
};

mkdirSync(OUT, {recursive: true});
rmSync(STAGE, {recursive: true, force: true});
mkdirSync(STAGE, {recursive: true});

let made = 0;
let skipped = 0;

try {
  // ── HDRI ────────────────────────────────────────────────
  for (const f of ls(join(LIB, 'hdri'), (n) => n.endsWith('.hdr'))) {
    const base = f.replace(/\.hdr$/, '');
    const src = join(LIB, 'hdri', f);
    const ball = join(OUT, `hdri-${base}.jpg`);
    const pano = join(OUT, `hdri-${base}-pano.jpg`);

    if (!fresh(pano, src)) {
      // 全景条:ffmpeg 直接读 Radiance HDR 并 tonemap,不用起浏览器。
      // reinhard param=0.4 是试出来的:影棚 HDRI 四周本来就是黑的,再暗一点就全糊成一团
      execFileSync(
        'ffmpeg',
        ['-hide_banner', '-loglevel', 'error', '-y', '-i', src,
         '-vf', 'scale=640:-1,tonemap=tonemap=reinhard:param=0.4,eq=gamma=1.15',
         '-frames:v', '1', pano],
        {stdio: 'inherit'},
      );
      made++;
    } else skipped++;

    if (fresh(ball, src)) {
      skipped++;
      continue;
    }
    cpSync(src, join(STAGE, f));
    still(ball, {hdri: `_libpreview/${f}`, maps: null});
    made++;
  }

  // ── PBR 材质 ────────────────────────────────────────────
  for (const d of ls(join(LIB, 'materials'))) {
    const dir = join(LIB, 'materials', d);
    if (!statSync(dir).isDirectory()) continue;
    const files = readdirSync(dir);
    const maps = pickMaps(dir, files);
    if (!maps) {
      console.warn(`[skip] ${d}:没找到 *_Color.jpg,不像是一套 PBR 贴图`);
      continue;
    }
    const out = join(OUT, `mat-${d}.jpg`);
    if (fresh(out, join(dir, maps.color))) {
      skipped++;
      continue;
    }
    const stageDir = join(STAGE, d);
    mkdirSync(stageDir, {recursive: true});
    for (const m of Object.values(maps)) if (m) cpSync(join(dir, m), join(stageDir, m));
    still(out, {
      hdri: NEUTRAL_HDRI,
      maps: Object.fromEntries(
        Object.entries(maps).map(([k, v]) => [k, v ? `_libpreview/${d}/${v}` : null]),
      ),
    });
    made++;
  }
} finally {
  rmSync(STAGE, {recursive: true, force: true});
}

console.log(`素材库缩略图:新渲 ${made} 张,跳过 ${skipped} 张 → ${OUT.replace(ROOT + '/', '')}`);
