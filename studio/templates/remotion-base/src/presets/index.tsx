import {PresetBehindTitle} from './BehindTitle';
import {PresetMediaStage} from './MediaStage';
// presets/index.ts —— preset composition 注册表。Root.tsx 只 import 这一个文件。
// 新增 preset:①写组件;②在这里登记;③docs/presets/<id>/ 落 preset.json + PRESET.md;
// ④StyleBible 加样张页;⑤catalog 登记 + 用户看样张后才翻 verified;
// ⑦**渲面板循环片**:node tools/build-asset-previews.mjs --only presets
//   (缺了模板卡不会动 —— 不报错、不缺东西,只是那个模板在控制台里退化成静图,
//    而模板一半的价值在时序。build-asset-browser 会自动补渲,
//    tools/tests/preset-registration.test.mjs 会拦住漏掉的);
// ⑥**必须带全套 tune 旋钮**(2026-08-07 用户定的规矩:做东西默认做成可调的)——
//   主文字元素 font/scale/x/y + 全局 skin/accentHue/neutralHue(用 tuneSkinFields 展开,
//   组件出口包 <TuneSkin>),Studio 里没有旋钮的模板视为没做完。
import React from 'react';
import {PresetExit} from './PresetExit';
import {z} from 'zod';
import {ShotChrome, chromeFields, type ChromeProps} from '../style/chrome';
import {PresetRecede, type PresetRecedeProps} from './Recede';
import {PresetKeyConcept, type PresetKeyConceptProps} from './KeyConcept';
import {PresetQuoteCard, type PresetQuoteCardProps} from './QuoteCardShot';
import {PresetContrastPair, type PresetContrastPairProps} from './ContrastPair';
import {PresetNumberBeat, type PresetNumberBeatProps} from './NumberBeat';
import {PresetCardSwarm, type PresetCardSwarmProps} from './CardSwarm';
import {PresetScreenPush, type PresetScreenPushProps} from './ScreenPush';
import {PresetBulletRun, type PresetBulletRunProps} from './BulletRun';
import {PresetStepFlow, type PresetStepFlowProps} from './StepFlow';
import {PresetTrendChart, type PresetTrendChartProps} from './TrendChart';
// —— 2026-08-20 video-shotcraft 15 效果移植的 9 个新 preset(逐帧复刻验证见 src/shotcraft/)
import {PresetTitleReveal, type PresetTitleRevealProps} from './TitleReveal';
import {PresetBrandOpen, type PresetBrandOpenProps} from './BrandOpen';
import {PresetFlyingWords, type PresetFlyingWordsProps} from './FlyingWordsShot';
import {PresetCardShowcase, type PresetCardShowcaseProps} from './CardShowcase';
import {PresetCubeNav, type PresetCubeNavProps} from './CubeNav';
import {PresetDocTypewriter, type PresetDocTypewriterProps} from './DocTypewriter';
import {PresetGlassPill, type PresetGlassPillProps} from './GlassPill';
import {PresetPhoneRipple, type PresetPhoneRippleProps} from './PhoneRipple';
import {PresetSegmentedThumb, type PresetSegmentedThumbProps} from './SegmentedThumb';
// —— 2026-08-26 video-shotcraft 第二批移植的 3 个新 preset
import {PresetSpaceSteps, type PresetSpaceStepsProps} from './SpaceSteps';
import {PresetTimelineTravel, type PresetTimelineTravelProps} from './TimelineTravel';
import {PresetTextMask, type PresetTextMaskProps} from './TextMask';
// —— 2026-08-31 高高lindsey 拉片衍生的 3 个新 preset(蓝图见 docs/blueprints/kinetic-word-cascade.md)
//    pill-stack / word-cascade 是**双通道 overlay**(透明底渲 alpha 层叠在用户实拍上),
//    aspect-embed 吃视频槽;三个都横竖两档(canvas prop,Root 的 calculateMetadata 解析)
import {PresetPillStack, type PresetPillStackProps} from './PillStack';
import {ChapterNavigation, type ChapterNavigationProps} from '../editor/ChapterNavigation';
import {PresetWordCascade, type PresetWordCascadeProps} from './WordCascade';
import {PresetAspectEmbed, type PresetAspectEmbedProps} from './AspectEmbed';

export type PresetEntry = {
  /** Remotion composition id,与 docs/presets/<id>/preset.json 的 compositionId 一致 */
  id: string;
  component: React.FC<any>;
  /** Remotion Studio 的参数面板 schema:文字变输入框、数字变滑杆,用户可视化微调 */
  schema: z.ZodTypeAny;
  /** StyleBible 与 Studio 预览用的示例 props(真实中文文案,不许 lorem) */
  defaultProps: {durationSeconds: number; [key: string]: unknown};
};

