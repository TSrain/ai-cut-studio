// tools/lib/knowledge-router.mjs
//
// 三道闸门叠加,都由 manifest 声明、不在这里写死:
//   maxDynamic       —— 动态资源条数上限(默认 4)
//   maxContextTokens —— 动态资源的 token 预算(缺省 Infinity;entry 没写 estimatedTokens 记 0)
//   exclusiveKinds   —— 互斥类别(缺省 []):同一 kind 最多进一条,priority 高的赢
// 预算按 priority 顺序装包:装不下的跳过、继续试更小的(而不是就地截断),
// 这样一份大文档不会把后面本来装得下的小 recipe 全部挤掉。排序确定,结果确定。
//
// requiredTags:entry 声明了它,镜头 tags 必须**全部包含**才路由。
// 与 tags 的「任一重合即候选」不同,这是给强专用资源用的——
// 例:remotion-captions 曾因带 type/audio 标签被路由进一堆无字幕镜头,
// 每镜白吃 ~3k tokens;写 requiredTags:["caption"] 后只有明确标了 caption 的镜才加载它。
//
// exclusiveKinds 的由来:风格卡按标签路由,一个 `layout,brand,type` 的镜同时匹配
// brand-energy 和 visual-max,两份卡的密度/留白阈值不一样,worker 拿到互相打架的两套数字。
// 真正的准源是**合同的 `profile` 字段**——路由器看不到合同,所以这里只保证"最多一条",
// 与合同不一致时以合同为准(`docs/knowledge-routing.md`)。
export const routeKnowledge = (
  entries,
  {engine, tags, maxDynamic = 4, maxContextTokens = Infinity, exclusiveKinds = []},
) => {
  const always = entries.filter((entry) => entry.always).sort((a, b) => b.priority - a.priority);
  const candidates = entries
    .filter((entry) => !entry.always)
    .filter((entry) => entry.engines.includes('both') || entry.engines.includes(engine))
    .filter((entry) => entry.tags.some((tag) => tags.includes(tag)))
    .filter((entry) => (entry.requiredTags ?? []).every((tag) => tags.includes(tag)))
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  return [...always, ...packWithinBudget(candidates, {maxDynamic, maxContextTokens, exclusiveKinds})];
};

const packWithinBudget = (candidates, {maxDynamic, maxContextTokens, exclusiveKinds = []}) => {
  const picked = [];
  const usedKinds = new Set();
  let budget = maxContextTokens;
  for (const entry of candidates) {
    if (picked.length >= maxDynamic) break;
    // 互斥类别:candidates 已按 priority 降序,所以先到的那条就是该类别里优先级最高的。
    if (exclusiveKinds.includes(entry.kind) && usedKinds.has(entry.kind)) continue;
    const cost = Number(entry.estimatedTokens ?? 0);
    if (cost > budget) continue;
    picked.push(entry);
    usedKinds.add(entry.kind);
    budget -= cost;
  }
  return picked;
};

export const ENGINES = ['remotion', 'hyperframes', 'hybrid'];

// Hybrid 镜头同时含 Remotion 层与 HyperFrames 层,两个引擎的知识都要给。
// 上限仍是 maxDynamic / maxContextTokens —— hybrid 取并集后按同一套装包规则截,不放宽。
export const routeKnowledgeForEngine = (
  entries,
  {engine, tags, maxDynamic = 4, maxContextTokens = Infinity, exclusiveKinds = []},
) => {
  if (!ENGINES.includes(engine)) {
    throw new TypeError(`engine must be one of ${ENGINES.join('|')}, got "${engine}"`);
  }
  if (engine !== 'hybrid') {
    return routeKnowledge(entries, {engine, tags, maxDynamic, maxContextTokens, exclusiveKinds});
  }
  const always = entries.filter((entry) => entry.always).sort((a, b) => b.priority - a.priority);
  const seen = new Set();
  const merged = [];
  for (const candidate of [
    ...routeKnowledge(entries, {engine: 'remotion', tags, maxDynamic: Infinity}).filter((x) => !x.always),
    ...routeKnowledge(entries, {engine: 'hyperframes', tags, maxDynamic: Infinity}).filter((x) => !x.always),
  ]) {
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    merged.push(candidate);
  }
  merged.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  return [...always, ...packWithinBudget(merged, {maxDynamic, maxContextTokens, exclusiveKinds})];
};

// 一份路由结果的预计输入体量(always + 动态),给 CLI / dispatch 打印用。
export const estimateRoutedTokens = (routed) =>
  routed.reduce((sum, entry) => sum + Number(entry.estimatedTokens ?? 0), 0);
