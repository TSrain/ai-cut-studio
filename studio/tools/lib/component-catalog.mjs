// tools/lib/component-catalog.mjs
const ENGINES = new Set(['remotion', 'hyperframes']);
const KINDS = new Set(['component', 'block', 'adapter', 'recipe']);
const COSTS = new Set(['low', 'medium', 'high']);

// `params` / `pitfalls` —— 目录从"有什么组件"升级成"怎么调这个组件"的那两个字段。
//
// 为什么必须放在 JSON 而不是只写在 docs/component-catalog.md:
// dispatch 的 Component shortlist 是从**这份 JSON**算出来的,散文表 worker 根本读不到。
// 2026-08-19 查出来的实况是:15 个表达型组件里 13 个连条目都没有,
// 于是 KenBurns / ContrastColumns / SkeletonCard 这些最常用的组件在机器路径上完全隐身——
// 「写镜头前先查 shortlist」这条规矩因此长期形同虚设,每个新镜头都在手搓。
//
// 强制方式是**棘轮**:新条目一律必填,老条目列进 LEGACY_WITHOUT_GUIDANCE 豁免。
// 这份名单只许变短,不许变长。往里加名字 = 又欠了一笔,不是通过了检查。
export const requiresGuidance = (entry) =>
  entry.engine === 'remotion' && (entry.kind === 'component' || entry.kind === 'recipe');

export const validateCatalog = (entries) => {
  const errors = [];
  if (!Array.isArray(entries)) return {ok: false, errors: ['catalog must be an array']};
  const seen = new Set();
  entries.forEach((entry, index) => {
    const p = `entries[${index}]`;
    if (!entry.id || typeof entry.id !== 'string') errors.push(`${p}.id is required`);
    else if (seen.has(entry.id)) errors.push(`${p}.id is duplicated`);
    else seen.add(entry.id);
    if (!ENGINES.has(entry.engine)) errors.push(`${p}.engine is invalid`);
    if (!KINDS.has(entry.kind)) errors.push(`${p}.kind is invalid`);
    if (!Array.isArray(entry.tags) || entry.tags.length === 0) errors.push(`${p}.tags must not be empty`);
    if (!entry.source) errors.push(`${p}.source is required`);
    if (!entry.thumbnail) errors.push(`${p}.thumbnail is required`);
    if (typeof entry.verified !== 'boolean') errors.push(`${p}.verified must be boolean`);
    if (typeof entry.seekSafe !== 'boolean') errors.push(`${p}.seekSafe must be boolean`);
    if (!COSTS.has(entry.cost)) errors.push(`${p}.cost is invalid`);
    if (!Array.isArray(entry.canvas) || entry.canvas.length === 0) errors.push(`${p}.canvas must not be empty`);
    // params/pitfalls 是可选字段,但**写了就必须写对**——半条参数表比没有更坏,
    // 它会让 worker 以为查过了。必填与否由棘轮名单在测试层裁决,不在这里拦。
    if (entry.params !== undefined) {
      if (!Array.isArray(entry.params) || entry.params.length === 0) {
        errors.push(`${p}.params must be a non-empty array`);
      } else {
        entry.params.forEach((item, i) => {
          if (!item || typeof item !== 'object') errors.push(`${p}.params[${i}] must be an object`);
          else {
            if (!item.name) errors.push(`${p}.params[${i}].name is required`);
            if (!item.typical) errors.push(`${p}.params[${i}].typical is required`);
            // feel = 调大调小画面会怎样。少了它这行就退化成"这个组件有这个参数",
            // 等于没写——参数名从类型签名里本来就读得到。
            if (!item.feel) errors.push(`${p}.params[${i}].feel is required (调大调小画面会怎样)`);
          }
        });
      }
    }
    if (entry.pitfalls !== undefined) {
      if (!Array.isArray(entry.pitfalls) || entry.pitfalls.length === 0) {
        errors.push(`${p}.pitfalls must be a non-empty array`);
      } else if (entry.pitfalls.some((item) => typeof item !== 'string' || item.trim() === '')) {
        errors.push(`${p}.pitfalls entries must be non-empty strings`);
      }
    }
  });
  return {ok: errors.length === 0, errors};
};

export const filterComponents = (entries, {engine, tags = [], max = 3}) => entries
  .filter((entry) => !engine || entry.engine === engine)
  .filter((entry) => tags.every((tag) => entry.tags.includes(tag)))
  .slice(0, max);

// 派发用的候选清单,和 filterComponents 的 AND 语义不同:这里按**标签重合度**排序取前 max 条。
// 为什么要它:worker 过去被要求「写任何新镜头之前读 docs/catalog/components.json」,
// 那是 46 条全表约 6600 tokens,而一镜真正用得上的通常不到 10 条。
// 把重合度最高的几条直接写进 dispatch,worker 默认就够用;不够用时再去读全表。
// 排序稳定(重合度 → verified → cost → id),同样的输入永远得到同样的清单。
const COST_ORDER = {low: 0, medium: 1, high: 2};

export const shortlistComponents = (entries, {engine, tags = [], max = 10}) => {
  const wanted = new Set(tags);
  const engines = engine === 'hybrid' ? ['remotion', 'hyperframes'] : [engine];
  return entries
    .filter((entry) => !engine || engines.includes(entry.engine))
    .map((entry) => ({entry, overlap: entry.tags.filter((tag) => wanted.has(tag)).length}))
    .filter((item) => item.overlap > 0)
    .sort(
      (a, b) =>
        b.overlap - a.overlap ||
        Number(b.entry.verified) - Number(a.entry.verified) ||
        (COST_ORDER[a.entry.cost] ?? 9) - (COST_ORDER[b.entry.cost] ?? 9) ||
        a.entry.id.localeCompare(b.entry.id),
    )
    .slice(0, max)
    .map((item) => item.entry);
};