// schema 与 docs/presets/<id>/preset.json 的 slots 对应;数值区间来自 duration/variants
// tune = 打磨旋钮(font 换字体 / scale 调大小 / x,y 挪位置)。只用于 Studio 试玩,
// 调到满意把值告诉主 agent 固化进皮肤或 preset;生产合同不携带 tune。
const tuneFont = z.enum(['skin', 'smiley', 'archivo', 'serif', 'wenkai', 'noto-serif']);
// 全局观感旋钮:skin 整套换皮肤;accentHue 强调色相;neutralHue 底/背景色相(背景颜色在这调)
const tuneSkinFields = {
  skin: z.enum(['abyss', 'ember', 'slate', 'paper']).default('abyss'),
  accentHue: z.number().min(0).max(360).default(252),
  neutralHue: z.number().min(0).max(360).default(232),
};
const recedeSchema = z.object({
  durationSeconds: z.number().min(2).max(5),
  variant: z.object({level: z.number().int().min(1).max(4)}).optional(),
  // hero = line 里要放大的那段子串(必须逐字出现在 line 中);留空 = 整句一个字号
  slots: z.object({
    line: z.string(), hero: z.string().optional(),
    emphasisRanges: z.array(z.object({start: z.number().int().min(0), end: z.number().int().min(1)})).max(1000).optional(),
    fontSize: z.number().min(8).max(400).optional(),
    emphasisRatio: z.number().min(1).max(3).optional(),
    enterFx: z.enum(['none','fade','rise','fall','zoom']).optional(),
    exitFx: z.enum(['none','fade','rise','fall','zoom']).optional(),
    enterSeconds: z.number().min(.05).max(2).optional(),
    exitSeconds: z.number().min(.05).max(2).optional(),
  }),
  tune: z
    .object({
      font: tuneFont.default('skin'),
      scale: z.number().min(0.6).max(1.5).default(1),
      y: z.number().min(-400).max(400).default(0),
      ...tuneSkinFields,
    })
    .optional(),
  ...chromeFields,
});
const keyConceptSchema = z.object({
  durationSeconds: z.number().min(2.5).max(6),
  slots: z.object({
    term: z.string(),
    en: z.string().optional(),
    sentence: z.string().optional(),
    highlight: z.string().optional(),
    eyebrow: z.string().optional(),
  }),
  tune: z
    .object({
      font: tuneFont.default('skin'),
      scale: z.number().min(0.6).max(1.5).default(1),
      x: z.number().min(-300).max(300).default(0),
      y: z.number().min(-400).max(400).default(0),
      ...tuneSkinFields,
    })
    .optional(),
  ...chromeFields,
});
const quoteCardSchema = z.object({
  durationSeconds: z.number().min(3).max(6),
  variant: z.object({tone: z.enum(['warm', 'cool'])}).optional(),
  slots: z.object({
    quote: z.string(),
    source: z.string().optional(),
    note: z.string().optional(),
    noteTag: z.string().optional(),
  }),
  tune: z
    .object({
      font: tuneFont.default('skin'),
      scale: z.number().min(0.6).max(1.5).default(1),
      y: z.number().min(-400).max(400).default(0),
      ...tuneSkinFields,
    })
    .optional(),
  ...chromeFields,
});
const contrastPairSchema = z.object({
  durationSeconds: z.number().min(2.5).max(6),
  variant: z.object({symbol: z.enum(['≠', '→', 'VS'])}).optional(),
  slots: z.object({
    leftLabel: z.string(),
    leftText: z.string(),
    rightLabel: z.string(),
    rightText: z.string(),
    eyebrow: z.string().optional(),
  }),
  tune: z
    .object({
      font: tuneFont.default('skin'),
      scale: z.number().min(0.6).max(1.5).default(1),
      y: z.number().min(-400).max(400).default(0),
      ...tuneSkinFields,
    })
    .optional(),
  ...chromeFields,
});
const numberBeatSchema = z.object({
  durationSeconds: z.number().min(2.5).max(5),
  // celebrate=confetti:计数撞停时 52 片纸屑重力弧线爆开(源自 shotcraft counter-confetti)
  variant: z.object({celebrate: z.enum(['none', 'confetti']).default('none')}).optional(),
  slots: z.object({
    value: z.number(),
    prefix: z.string().optional(),
    suffix: z.string().optional(),
    label: z.string(),
    eyebrow: z.string().optional(),
  }),
  tune: z
    .object({
      font: tuneFont.default('skin'),
      scale: z.number().min(0.6).max(1.5).default(1),
      x: z.number().min(-300).max(300).default(0),
      y: z.number().min(-400).max(400).default(0),
      ...tuneSkinFields,
    })
    .optional(),
  ...chromeFields,
});

/**
 * 给每个 preset 套上「外挂层」(品牌标记 + 音效)。
 *
 * 在**合成层**套而不是改 5 个组件文件:品牌标记贴哪个角、音效响不响,和版式无关,
 * 换任何一个模板都成立。写进组件里就是同一段代码抄五遍,加第六个模板还得再抄一遍。
 * 副作用是外挂层落在 <TuneSkin> 外面 —— 它不消费皮肤令牌,所以无所谓。
 */
const withChrome = (C: React.FC<any>, ownTextExit = false): React.FC<any> => {
  const Wrapped: React.FC<any> = (props) => (
    <PresetExit durationSeconds={props.durationSeconds} enabled={!ownTextExit || props.slots?.exitFx === undefined}>
      <C {...props} />
      <ShotChrome brand={(props as ChromeProps).brand} sfx={(props as ChromeProps).sfx} />
    </PresetExit>
  );
  Wrapped.displayName = `WithChrome(${C.displayName ?? C.name ?? 'Preset'})`;
  return Wrapped;
};

// —— 卡片群收束:total/keep 是"多少 → 剩多少",它们是内容不是档位,所以放 slots
const cardSwarmSchema = z.object({
  durationSeconds: z.number().min(3).max(8),
  variant: z
    .object({mode: z.enum(['dedup', 'filter']).default('dedup'), cols: z.union([z.literal(4), z.literal(5), z.literal(6)]).default(5)})
    .optional(),
  slots: z.object({
    total: z.number().int().min(8).max(48),
    keep: z.number().int().min(1).max(12),
    eyebrow: z.string().optional(),
    caption: z.string().optional(),
    keepLabel: z.string().optional(),
  }),
  tune: z
    .object({
      font: tuneFont.default('skin'),
      scale: z.number().min(0.6).max(1.5).default(1),
      y: z.number().min(-400).max(400).default(0),
      ...tuneSkinFields,
    })
    .optional(),
  ...chromeFields,
});

