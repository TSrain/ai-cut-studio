import { GENERATED_PRESET_CATALOG } from "../../templates/remotion-base/src/editor/preset-catalog.generated";

const catalog = new Map(
  GENERATED_PRESET_CATALOG.map((asset) => [asset.id, asset]),
);

const FIELD_LABELS: Record<string, string> = {
  thickness: "进度条厚度",
  gap: "章节间距",
  showLabels: "显示章节标题",
  completedColor: "已完成颜色",
  activeColor: "当前进度颜色",
  futureColor: "未完成颜色",
  "tune.x": "横向偏移",
  "tune.y": "纵向偏移",
  "tune.scale": "整体缩放",
  "tune.font": "字体",
  "tune.skin": "配色皮肤",
  "tune.accentHue": "强调色色相",
  "tune.neutralHue": "底色色相",
  history: "历史记录",
  land: "落定位置",
  spin: "旋转",
  takeover: "画面占位",
  style: "动画风格",
};

const OPTION_LABELS: Record<string, string> = {
  bold: "设计粗黑",
  stagger: "逐字错峰上浮", reveal: "整体向上揭示", tracking: "字距收拢",
  contain: "完整展示", cover: "铺满裁切", freeze: "停留末帧", loop: "循环播放",
  auto: "自动判断",
  left: "左侧",
  right: "右侧",
  rise: "逐行上浮",
  cascade: "逐词飞入",
  typewriter: "打字机",
  off: "关闭",
  on: "开启",
  keep: "保留原声",
  letterspace: "字距展开",
  ink: "墨印显形",
  walk: "逐条推进",
  stack: "依次堆叠",
  none: "无",
  number: "数字",
  dot: "圆点",
  check: "对勾",
  fan: "扇形展开",
  carousel: "轮播",
  dedup: "去重",
  filter: "筛选",
  transparent: "透明底",
  scene: "场景底",
  show: "显示",
  mic: "麦克风",
  search: "搜索",
  sparkle: "闪光",
  confetti: "彩纸庆祝",
  warm: "暖色",
  cool: "冷色",
  push: "推进",
  pull: "拉远",
  pan: "平移巡览",
  static: "静止",
  graze: "贴边掠过",
  underline: "下划线",
  marker: "荧光笔",
  circle: "圈选",
  box: "方框",
  red: "红色",
  yellow: "黄色",
  accent: "跟随强调色",
  focus: "突出当前步",
  even: "均匀展示",
  full: "铺满画面",
  hold: "居中停留",
  blur: "模糊显现",
  brace: "括号展开",
  line: "折线图",
  area: "面积图",
  bar: "柱状图",
  zero: "从零开始",
  tight: "贴近数据范围",
  qa: "问答切换",
  aurora: "极光底",
  original: "保留模板背景",
  serif: "衬线体",
  smiley: "得意黑",
  archivo: "Archivo 西文字体",
  wenkai: "霞鹜文楷",
  "noto-serif": "思源宋体",
  skin: "跟随模板",
};

const SPECIFIC_OPTIONS: Record<string, string> = {
  "contrast-pair:symbol:≠": "不等于 ≠",
  "contrast-pair:symbol:→": "转向 →",
  "contrast-pair:symbol:VS": "对比 VS",
  "recede:level:1": "轻微压暗",
  "recede:level:2": "中度压暗",
  "recede:level:3": "明显压暗",
  "recede:level:4": "最深压暗",
  "card-swarm:cols:4": "四列",
  "card-swarm:cols:5": "五列",
  "card-swarm:cols:6": "六列",
};

const stripSection = (key: string) => key.replace(/^(slots|variant)\./, "");

export function labelForField(
  assetId: string,
  key: string,
  fallback?: string,
): string {
  const plain = stripSection(key);
  const asset: any = catalog.get(assetId as any);
  const descriptor: any = asset?.slots?.[plain] ?? asset?.variants?.[plain];
  const label =
    descriptor && "label" in descriptor ? descriptor.label : undefined;
  return (
    label || FIELD_LABELS[key] || FIELD_LABELS[plain] || fallback || "编辑内容"
  );
}

export function labelForOption(
  assetId: string,
  key: string,
  value: unknown,
): string {
  const raw = String(value);
  return (
    SPECIFIC_OPTIONS[`${assetId}:${stripSection(key)}:${raw}`] ||
    OPTION_LABELS[raw] ||
    (/^\d+:\d+$/.test(raw)
      ? `${raw} 画幅`
      : /^\d+(\.\d+)?$/.test(raw)
        ? `数值 ${raw}`
        : `选项 ${raw}`)
  );
}

export const FONT_OPTIONS = [
  { value: "", label: "跟随资产" },
  { value: "Inter", label: "Inter 西文无衬线" },
  { value: "Archivo", label: "Archivo 西文展示体" },
  { value: "Noto Sans SC", label: "思源黑体" },
  { value: "Noto Serif SC", label: "思源宋体" },
  { value: "Smiley Sans", label: "得意黑" },
  { value: "LXGW WenKai", label: "霞鹜文楷" },
] as const;
