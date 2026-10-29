export type EditablePresetPart = {id: string; label: string; slotKey?: string; index?: number; segment?: number; separator?: string; listSeparator?: string};
type PartTemplate = EditablePresetPart & {array?: string; limit?: number};
/** These components already implement real width/height-dependent layout. */
export const RESPONSIVE_PRESET_IDS = new Set(["behind-title", "media-stage", "aspect-embed", "brand-open", "bullet-run", "card-showcase", "card-swarm", "contrast-pair", "cube-nav", "doc-typewriter", "flying-words", "glass-pill", "key-concept", "number-beat", "phone-ripple", "pill-stack", "quote-card", "recede", "screen-push", "segmented-thumb", "space-steps", "step-flow", "text-mask", "timeline-travel", "title-reveal", "trend-chart", "word-cascade", "chapter-navigation"]);
const text = (id: string, label: string, slotKey = id): PartTemplate => ({id, label, slotKey});
const rows = (id: string, label: string, slotKey: string, limit: number, segment?: number): PartTemplate => ({id, label, slotKey, array: slotKey, limit, ...(segment === undefined ? {} : {segment, separator: '|'})});

/** Names match real render nodes. N templates are expanded against current slots. */
export const EDITABLE_PRESET_PARTS: Record<string, readonly PartTemplate[]> = {
  'behind-title': [text('title','身后大字')],
  'media-stage': [text('title', '标题')],
  'aspect-embed': [text('title', '标题'), text('sub', '副标题')],
  'brand-open': [text('wordmark', '品牌文字'), text('tagline', '标语')],
  'bullet-run': [text('title', '标题'), text('eyebrow', '眉题'), rows('item-N-head', '要点', 'items', 6, 0), rows('item-N-note', '补充', 'items', 6, 1)],
  'card-showcase': [rows('card-N-title', '卡片标题', 'cards', 100, 0), rows('card-N-note', '卡片说明', 'cards', 100, 1), text('caption', '说明')],
  'card-swarm': [text('eyebrow', '眉题'), text('keepLabel', '保留标签'), text('caption', '说明')],
  'contrast-pair': [text('leftLabel', '左侧标签'), text('leftText', '左侧正文'), text('rightLabel', '右侧标签'), text('rightText', '右侧正文'), text('eyebrow', '眉题')],
  'cube-nav': [rows('face-N', '立方面文字', 'faces', 6), text('caption', '说明')],
  'doc-typewriter': [text('docTitle', '文档标题'), text('meta', '元信息'), rows('line-N', '文档行', 'lines', 10), text('kicker', '页脚')],
  'flying-words': [rows('word-N', '飞行文字', 'words', 100), text('finale', '收尾文字')],
  'glass-pill': [text('text', '胶囊文字'), text('caption', '说明')],
  'key-concept': [text('term', '核心概念'), text('en', '英文标签'), text('sentence', '解释'), text('eyebrow', '眉题')],
  'number-beat': [text('number', '数字', 'value'), text('unit', '单位', 'suffix'), text('label', '说明'), text('eyebrow', '眉题')],
  'phone-ripple': [rows('chip-N', '标签', 'chips', 5), text('caption', '说明')],
  'pill-stack': [text('title', '标题'), rows('item-N', '标签', 'items', 100)],
  'quote-card': [text('quote', '引用'), text('source', '来源'), text('note', '注释'), text('noteTag', '注释标签')],
  'recede': [text('line', '正文')],
  'screen-push': [text('eyebrow', '眉题'), text('caption', '说明'), text('credit', '来源')],
  'segmented-thumb': [text('leftLabel', '左侧文字'), text('rightLabel', '右侧文字'), text('caption', '说明')],
  'space-steps': [rows('step-N-head', '步骤标题', 'steps', 4, 0), rows('step-N-note', '步骤说明', 'steps', 4, 1), text('overview', '总览'), text('caption', '说明')],
  'step-flow': [text('title', '标题'), text('eyebrow', '眉题'), rows('step-N-head', '步骤标题', 'steps', 6, 0), rows('step-N-note', '步骤说明', 'steps', 6, 1)],
  'text-mask': [text('title', '文字遮罩'), text('caption', '说明')],
  'timeline-travel': [rows('stop-N-head', '站点标题', 'stops', 5, 0), rows('stop-N-note', '站点说明', 'stops', 5, 1), text('title', '标题'), text('caption', '说明')],
  'title-reveal': [text('title', '标题'), text('subtitle', '副标题')],
  'trend-chart': [text('headline', '结论'), text('eyebrow', '眉题'), text('note', '说明'), text('source', '来源'), {...rows('xLabel-N', '横轴标签', 'xLabels', 100), listSeparator: ','}, {id: 'value-labels', label: '数据标签'}, {id: 'y-labels', label: '纵轴刻度'}],
  'word-cascade': [rows('line-N', '句子', 'lines', 100)],
};

export const resolveEditableParts = (assetId: string, props: Record<string, any>): EditablePresetPart[] => {
  const slots = props.slots ?? {};
  return (EDITABLE_PRESET_PARTS[assetId] ?? []).flatMap(({array, limit, ...part}) => {
    if (!array) return [part];
    const value = slots[array];
    const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(part.listSeparator === ',' ? /[,，、]+/ : '|').map((item) => item.trim()).filter(Boolean) : [];
    // These templates discard empty rows before assigning their visible node ids.
    // Keep the source array index separately so the inspector edits the right row.
    const indexed = items.map((item, index) => ({item, index}));
    const visible = ['bullet-run', 'step-flow', 'timeline-travel', 'word-cascade'].includes(assetId) ? indexed.filter(({item}) => String(item).trim() !== '') : indexed;
    return visible.slice(0, limit).map(({index}, visibleIndex) => ({...part, id: part.id.replace('N', String(visibleIndex)), label: `${part.label} ${visibleIndex + 1}`, index}));
  });
};