// —— 截图推近:imgW/imgH 是源图真实像素,控制台自动探测填入;手写合同时用 sips 量
const screenPushSchema = z.object({
  durationSeconds: z.number().min(2.5).max(10),
  variant: z
    .object({
      // graze:相机低掠页面表面(大倾角+近景景深),多焦点时依次巡览(源自 shotcraft graze-face-tour)
      move: z.enum(['push', 'pull', 'pan', 'static', 'graze']).default('push'),
      mark: z.enum(['none', 'underline', 'marker', 'circle', 'box']).default('underline'),
      ink: z.enum(['auto', 'red', 'yellow', 'accent']).default('auto'),
    })
    .optional(),
  slots: z.object({
    image: z.string(),
    imgW: z.number().int().min(1),
    imgH: z.number().int().min(1),
    // 归一化焦点。**必须走 tools/locate.mjs 的网格法拿,不许目测**(locate-protocol.md)
    focusX: z.number().min(0).max(1).default(0.5),
    focusY: z.number().min(0).max(1).default(0.5),
    // 批注框:归一化中心 + 宽高。缺 markW 就不画批注;坐标同样走网格法
    // graze 巡览的第 2/3 站(可省;只有 move=graze 时被读)。坐标同样走网格法/ocr-locate
    focus2X: z.number().min(0).max(1).optional(),
    focus2Y: z.number().min(0).max(1).optional(),
    focus3X: z.number().min(0).max(1).optional(),
    focus3Y: z.number().min(0).max(1).optional(),
    markX: z.number().min(0).max(1).optional(),
    markY: z.number().min(0).max(1).optional(),
    markW: z.number().min(0).max(1).optional(),
    markH: z.number().min(0).max(1).optional(),
    eyebrow: z.string().optional(),
    caption: z.string().optional(),
    credit: z.string().optional(),
  }),
  tune: z
    .object({
      font: tuneFont.default('skin'),
      scale: z.number().min(0.6).max(1.5).default(1),
      y: z.number().min(-400).max(400).default(0),
      ...tuneSkinFields,
    })
    .optional(),
  ...chromeFields,
});

// —— 列点推进:items 是**数组槽**(schema 里第一个 list 类型)。控制台表单渲成多行文本框,
// 一行一条;上游合同直接给字符串数组。每条可用 ` | ` 隔出小注。
const bulletRunSchema = z.object({
  durationSeconds: z.number().min(3).max(10),
  variant: z
    .object({
      flow: z.enum(['walk', 'stack']).default('walk'),
      marker: z.enum(['none', 'number', 'dot', 'check']).default('none'),
    })
    .optional(),
  slots: z.object({
    items: z.array(z.string()).min(2).max(6),
    title: z.string().optional(),
    eyebrow: z.string().optional(),
  }),
  tune: z
    .object({
      font: tuneFont.default('skin'),
      scale: z.number().min(0.6).max(1.5).default(1),
      y: z.number().min(-400).max(400).default(0),
      ...tuneSkinFields,
    })
    .optional(),
  ...chromeFields,
});

// —— 流程推进:steps 同样是数组槽,每条可用 ` | ` 隔出说明句
const stepFlowSchema = z.object({
  durationSeconds: z.number().min(5).max(16),
  variant: z
    .object({
      emphasis: z.enum(['focus', 'even']).default('focus'),
      marker: z.enum(['number', 'dot']).default('number'),
    })
    .optional(),
  slots: z.object({
    steps: z.array(z.string()).min(2).max(6),
    title: z.string().optional(),
    eyebrow: z.string().optional(),
  }),
  tune: z
    .object({
      font: tuneFont.default('skin'),
      scale: z.number().min(0.6).max(1.5).default(1),
      y: z.number().min(-400).max(400).default(0),
      ...tuneSkinFields,
    })
    .optional(),
  ...chromeFields,
});

// —— 趋势图表:values/xLabels 是逗号分隔的字符串(表单里一行打完最顺手,见组件注释坑 1)
const trendChartSchema = z.object({
  durationSeconds: z.number().min(4).max(14),
  variant: z
    .object({
      mark: z.enum(['line', 'area', 'bar']).default('line'),
      // 'tight' 会强制画断轴符号;bar 无论选什么都被组件短路成 zero(chart-rules §2)
      yScale: z.enum(['zero', 'tight']).default('zero'),
    })
    .optional(),
  slots: z.object({
    headline: z.string(),
    values: z.string(),
    seriesName: z.string(),
    xLabels: z.string().optional(),
    unit: z.string().optional(),
    note: z.string().optional(),
    source: z.string().optional(),
    eyebrow: z.string().optional(),
  }),
  tune: z
    .object({
      font: tuneFont.default('skin'),
      scale: z.number().min(0.6).max(1.5).default(1),
      y: z.number().min(-400).max(400).default(0),
      ...tuneSkinFields,
    })
    .optional(),
  ...chromeFields,
});

// ==== 2026-08-20 shotcraft 移植批:9 个新 preset 的 schema ====
const tuneObj = (withX: boolean) =>
  z
    .object({
      font: tuneFont.default('skin'),
      scale: z.number().min(0.6).max(1.5).default(1),
      ...(withX ? {x: z.number().min(-300).max(300).default(0)} : {}),
      y: z.number().min(-400).max(400).default(0),
      ...tuneSkinFields,
    })
    .optional();

// —— 标题入场卡:blur(默认低能量逐词浮出)/ marker(记号笔划线)/ brace(大括号弹开)
const titleRevealSchema = z.object({
  durationSeconds: z.number().min(2.5).max(6),
  variant: z.object({style: z.enum(['blur', 'marker', 'brace']).default('blur')}).optional(),
  slots: z.object({
    title: z.string(),
    subtitle: z.string().optional(),
    // marker:title 里要划线的子串;brace:括号里强调的子串;blur 忽略
    accent: z.string().optional(),
  }),
  tune: tuneObj(false),
  ...chromeFields,
});

