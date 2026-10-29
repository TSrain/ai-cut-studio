#!/usr/bin/env node
// tools/route-knowledge.mjs
// 用法: node tools/route-knowledge.mjs <remotion|hyperframes|hybrid> <逗号分隔tags>
// 输出: 一行一个资源(docs/ 路径或 skill:<name>),第一行永远是 always-on 短合同。
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {ENGINES, routeKnowledgeForEngine, estimateRoutedTokens} from './lib/knowledge-router.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [engine, rawTags] = process.argv.slice(2);

if (!engine || !rawTags) {
  console.error('Usage: node tools/route-knowledge.mjs <remotion|hyperframes|hybrid> <comma-separated-tags>');
  process.exit(2);
}
if (!ENGINES.includes(engine)) {
  console.error(`engine must be one of ${ENGINES.join('|')}, got "${engine}"`);
  process.exit(2);
}

const tags = rawTags.split(',').map((tag) => tag.trim()).filter(Boolean);
if (tags.length === 0) {
  console.error('at least one tag is required');
  process.exit(2);
}

try {
  const manifest = JSON.parse(await readFile(resolve(root, 'docs/knowledge-manifest.json'), 'utf8'));
  const maxDynamic = Number(manifest.maxDynamic ?? 4);
  const maxContextTokens = Number(manifest.maxContextTokens ?? Infinity);
  const exclusiveKinds = manifest.exclusiveKinds ?? [];
  const routed = routeKnowledgeForEngine(manifest.entries, {engine, tags, maxDynamic, maxContextTokens, exclusiveKinds});
  for (const entry of routed) {
    console.log(entry.resource);
  }
  const dynamic = routed.filter((entry) => !entry.always);
  console.error(
    `[route-knowledge] 动态 ${dynamic.length} 条 ~${estimateRoutedTokens(dynamic)} tokens(预算 ${maxContextTokens});` +
      `含 always-on 合计 ~${estimateRoutedTokens(routed)}`,
  );
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
