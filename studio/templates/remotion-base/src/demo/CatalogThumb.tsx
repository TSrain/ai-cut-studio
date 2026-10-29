import React from 'react';
import {AbsoluteFill, Img, staticFile, useCurrentFrame} from 'remotion';
import {createTypography, ink, scenePalette, seriesDark, textStyle} from '../lib/theme';
import {BackgroundSystem, DepthCam, PageCam, SurfacePanel} from '../components/visual';
import {ContrastColumns} from '../components/ContrastColumns';
import {DotField} from '../components/DotField';
import {HesitantCursor} from '../components/HesitantCursor';
import {KenBurns} from '../components/KenBurns';
import {KeywordHighlight} from '../components/KeywordHighlight';
import {LineChartReveal} from '../components/LineChartReveal';
import {MetalCoin} from '../components/MetalCoin';
import {NumberTicker} from '../components/NumberTicker';
import {SemanticIcon} from '../components/SemanticIcon';
import {SkeletonCard} from '../components/SkeletonCard';
import {StalledProgress} from '../components/StalledProgress';
import {StickerChip} from '../components/StickerChip';
import {TextReveal} from '../components/TextReveal';
import {TitleDemote} from '../components/TitleDemote';
import {FilmGrain, Vignette} from '../components/visual';

// 目录缩略图渲染器:一次渲**一个**组件,产出 docs/catalog/thumbnails/remotion/<id>.png。
//
// 为什么要它:`docs/catalog/components.json` 的规矩是「没有实际渲出来的缩略图,verified 不许为
// true;verified:false 不许进生产镜头」。而 src/components/ 下 15 个表达型组件过去只在
// ComponentGallery / ContrastDemo / KenBurnsDemo 里各摆一角,**没有一条能按 id 单独渲出图**,
// 于是 13 个组件长期连目录条目都没有 —— dispatch 的 Component shortlist 是从那份 JSON 算的,
// 它们因此在机器路径上完全隐身。这个合成把"登记一个组件"的成本降到一条命令。
//
// 用法(id 与 components.json 的 id 逐字一致):
//   npx remotion still CatalogThumb --props='{"id":"ken-burns"}' out.png
//   node tools/build-catalog-thumbs.mjs            # 批量,缺哪张渲哪张
//
// 加新组件时:在 SAMPLES 里加一格,不要改别的地方。样品文案一律用**真信息**,
// 不用 Lorem —— 样张自己先守住"文案要能读"这条。

const typography = createTypography('modern');
const accent = seriesDark[0];

// 缩略图取第 60 帧:多数组件 1.5–2s 的入场此时已经落位,又还没进入静止段。
export const THUMB_FRAME = 60;

const palette = scenePalette(250, 'dark');