// —— 品牌开场卡:letterspace(宽字距字母并行显形)/ ink(墨十字+逐字戳印+打字机)
const brandOpenSchema = z.object({
  durationSeconds: z.number().min(2.5).max(5),
  variant: z.object({style: z.enum(['letterspace', 'ink']).default('letterspace')}).optional(),
  slots: z.object({
    wordmark: z.string(),
    tagline: z.string().optional(),
  }),
  tune: tuneObj(false),
  ...chromeFields,
});

// —— 关键词隧道:词在透视深处生成、沿 Z 轴掠过相机;finale 是收尾定格句
const flyingWordsSchema = z.object({
  durationSeconds: z.number().min(4).max(8),
  slots: z.object({
    words: z.array(z.string()).min(6).max(24),
    finale: z.string().optional(),
  }),
  tune: tuneObj(false),
  ...chromeFields,
});

// —— 卡片列阵:fan(弹入堆叠→3D 扇形展开)/ carousel(圆轨旋转一周)。每张卡 `标题 | 小注`
const cardShowcaseSchema = z.object({
  durationSeconds: z.number().min(4).max(8),
  variant: z.object({mode: z.enum(['fan', 'carousel']).default('carousel')}).optional(),
  slots: z.object({
    cards: z.array(z.string()).min(4).max(8),
    caption: z.string().optional(),
  }),
  tune: tuneObj(false),
  ...chromeFields,
});

// —— 立方体导航:内容面板贴在立方体面上,相机在正视与等轴测间切换巡览
const cubeNavSchema = z.object({
  durationSeconds: z.number().min(4).max(8),
  slots: z.object({
    faces: z.array(z.string()).min(3).max(6),
    caption: z.string().optional(),
  }),
  tune: tuneObj(false),
  ...chromeFields,
});

// —— 文档自书写:纸片遮罩逐块擦出+琥珀光标;行语法 `## 小标` / `- 列点` / `@名字` / 普通段落
const docTypewriterSchema = z.object({
  durationSeconds: z.number().min(3.5).max(8),
  variant: z.object({history: z.enum(['show', 'none']).default('show')}).optional(),
  slots: z.object({
    docTitle: z.string(),
    meta: z.string().optional(),
    lines: z.array(z.string()).min(3).max(10),
    kicker: z.string().optional(),
  }),
  tune: tuneObj(false),
  ...chromeFields,
});

// —— 玻璃胶囊打字:玻璃质感胶囊弹入,内部渐变发光,文字打字并带光标
const glassPillSchema = z.object({
  durationSeconds: z.number().min(1.5).max(4),
  variant: z.object({icon: z.enum(['mic', 'search', 'sparkle']).default('mic')}).optional(),
  slots: z.object({
    text: z.string(),
    caption: z.string().optional(),
  }),
  tune: tuneObj(false),
  ...chromeFields,
});

// —— 波纹手机芯片:同心波纹呼吸,手机自动滚动(截图可省→骨架流),功能芯片依次弹入
const phoneRippleSchema = z.object({
  durationSeconds: z.number().min(4).max(8),
  slots: z.object({
    chips: z.array(z.string()).min(2).max(5),
    screenshot: z.string().optional(),
    imgW: z.number().int().min(1).optional(),
    imgH: z.number().int().min(1).optional(),
    caption: z.string().optional(),
  }),
  tune: tuneObj(false),
  ...chromeFields,
});

// —— 分段开关特写:光标滑入按压,滑块跳向另一侧,标签随弹簧交换主次
const segmentedThumbSchema = z.object({
  durationSeconds: z.number().min(2.5).max(5),
  variant: z.object({land: z.enum(['left', 'right']).default('right')}).optional(),
  slots: z.object({
    leftLabel: z.string(),
    rightLabel: z.string(),
    caption: z.string().optional(),
  }),
  tune: tuneObj(false),
  ...chromeFields,
});

// ==== 2026-08-26 shotcraft 第二批:3 个新 preset 的 schema ====

// —— 空间步进:卡片散布 3D 空间各处,相机取各站姿态之逆依次飞去对齐,末段拉远成总览
const spaceStepsSchema = z.object({
  durationSeconds: z.number().min(5).max(10),
  variant: z.object({spin: z.enum(['on', 'off']).default('on')}).optional(),
  slots: z.object({
    steps: z.array(z.string()).min(3).max(4),
    overview: z.string().optional(),
    caption: z.string().optional(),
  }),
  tune: tuneObj(false),
  ...chromeFields,
});

// —— 时间轴横移:相机沿水平刻度轴加速掠过,每过一格卡片弹立,末刻度急停推近
const timelineTravelSchema = z.object({
  durationSeconds: z.number().min(4).max(8),
  slots: z.object({
    stops: z.array(z.string()).min(3).max(5),
    title: z.string().optional(),
    caption: z.string().optional(),
  }),
  tune: tuneObj(false),
  ...chromeFields,
});

// —— 字形遮罩开场:超粗大字当遮罩,画面在笔画里流动,末段字形胀开由画面接管全屏
const textMaskSchema = z.object({
  durationSeconds: z.number().min(3.5).max(6),
  variant: z.object({takeover: z.enum(['full', 'hold']).default('full')}).optional(),
  slots: z.object({
    title: z.string(),
    image: z.string().optional(),
    imgW: z.number().int().min(1).optional(),
    imgH: z.number().int().min(1).optional(),
    caption: z.string().optional(),
  }),
  tune: tuneObj(false),
  ...chromeFields,
});

// —— 2026-08-31 lindsey 批:canvas 是横竖两档的开关(Root.calculateMetadata 解析),
//    preview 是控制台预览通道的垫底开关(透明底 preset 预览时垫深灰,导出时不传)
const canvasField = z.enum(['1080x1920', '1920x1080']).optional();
const chapterNavigationSchema = z.object({
  durationSeconds: z.number().min(2).max(30), canvas: canvasField, preview: z.boolean().optional(),
  variant: z.object({align: z.enum(['left', 'right']), bg: z.enum(['transparent', 'scene'])}).optional(),
  slots: z.object({title: z.string().optional(), items: z.array(z.string()).min(1).max(8), activeIndex: z.number().int().min(0).max(7), activateAt: z.number().min(0).max(30)}),
  tune: z.object({font: tuneFont.optional(), scale: z.number().min(.1).max(3).optional(), x: z.number().optional(), y: z.number().optional(), skin: z.enum(['abyss', 'ember', 'slate', 'paper']).optional(), accentHue: z.number().min(0).max(360).optional(), neutralHue: z.number().min(0).max(360).optional()}).optional(),
  ...chromeFields,
});
const pillStackSchema = z.object({
  durationSeconds: z.number().min(2).max(12),
  canvas: canvasField,
  preview: z.boolean().optional(),
  variant: z
    .object({
      align: z.enum(['left', 'right']).default('left'),
      bg: z.enum(['transparent', 'scene']).default('transparent'),
    })
    .optional(),
  slots: z.object({items: z.array(z.string()), title: z.string().optional()}),
  tune: tuneObj(true),
  ...chromeFields,
});
const wordCascadeSchema = z.object({
  durationSeconds: z.number().min(2.5).max(14),
  canvas: canvasField,
  preview: z.boolean().optional(),
  variant: z
    .object({
      mode: z.enum(['cascade', 'qa']).default('cascade'),
      bg: z.enum(['aurora', 'scene', 'transparent']).default('aurora'),
    })
    .optional(),
  slots: z.object({lines: z.array(z.string())}),
  tune: tuneObj(true),
  ...chromeFields,
});
const aspectEmbedSchema = z.object({
  durationSeconds: z.number().min(3).max(20),
  canvas: canvasField,
  preview: z.boolean().optional(),
  variant: z
    .object({
      ratio: z.enum(['auto', '9:16', '1:1', '4:5', '16:9']).default('auto'),
      side: z.enum(['left', 'right']).default('left'),
      textFx: z.enum(['rise', 'cascade', 'typewriter']).default('rise'),
      sound: z.enum(['off', 'keep']).default('off'),
    })
    .optional(),
  slots: z.object({
    clip: z.string(),
    srcW: z.number().int().min(1).optional(),
    srcH: z.number().int().min(1).optional(),
    srcDur: z.number().min(0.1).optional(),
    title: z.string(),
    sub: z.string().optional(),
  }),
  tune: tuneObj(true),
  ...chromeFields,
});

const mediaStageSchema=z.object({
 durationSeconds:z.number().min(1).max(3600),canvas:canvasField,
 variant:z.object({titleFace:z.enum(['smiley','serif','bold']).default('smiley'),titleFx:z.enum(['stagger','reveal','tracking']).default('stagger'),fit:z.enum(['contain','cover']).default('contain'),ratio:z.enum(['auto','16:9','9:16','1:1']).default('auto'),videoEnd:z.enum(['freeze','loop']).default('freeze'),sound:z.enum(['off','keep']).default('off')}).optional(),
 slots:z.object({title:z.string().min(1).max(36),image:z.string().optional(),clip:z.string().optional(),imgW:z.number().min(1).optional(),imgH:z.number().min(1).optional(),srcW:z.number().min(1).optional(),srcH:z.number().min(1).optional(),srcDur:z.number().positive().optional(),startSeconds:z.number().min(0).max(3600).default(0),mediaScale:z.number().min(.4).max(1.2).default(1),radius:z.number().min(0).max(80).default(18)}),
 tune:tuneObj(true),...chromeFields,
});

const behindTitleSchema=z.object({durationSeconds:z.number().min(.1).max(60),canvas:canvasField,
 slots:z.object({title:z.string().min(1).max(60),fontFamily:z.string().default('Archivo, "Noto Sans SC", sans-serif'),fontSizeRatio:z.number().min(.04).max(.65).default(.21),positionX:z.number().min(-.5).max(1.5).default(.5),positionY:z.number().min(-.5).max(1.5).default(.2),color:z.string().default('#ffffff'),enterFx:z.enum(['zoom','slide-up','slide-down','slide-left','slide-right','fade']).default('zoom'),exitFx:z.enum(['zoom','slide-up','slide-down','slide-left','slide-right','fade']).default('zoom'),enterSeconds:z.number().min(.03).max(1).default(.18),exitSeconds:z.number().min(.03).max(1).default(.15)}),tune:tuneObj(true),...chromeFields});