// 样张外壳:底场 + 承托面 + 标题条。
//
// **不要退回"平底色 + 一个组件"**。2026-08-19 第一版就是那样渲的,13 张墨量 2–9%、
// 明度层数 1–3,而目录里已验收的老缩略图是 24–93% / 13 层 —— frame-audit 当场判 FAIL。
// 原因不在组件,在样张:平底色上摆一个组件看不出它在真实画面里长什么样,
// 那是规格图不是样张。底场用 BackgroundSystem,组件坐在 SurfacePanel 上。
const Frame: React.FC<{
  title: string;
  note: string;
  /** 整画布组件(自带绝对坐标/自己铺满 1080×1920)不套承托面——套了会画到面板外面去。 */
  full?: boolean;
  children: React.ReactNode;
}> = ({title, note, full = false, children}) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{backgroundColor: palette.bg}}>
      <BackgroundSystem palette={palette} frame={frame} intensity={0.55} seed={7} variant="grid" />
      <div style={{position: 'absolute', left: 96, top: 150, right: 96}}>
        <div style={{...textStyle(typography, 'label'), color: palette.accent, letterSpacing: 4}}>
          {title}
        </div>
        <div style={{...textStyle(typography, 'body'), color: ink.secondary, marginTop: 12}}>
          {note}
        </div>
      </div>
      {full ? (
        <AbsoluteFill>{children}</AbsoluteFill>
      ) : (
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
        <SurfacePanel
          width={952}
          height={900}
          raised
          material="glass"
          accent={palette.accent}
          style={{
            borderRadius: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 40,
            boxSizing: 'border-box',
          }}
        >
          {children}
        </SurfacePanel>
      </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};

const SAMPLES: Record<
  string,
  {title: string; note: string; full?: boolean; render: (f: number) => React.ReactNode}
> = {
  'ken-burns': {
    title: 'KEN BURNS',
    note: '静图运镜:焦点 A 推移到 B,末段定格。焦点坐标走 locate.mjs 网格法,不许目测。',
    render: () => (
      <KenBurns
        src="sample-wide.png"
        imgW={1280}
        imgH={720}
        windowW={888}
        windowH={520}
        focusStart={{x: 380, y: 300}}
        focusEnd={{x: 900, y: 420}}
        scaleStart={1.0}
        scaleEnd={1.18}
        moveEnd={110}
        style={{borderRadius: 24}}
      />
    ),
  },
  'contrast-columns': {
    title: 'CONTRAST COLUMNS',
    note: '一对一对照。逐个出场:左 → 右 → 中线 → 符号,绝不左右同时淡入。',
    full: true,
    render: () => (
      <ContrastColumns
        typography={typography}
        left={{label: '手搓一个新的', payoff: '每次都重来'}}
        right={{label: '复用 + 调参', payoff: '质量会累积'}}
        symbol="≠"
        width={1080}
        centerY={1080}
        // 默认 timing 的 symbol 是第 60 帧,恰好等于样张取帧,符号进度为 0 拍不到。
        // 样张把四段整体压前,让第 60 帧时四件都已落位。
        timing={{left: 0, right: 14, divider: 28, symbol: 40}}
      />
    ),
  },
  'skeleton-card': {
    title: 'SKELETON CARD',
    note: '一堆同质化内容里挑出一个。卡里的字是肌理不是内容,标题必须弱到读不进去。',
    render: () => (
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 32}}>
        {[0, 1, 2, 3].map((i) => (
          <SkeletonCard
            key={i}
            typography={typography}
            w={396}
            h={260}
            title={['候选 A', '候选 B', '候选 C', '候选 D'][i]}
            highlight={i === 1}
            dim={i === 1 ? 1 : 0.35}
            accent={accent}
          />
        ))}
      </div>
    ),
  },
  'keyword-highlight': {
    title: 'KEYWORD HIGHLIGHT',
    note: '色带后扫:整句安定之后才长出来,且绝不放大关键词占满画面。',
    render: () => (
      <div style={{...textStyle(typography, 'h2'), color: ink.primary, maxWidth: 888, lineHeight: 1.5}}>
        目录里真正缺的不是组件,是
        <KeywordHighlight delay={24} dur={30} color="rgba(57,135,229,0.42)">
          怎么调这个组件
        </KeywordHighlight>
        。
      </div>
    ),
  },
  'number-ticker': {
    title: 'NUMBER TICKER',
    note: '数值插值,前快后慢,最后 1/3 几乎停稳给观众读。已内置 tabular-nums。',
    render: () => (
      <div style={{textAlign: 'center'}}>
        <NumberTicker
          to={74}
          dur={36}
          delay={6}
          style={{...textStyle(typography, 'hero'), color: accent}}
        />
        <div style={{...textStyle(typography, 'label'), color: ink.muted, marginTop: 24}}>
          目录条目数
        </div>
      </div>
    ),
  },
  'line-chart-reveal': {
    title: 'LINE CHART REVEAL',
    note: 'dasharray 走真实段长绘制,端点直接标签优先于图例。演示数字须标 illustrative。',
    render: () => (
      <LineChartReveal
        typography={typography}
        data={[3, 12, 28, 47, 61]}
        width={888}
        height={520}
        color={accent}
        dur={45}
        label="61%"
      />
    ),
  },
  'text-reveal': {
    title: 'TEXT REVEAL',
    note: '裁剪容器内上滑:运动发生在文字自己的空间里,避免全屏飞入的廉价感。',
    render: () => (
      <div style={{width: 888}}>
        {['先有画面', '再有工程', '最后才是交付'].map((line, i) => (
          <TextReveal key={line} delay={i * 8} dur={18} style={{height: 130}}>
            <div style={{...textStyle(typography, 'h2'), color: i === 2 ? accent : ink.primary}}>
              {line}
            </div>
          </TextReveal>
        ))}
      </div>
    ),
  },
  'semantic-icon': {
    title: 'SEMANTIC ICON',
    note: '10 个具名图标,零素材免版权登记。别去图库下图标。',
    render: () => (
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 56, width: 888}}>
        {(['clock', 'growth', 'decline', 'filter', 'duplicate', 'check', 'cross', 'search', 'doc', 'alert'] as const).map(
          (name) => (
            <div key={name} style={{textAlign: 'center'}}>
              <SemanticIcon name={name} size={88} color={ink.primary} />
              <div style={{...textStyle(typography, 'caption'), color: ink.muted, marginTop: 12}}>{name}</div>
            </div>
          ),
        )}
      </div>
    ),
  },
  'sticker-chip': {
    title: 'STICKER CHIP',
    note: '叠在别人画面上的小信息块。90% 不透明深底是它存在的全部理由——再透就压不住花底片。',
    render: () => (
      <div style={{display: 'flex', flexDirection: 'column', gap: 32, alignItems: 'flex-start'}}>
        {['13 个组件此前不在目录里', 'shortlist 从 JSON 算', '散文表 worker 读不到'].map((text, i) => (
          <StickerChip key={text} enterFrame={i * 10}>
            <div style={{...textStyle(typography, 'body'), color: ink.primary}}>{text}</div>
          </StickerChip>
        ))}
      </div>
    ),
  },
  'metal-coin': {
    title: 'METAL COIN',
    note: '齿边 + 偏心径向高光 + inset 双环 + 一次性反光扫过,四件缺一就是扁平圆形。',
    render: () => <MetalCoin typography={typography} size={420} face="¥" sweepStart={30} />,
  },
  'hesitant-cursor': {
    title: 'HESITANT CURSOR',
    note: '想选选不下去。reach 取 0.5–0.6 最像犹豫,每次试探之间要回 home 停一下。',
    render: () => (
      <div style={{position: 'relative', width: 888, height: 700}}>
        {['方案 A · 稳', '方案 B · 快', '方案 C · 省'].map((text, i) => (
          <div
            key={text}
            style={{
              position: 'absolute',
              left: 60,
              top: 80 + i * 200,
              width: 760,
              height: 150,
              borderRadius: 18,
              border: `2px solid ${ink.grid}`,
              display: 'flex',
              alignItems: 'center',
              paddingLeft: 40,
              boxSizing: 'border-box',
              ...textStyle(typography, 'body'),
              color: ink.secondary,
            }}
          >
            {text}
          </div>
        ))}
        <HesitantCursor
          home={{x: 440, y: 640}}
          attempts={[
            {x: 440, y: 155, start: 0, reach: 0.55},
            {x: 440, y: 355, start: 30, reach: 0.6},
          ]}
          size={34}
        />
      </div>
    ),
  },
  'stalled-progress': {
    title: 'STALLED PROGRESS',
    note: '努力过但没进展。delta 只给 1–2 个百分点,给多了读成"在推进"。',
    render: () => (
      <StalledProgress
        pct={68}
        probes={[
          {frame: 24, delta: 2},
          {frame: 54, delta: 1},
        ]}
        width={820}
        showLabel
      />
    ),
  },
  'dot-field': {
    title: 'DOT FIELD',
    note: '底纹不是图形。opacity 0.55 已是上限区——调到 1.0 就不是肌理是装饰了。',
    full: true,
    render: () => (
      <>
        <DotField width={1080} height={1920} gap={12} radius={0.75} opacity={0.55} id="thumb" />
        <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
          <div style={{...textStyle(typography, 'h2'), color: ink.primary, textAlign: 'center'}}>
            底纹压得住内容
            <br />
            才算合格
          </div>
        </AbsoluteFill>
      </>
    ),
  },

  // ── 镜头配方(kind:"recipe")──────────────────────────────────────────────
  // 配方 = 几个组件按什么时序凑成一个具名手法。样品册里它们和组件混在同一个
  // SAMPLES 表里,是因为渲图这件事没有区别;区别在 components.json 的 kind 字段。
  // 卡片全文见 docs/recipes/<category>/<id>.md。
  'ken-burns-push-hold': {
    title: 'RECIPE · 静图推近定格',
    note: '焦点映射窗心 + 两轴边缘钳制 + 末段定格。焦点走网格法,末帧必查边缘有没有裁掉半截。',
    render: () => (
      <KenBurns
        src="sample-wide.png"
        imgW={1280}
        imgH={720}
        windowW={888}
        windowH={560}
        focusStart={{x: 640, y: 360}}
        focusEnd={{x: 880, y: 300}}
        scaleStart={0.82}
        scaleEnd={1.12}
        moveEnd={120}
        style={{borderRadius: 20}}
      />
    ),
  },
  'keyword-band-sweep': {
    title: 'RECIPE · 关键词后扫',
    note: '整句先安定,色带后扫。深底换低饱和色——高饱和黄上压白字读不清,这条踩过。',
    render: () => (
      <div style={{...textStyle(typography, 'h2'), color: ink.primary, maxWidth: 820, lineHeight: 1.55}}>
        划重点的价值在于
        <KeywordHighlight delay={36} dur={30} color="rgba(57,135,229,0.42)">
          上下文还在
        </KeywordHighlight>
        。
      </div>
    ),
  },
  'hesitation-stall': {
    title: 'RECIPE · 犹豫与停滞',
    note: '动作要发生,结果不许发生。光标走一半折返 + 进度 +1% 又退回,两个动作错开。',
    render: () => (
      <div style={{position: 'relative', width: 820, height: 760}}>
        {['方案 A · 稳', '方案 B · 快'].map((text, i) => (
          <div
            key={text}
            style={{
              position: 'absolute',
              left: 30,
              top: 60 + i * 170,
              width: 760,
              height: 140,
              borderRadius: 18,
              border: `2px solid ${ink.grid}`,
              display: 'flex',
              alignItems: 'center',
              paddingLeft: 36,
              boxSizing: 'border-box',
              ...textStyle(typography, 'body'),
              color: ink.secondary,
            }}
          >
            {text}
          </div>
        ))}
        <div style={{position: 'absolute', left: 30, top: 430, width: 760}}>
          <StalledProgress pct={68} probes={[{frame: 24, delta: 2}, {frame: 54, delta: 1}]} width={760} showLabel />
        </div>
        <HesitantCursor
          home={{x: 410, y: 640}}
          attempts={[
            {x: 410, y: 130, start: 0, reach: 0.55},
            {x: 410, y: 300, start: 32, reach: 0.6},
          ]}
          size={34}
        />
      </div>
    ),
  },
  'depth-surface-stack': {
    title: 'RECIPE · 纵深地板',
    note: '底场渐变 → 结构层 → 抬升承托面 → 压边。判据是 frame-audit 的明度层数 ≥6,不是"看着够不够"。',
    render: () => (
      <div style={{textAlign: 'center'}}>
        <div style={{...textStyle(typography, 'h2'), color: ink.primary}}>
          画面太素
          <br />
          不是元素不够多
        </div>
        <div style={{...textStyle(typography, 'body'), color: ink.secondary, marginTop: 28}}>
          是层级不够
        </div>
      </div>
    ),
  },
  'icon-stamp': {
    title: 'RECIPE · 图标盖章',
    note: '文字先落定,图标随后盖上(delay ≥8)。同时出现会让眼睛白跑一趟往返。',
    render: () => (
      <div style={{display: 'flex', flexDirection: 'column', gap: 44, width: 820}}>
        {([
          ['clock', '手搓一个新的', ink.secondary],
          ['growth', '复用 + 调参', accent],
        ] as const).map(([icon, text, color], i) => (
          <div key={text} style={{display: 'flex', alignItems: 'center', gap: 28}}>
            <TextReveal delay={i * 8} dur={18} style={{height: 92}}>
              <div style={{...textStyle(typography, 'h2'), color}}>{text}</div>
            </TextReveal>
            <SemanticIcon name={icon} size={72} color={color} />
          </div>
        ))}
      </div>
    ),
  },
  'metal-object-beat': {
    title: 'RECIPE · 物件落地重击',
    note: '重量感来自加速度和形变,不是尺寸。币面只放表意符号,别写具体信息(会和旁边文字冗余)。',
    render: () => (
      <div style={{display: 'flex', alignItems: 'center', gap: 48}}>
        <MetalCoin typography={typography} size={300} face="¥" sweepStart={30} />
        <StickerChip enterFrame={36}>
          <div style={{...textStyle(typography, 'h2'), color: ink.primary}}>不到 5 毛 / 天</div>
        </StickerChip>
      </div>
    ),
  },
  'texture-floor': {
    title: 'RECIPE · 质感地板',
    note: '三层都压在感知阈值附近:合起来有,单独看没有。观众注意到有颗粒就已经过头了。',
    full: true,
    render: () => (
      <>
        <Vignette strength={0.3} color="#000000" />
        <DotField width={1080} height={1920} gap={12} radius={0.75} opacity={0.55} id="floor" />
        <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
          <div style={{...textStyle(typography, 'h2'), color: ink.primary, textAlign: 'center'}}>
            底色不能是
            <br />
            一块死掉的纯色
          </div>
        </AbsoluteFill>
        <FilmGrain intensity={0.18} />
      </>
    ),
  },
  'title-demote-to-label': {
    title: 'RECIPE · 标题降格成门牌',
    note: 'scale 与位置走同一条曲线(拆两段就读成两个动作);站稳 ≥18f 再降格;内容在飞行途中就生长。',
    full: true,
    render: () => (
      <>
        {/* 样张里把落点下移:组件默认 (96,150) 是给真实镜头用的,
            这里上面还有样张外壳自己的标题块,不让位就会撞在一起(第一版就是这么废的)。 */}
        <TitleDemote
          typography={typography}
          title="镜头配方"
          color={accent}
          appearAt={0}
          landing={{x: 96, y: 430}}
          center={{x: 540, y: 760}}
        />
        <div style={{position: 'absolute', left: 96, top: 560, right: 96}}>
          {['一个具名手法', '组件怎么组合', '参数调到多少', '哪里会翻车'].map((text, i) => (
            <TextReveal key={text} delay={42 + i * 5} dur={18} style={{height: 108}}>
              <div style={{...textStyle(typography, 'h2'), color: i === 3 ? accent : ink.primary}}>{text}</div>
            </TextReveal>
          ))}
        </div>
      </>
    ),
  },
  'page-cam': {
    title: 'PAGE CAM · 2.5D 页面相机',
    note: '整页截图上做平移缩放 + 三轴倾斜。坐标来自采集产物的 layout.json,不是目测。',
    render: () => (
      // 样张的倾角**故意给足**:第一版首尾给 8°→−4°,取样帧正好插值到 2°,
      // 渲出来和平面 pan/zoom 一模一样 —— 样张要能一眼看出这组件比 KenBurns 多了什么。
      <PageCam
        src="screens/sample-page-tall.jpg"
        pageW={1200}
        pageH={4000}
        width={880}
        height={880}
        keys={[
          {frame: 0, cx: 600, cy: 600, zoom: 0.62, rotY: 22, rotX: 10},
          {frame: 120, cx: 600, cy: 1600, zoom: 0.8, rotY: 14, rotX: 6},
        ]}
        style={{borderRadius: 18}}
      />
    ),
  },
  'depth-cam': {
    title: 'DEPTH CAM · 分层运镜',
    note: '把画面拆层,各层按深度对同一次运动作出不同反应。视差 / dolly-zoom / 冻结环绕靠它。',
    render: () => (
      // 静帧拍不出"动得不一样",所以样张取**冻结环绕**的中段:
      // 背景平面带透视后退、前景主体正对镜头 —— 这是单张图里唯一能看出分层的状态。
      <DepthCam
        width={880}
        height={880}
        // 取样帧是第 60 帧 —— 首尾给 −18→14 的话中点正好插值到 −2°,渲出来完全是平的。
        // (PageCam 样张已经栽过一次同样的坑,这里再栽一次说明光写注释不够:
        //  **样张的关键帧要围着取样帧设计,不是围着"一个完整动作"设计**。)
        keys={[{frame: 0, yaw: -22}, {frame: 120, yaw: -10}]}
        layers={[
          {
            parallax: 0.15,
            zoomGain: 1,
            z: 300,
            node: (
              <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
                <Img src={staticFile('screens/sample-page-tall.jpg')} style={{width: 820, opacity: 0.6}} />
              </AbsoluteFill>
            ),
          },
          {
            parallax: 0.4,
            zoomGain: 1,
            z: 0,
            node: (
              <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
                <Img src={staticFile('screens/sample-subject.png')} style={{width: 560}} />
              </AbsoluteFill>
            ),
          },
        ]}
        style={{borderRadius: 18}}
      />
    ),
  },
};

export const CATALOG_THUMB_IDS = Object.keys(SAMPLES);

export const CatalogThumb: React.FC<{id?: string}> = ({id = 'ken-burns'}) => {
  const frame = useCurrentFrame();
  const sample = SAMPLES[id];
  if (!sample) {
    return (
      <AbsoluteFill
        style={{backgroundColor: palette.bg, alignItems: 'center', justifyContent: 'center'}}
      >
        <div style={{...textStyle(typography, 'h2'), color: ink.primary}}>
          未知 id: {id}
        </div>
      </AbsoluteFill>
    );
  }
  return (
    <Frame title={sample.title} note={sample.note} full={sample.full}>
      {sample.render(frame)}
    </Frame>
  );
};