export const PRESET_COMPOSITIONS: PresetEntry[] = [
 {id:'PresetBehindTitle',component:PresetBehindTitle,schema:behindTitleSchema,defaultProps:{durationSeconds:3,canvas:'1920x1080',slots:{title:'M5 Max',fontFamily:'Archivo, "Noto Sans SC", sans-serif',fontSizeRatio:.21,positionX:.5,positionY:.2,color:'#ffffff',enterFx:'zoom',exitFx:'zoom',enterSeconds:.18,exitSeconds:.15},tune:{scale:1,x:0,y:0},editorBackground:'transparent',elements:{title:{}}}},
  {
    id: 'PresetChapterNavigation', component: withChrome(ChapterNavigation), schema: chapterNavigationSchema,
    defaultProps: {durationSeconds: 6, canvas: '1920x1080', variant: {align: 'left', bg: 'transparent'}, slots: {title: '4 类任务', items: ['信息监控', '学习研究', '生产', '挑毛病'], activeIndex: 0, activateAt: 1.4}, tune: {font: 'skin', scale: 1, x: 0, y: 0}, elements: {title: {}, currentTitle: {}, panel: {}, 'item-0': {}, 'item-1': {}, 'item-2': {}, 'item-3': {}}} satisfies ChapterNavigationProps,
  },
  {
    id: 'PresetRecede',
    component: withChrome(PresetRecede, true),
    schema: recedeSchema,
    defaultProps: {
      durationSeconds: 3,
      variant: {level: 3},
      slots: {line: '知识，是人类最慢的生产资料', hero: '', emphasisRanges: [], emphasisRatio: 1.6, enterFx: 'none', exitFx: 'none', enterSeconds: .5, exitSeconds: .35},
      tune: {font: 'skin' as const, scale: 1, y: 0, skin: 'abyss' as const, accentHue: 252, neutralHue: 232},
    } satisfies PresetRecedeProps,
  },
  {
    id: 'PresetKeyConcept',
    component: withChrome(PresetKeyConcept),
    schema: keyConceptSchema,
    defaultProps: {
      durationSeconds: 3.5,
      slots: {
        term: '上下文\n工程',
        en: 'CONTEXT ENGINEERING',
        sentence: '给模型的不是一句提示词,\n而是一整套工作记忆。',
        highlight: '工作记忆',
      },
      tune: {font: 'skin' as const, scale: 1, x: 0, y: 0, skin: 'abyss' as const, accentHue: 252, neutralHue: 232},
    } satisfies PresetKeyConceptProps,
  },
  {
    id: 'PresetQuoteCard',
    component: withChrome(PresetQuoteCard),
    schema: quoteCardSchema,
    defaultProps: {
      durationSeconds: 4,
      variant: {tone: 'warm'},
      slots: {
        quote: 'Most people overestimate what they\ncan do in one year and underestimate\nwhat they can do in ten years.',
        source: 'Bill Gates · The Road Ahead · 1996',
        note: '十年维度的复利,一年看不出来',
      },
      tune: {font: 'skin' as const, scale: 1, y: 0, skin: 'abyss' as const, accentHue: 252, neutralHue: 232},
    } satisfies PresetQuoteCardProps,
  },
  {
    id: 'PresetContrastPair',
    component: withChrome(PresetContrastPair),
    schema: contrastPairSchema,
    defaultProps: {
      durationSeconds: 3.5,
      variant: {symbol: '≠'},
      slots: {
        leftLabel: '堆提示词',
        leftText: '越写越长\n越改越乱',
        rightLabel: '上下文工程',
        rightText: '给对信息\n给够信息',
      },
      tune: {font: 'skin' as const, scale: 1, y: 0, skin: 'abyss' as const, accentHue: 252, neutralHue: 232},
    } satisfies PresetContrastPairProps,
  },
  {
    id: 'PresetNumberBeat',
    component: withChrome(PresetNumberBeat),
    schema: numberBeatSchema,
    defaultProps: {
      durationSeconds: 3,
      slots: {
        value: 2000,
        prefix: '$',
        label: '十年攒下的,不过是一部手机的钱。',
      },
      tune: {font: 'skin' as const, scale: 1, x: 0, y: 0, skin: 'abyss' as const, accentHue: 252, neutralHue: 232},
    } satisfies PresetNumberBeatProps,
  },
  {
    id: 'PresetCardSwarm',
    component: withChrome(PresetCardSwarm),
    schema: cardSwarmSchema,
    defaultProps: {
      durationSeconds: 5,
      variant: {mode: 'dedup' as const, cols: 5 as const},
      slots: {total: 30, keep: 4, keepLabel: '真正新增的信息', caption: '看起来有几十条,\n真正新增的只有几条。'},
      tune: {font: 'skin' as const, scale: 1, y: 0, skin: 'abyss' as const, accentHue: 252, neutralHue: 232},
    } satisfies PresetCardSwarmProps,
  },
  {
    id: 'PresetScreenPush',
    component: withChrome(PresetScreenPush),
    schema: screenPushSchema,
    defaultProps: {
      durationSeconds: 4,
      variant: {move: 'push' as const, mark: 'underline' as const, ink: 'auto' as const},
      slots: {
        image: 'sample-docs.png',
        imgW: 1140,
        imgH: 530,
        // 焦点和批注框都来自网格法(locate.mjs,2026-08-19 量的 sample-docs.png 代码块)
        focusX: 0.227,
        focusY: 0.278,
        markX: 0.227,
        markY: 0.278,
        markW: 0.164,
        markH: 0.083,
        caption: '模型名换成这一个,\n其他什么都不用动。',
        credit: 'api-docs.deepseek.com',
      },
      tune: {font: 'skin' as const, scale: 1, y: 0, skin: 'abyss' as const, accentHue: 252, neutralHue: 232},
    } satisfies PresetScreenPushProps,
  },
  {
    id: 'PresetBulletRun',
    component: withChrome(PresetBulletRun),
    schema: bulletRunSchema,
    defaultProps: {
      durationSeconds: 7,
      variant: {flow: 'walk' as const, marker: 'none' as const},
      slots: {
        title: '为什么现在动手',
        items: ['工具已经够用了', '内容比工具稀缺', '早做早有素材库'],
      },
      tune: {font: 'skin' as const, scale: 1, y: 0, skin: 'abyss' as const, accentHue: 252, neutralHue: 232},
    } satisfies PresetBulletRunProps,
  },
  {
    id: 'PresetStepFlow',
    component: withChrome(PresetStepFlow),
    schema: stepFlowSchema,
    defaultProps: {
      durationSeconds: 9,
      variant: {emphasis: 'focus' as const, marker: 'number' as const},
      slots: {
        title: '一支口播片子是怎么出来的',
        steps: [
          '写稿 | 先把话说顺,画面的事一个字都别想',
          '拆分镜 | 一句话配一个画面,配不出来的那句多半是废话',
          '套模板 | 八成的画面已经有模板,剩下两成才值得设计',
          '拼成片 | 时间轴对齐口播,末段留静止',
        ],
      },
      tune: {font: 'skin' as const, scale: 1, y: 0, skin: 'abyss' as const, accentHue: 252, neutralHue: 232},
    } satisfies PresetStepFlowProps,
  },
  {
    id: 'PresetTrendChart',
    component: withChrome(PresetTrendChart),
    schema: trendChartSchema,
    defaultProps: {
      durationSeconds: 8,
      variant: {mark: 'line' as const, yScale: 'zero' as const},
      slots: {
        headline: '四年,从 3% 到 61%',
        values: '3, 8, 19, 40, 61',
        xLabels: '2022, 2023, 2024, 2025, 2026',
        seriesName: '用 AI 做视频的创作者占比',
        unit: '%',
        note: '拐点不在技术,在它变得不用学。',
        source: '示意数据 · illustrative',
      },
      tune: {font: 'skin' as const, scale: 1, y: 0, skin: 'abyss' as const, accentHue: 252, neutralHue: 232},
    } satisfies PresetTrendChartProps,
  },
  // ==== 2026-08-20 shotcraft 移植批 ====
  {
    id: 'PresetTitleReveal',
    component: withChrome(PresetTitleReveal),
    schema: titleRevealSchema,
    defaultProps: {
      durationSeconds: 3.8,
      variant: {style: 'blur' as const},
      slots: {
        title: '把品味沉淀成组件',
        subtitle: '每个新镜头,都站在上一个的肩膀上',
        accent: '沉淀',
      },
      tune: {font: 'skin' as const, scale: 1, y: 0, skin: 'abyss' as const, accentHue: 252, neutralHue: 232},
    } satisfies PresetTitleRevealProps,
  },
  {
    id: 'PresetBrandOpen',
    component: withChrome(PresetBrandOpen),
    schema: brandOpenSchema,
    defaultProps: {
      durationSeconds: 3.5,
      variant: {style: 'letterspace' as const},
      slots: {
        wordmark: 'MOTION STUDIO',
        tagline: 'AI 驱动的动画工作台',
      },
      tune: {font: 'skin' as const, scale: 1, y: 0, skin: 'abyss' as const, accentHue: 252, neutralHue: 232},
    } satisfies PresetBrandOpenProps,
  },
  {
    id: 'PresetFlyingWords',
    component: withChrome(PresetFlyingWords),
    schema: flyingWordsSchema,
    defaultProps: {
      durationSeconds: 6,
      slots: {
        words: ['剪辑', '配色', '字体', '节奏', '转场', '卡点', '运镜', '蒙版', '调色', '音效', '分镜', '特效'],
        finale: '全都交给模板',
      },
      tune: {font: 'skin' as const, scale: 1, y: 0, skin: 'abyss' as const, accentHue: 252, neutralHue: 232},
    } satisfies PresetFlyingWordsProps,
  },
  {
    id: 'PresetCardShowcase',
    component: withChrome(PresetCardShowcase),
    schema: cardShowcaseSchema,
    defaultProps: {
      durationSeconds: 6,
      variant: {mode: 'carousel' as const},
      slots: {
        cards: ['关键概念', '数字节拍', '对比卡', '引用卡', '趋势图', '列点推进', '流程推进'],
        caption: '一句话一个画面,\n七种画面都有模板。',
      },
      tune: {font: 'skin' as const, scale: 1, y: 0, skin: 'abyss' as const, accentHue: 252, neutralHue: 232},
    } satisfies PresetCardShowcaseProps,
  },
  {
    id: 'PresetCubeNav',
    component: withChrome(PresetCubeNav),
    schema: cubeNavSchema,
    defaultProps: {
      durationSeconds: 6.5,
      slots: {
        faces: ['总览', '数据', '时间线', '素材', '设置'],
        caption: '一个工作台,五个面。',
      },
      tune: {font: 'skin' as const, scale: 1, y: 0, skin: 'abyss' as const, accentHue: 252, neutralHue: 232},
    } satisfies PresetCubeNavProps,
  },
  {
    id: 'PresetDocTypewriter',
    component: withChrome(PresetDocTypewriter),
    schema: docTypewriterSchema,
    defaultProps: {
      durationSeconds: 5,
      variant: {history: 'show' as const},
      slots: {
        docTitle: '2026-W34 · 产品周报',
        meta: '8 月 20 日 · 自动汇总 · 12 位成员',
        lines: [
          '## 本周摘要',
          '发布节奏恢复正常,两条主线按期合入。',
          '@陈默',
          '- 渲染队列重构,峰值内存降 38%',
          '@林晚',
          '- 模板预览墙上线,滚动即播零等待',
        ],
        kicker: 'WEEKLY BRIEF',
      },
      tune: {font: 'skin' as const, scale: 1, y: 0, skin: 'abyss' as const, accentHue: 252, neutralHue: 232},
    } satisfies PresetDocTypewriterProps,
  },
  {
    id: 'PresetGlassPill',
    component: withChrome(PresetGlassPill),
    schema: glassPillSchema,
    defaultProps: {
      durationSeconds: 2.5,
      variant: {icon: 'mic' as const},
      slots: {
        text: '帮我把这段口播配上画面',
        caption: '说一句话,画面自己长出来。',
      },
      tune: {font: 'skin' as const, scale: 1, y: 0, skin: 'abyss' as const, accentHue: 252, neutralHue: 232},
    } satisfies PresetGlassPillProps,
  },
  {
    id: 'PresetPhoneRipple',
    component: withChrome(PresetPhoneRipple),
    schema: phoneRippleSchema,
    defaultProps: {
      durationSeconds: 5.6,
      slots: {
        chips: ['自动分镜', '模板匹配', '一键出片'],
        caption: '三步,从口播稿到成片。',
      },
      tune: {font: 'skin' as const, scale: 1, y: 0, skin: 'abyss' as const, accentHue: 252, neutralHue: 232},
    } satisfies PresetPhoneRippleProps,
  },
  {
    id: 'PresetSegmentedThumb',
    component: withChrome(PresetSegmentedThumb),
    schema: segmentedThumbSchema,
    defaultProps: {
      durationSeconds: 3.7,
      variant: {land: 'right' as const},
      slots: {
        leftLabel: '手搓',
        rightLabel: '模板',
        caption: '同一个镜头,两种成本。',
      },
      tune: {font: 'skin' as const, scale: 1, y: 0, skin: 'abyss' as const, accentHue: 252, neutralHue: 232},
    } satisfies PresetSegmentedThumbProps,
  },
  // ==== 2026-08-26 shotcraft 第二批移植 ====
  {
    id: 'PresetSpaceSteps',
    component: withChrome(PresetSpaceSteps),
    schema: spaceStepsSchema,
    defaultProps: {
      durationSeconds: 7,
      variant: {spin: 'on' as const},
      slots: {
        steps: ['先把话说顺 | 画面的事一个字都别想', '一句话一个画面 | 配不出来的那句多半是废话', '八成套模板 | 剩下两成才值得设计'],
        overview: '三步,一支片子',
        caption: '不是翻页,是在想法的空间里走一趟。',
      },
      tune: {font: 'skin' as const, scale: 1, y: 0, skin: 'abyss' as const, accentHue: 252, neutralHue: 232},
    } satisfies PresetSpaceStepsProps,
  },
  {
    id: 'PresetTimelineTravel',
    component: withChrome(PresetTimelineTravel),
    schema: timelineTravelSchema,
    defaultProps: {
      durationSeconds: 5.5,
      slots: {
        title: '一年半,四个版本',
        stops: ['v1.0 | 只能套三个模板', 'v2.0 | 会自己分镜了', 'v3.0 | 字幕能改了', '今天 | 一句话出片'],
        caption: '一直在发货。',
      },
      tune: {font: 'skin' as const, scale: 1, y: 0, skin: 'abyss' as const, accentHue: 252, neutralHue: 232},
    } satisfies PresetTimelineTravelProps,
  },
  {
    id: 'PresetTextMask',
    component: withChrome(PresetTextMask),
    schema: textMaskSchema,
    defaultProps: {
      durationSeconds: 5,
      variant: {takeover: 'full' as const},
      // 样例刻意**不填 image**:漂移窗口只覆盖源图的一条窄带,单张真实截图能不能
      // 在 460px 的笔画里读出"界面"全看那条带上是什么(实测落进大片留白 → 字读作
      // 纯白;暗色截图 → 字直接消失)。样例是控制台里这个模板的门面,必须每次都好看,
      // 所以走可控的产品界面骨架流;真实使用时照旧可以给截图。
      slots: {
        title: '出片',
        caption: '字是门,产品在门里。',
      },
      tune: {font: 'skin' as const, scale: 1, y: 0, skin: 'abyss' as const, accentHue: 252, neutralHue: 232},
    } satisfies PresetTextMaskProps,
  },
  {
    id: 'PresetPillStack',
    component: withChrome(PresetPillStack),
    schema: pillStackSchema,
    defaultProps: {
      durationSeconds: 4.5,
      // 样例走 preview:true —— 这个 preset 默认透明底,不垫演播室底的话
      // Studio/样例循环片里就是一片黑,看不出它是要叠在实拍上的
      preview: true,
      variant: {align: 'left' as const, bg: 'transparent' as const},
      slots: {title: '好习惯的三个标准', items: ['简单可持续', '随时捡得起来', '不靠意志力']},
      tune: {font: 'skin' as const, scale: 1, x: 0, y: 0, skin: 'abyss' as const, accentHue: 252, neutralHue: 232},
    } satisfies PresetPillStackProps,
  },
  {
    id: 'PresetWordCascade',
    component: withChrome(PresetWordCascade),
    schema: wordCascadeSchema,
    defaultProps: {
      durationSeconds: 6,
      variant: {mode: 'cascade' as const, bg: 'aurora' as const},
      slots: {lines: ['你是怎么 坚持下来的?', '其实 根本 不靠 坚持']},
      tune: {font: 'skin' as const, scale: 1, x: 0, y: 0, skin: 'abyss' as const, accentHue: 252, neutralHue: 232},
    } satisfies PresetWordCascadeProps,
  },
  {
    id: 'PresetAspectEmbed',
    component: withChrome(PresetAspectEmbed),
    schema: aspectEmbedSchema,
    defaultProps: {
      durationSeconds: 5,
      canvas: '1920x1080',
      variant: {ratio: 'auto' as const, side: 'left' as const, textFx: 'rise' as const, sound: 'off' as const},
      // 样例引用模板自带的演示竖版片段(public/footage/demo-vertical.mp4,构建脚本生成);
      // 真实使用时控制台装载用户素材并自动填 srcW/srcH/srcDur
      slots: {
        clip: 'demo-vertical.mp4',
        srcW: 540,
        srcH: 960,
        srcDur: 4,
        title: '竖屏素材\n也能进横片',
        sub: '各种画幅,镶着用',
      },
      tune: {font: 'skin' as const, scale: 1, x: 0, y: 0, skin: 'abyss' as const, accentHue: 252, neutralHue: 232},
    } satisfies PresetAspectEmbedProps,
  },
  {
    id:'PresetMediaStage',component:withChrome(PresetMediaStage),schema:mediaStageSchema,
    defaultProps:{durationSeconds:6,canvas:'1920x1080',sceneBackground:{type:'wall-a'},editorBackground:'original',
      variant:{titleFace:'smiley',titleFx:'stagger',fit:'contain',ratio:'auto',videoEnd:'freeze',sound:'off'},
      slots:{title:'人物定妆参考',image:'media-stage-character.png',imgW:1536,imgH:1024,clip:'',startSeconds:0,mediaScale:1,radius:18},
      tune:{font:'skin',scale:1,x:0,y:0,skin:'abyss',accentHue:75,neutralHue:232}},
  },

];
