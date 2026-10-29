#!/usr/bin/env node
// tools/sync-hyperframes-catalog.mjs
//
// 用途:把 docs/catalog/components.json 里 engine=hyperframes 的条目,逐个对着
// HyperFrames 官方 registry manifest 核一遍名字和类型,结果钉进
// templates/hyperframes-base/registry-lock.json。
//
// 用法:
//   node tools/sync-hyperframes-catalog.mjs [--strict] [--offline <manifest.json>]
//
// 退出码:
//   0  全部 id 在官方 registry 找到,类型正常,且与已有 lock 一致
//   1  有 id 消失 / 类型异常 / 类型与已有 lock 不一致 / (--strict 时) 类型与
//      catalog 的 kind 字段不一致
//
// 硬规则:本脚本**只读** docs/catalog/components.json,绝不改写那 28 个 id 的选择。
//   对不上就报出来让人处理,不许自动"修正"。
//
// 时间戳说明:lock 里的 retrievedAt 是采集元数据(它记录"这份名单是什么时候
//   从网上抓的"),不参与任何渲染路径。渲染代码里一律不许出现时间/随机数。
import {readFile, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = path.join(REPO, 'docs/catalog/components.json');
const LOCK = path.join(REPO, 'templates/hyperframes-base/registry-lock.json');
const MANIFEST_URL =
  'https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry/registry.json';

const TYPE_PREFIX = 'hyperframes:';
const ALLOWED_TYPES = new Set(['block', 'component']);

const argv = process.argv.slice(2);
const strict = argv.includes('--strict');
const offlineIndex = argv.indexOf('--offline');
const offlineFile = offlineIndex === -1 ? null : argv[offlineIndex + 1];

/** 官方 manifest 的 type 形如 "hyperframes:block",这里剥成 "block" */
function shortType(type) {
  return typeof type === 'string' && type.startsWith(TYPE_PREFIX)
    ? type.slice(TYPE_PREFIX.length)
    : type;
}

async function loadManifest() {
  if (offlineFile) {
    return {source: offlineFile, data: JSON.parse(await readFile(offlineFile, 'utf8'))};
  }
  const response = await fetch(MANIFEST_URL, {headers: {accept: 'application/json'}});
  if (!response.ok) {
    throw new Error(`manifest HTTP ${response.status} ${response.statusText}`);
  }
  return {source: MANIFEST_URL, data: await response.json()};
}

async function main() {
  const entries = JSON.parse(await readFile(CATALOG, 'utf8'));
  const approved = entries.filter((entry) => entry.engine === 'hyperframes');
  if (approved.length === 0) {
    console.error('FAIL hyperframes sync: catalog 里没有 engine=hyperframes 的条目');
    process.exit(1);
  }

  const {source, data} = await loadManifest();
  const items = Array.isArray(data?.items) ? data.items : null;
  if (!items) {
    console.error(`FAIL hyperframes sync: manifest 结构异常(没有 items 数组)@ ${source}`);
    process.exit(1);
  }
  const registry = new Map(items.map((item) => [item.name, shortType(item.type)]));

  let previous = null;
  if (existsSync(LOCK)) {
    try {
      previous = JSON.parse(await readFile(LOCK, 'utf8'));
    } catch {
      previous = null;
    }
  }
  const previousTypes = new Map(
    (previous?.items ?? []).map((item) => [item.name, item.type]),
  );

  const errors = [];
  const warnings = [];
  const locked = [];

  for (const entry of approved) {
    const registryType = registry.get(entry.id);

    if (registryType === undefined) {
      errors.push(`${entry.id}: 在官方 registry 中不存在(id 消失或改名)`);
      continue;
    }
    if (!ALLOWED_TYPES.has(registryType)) {
      errors.push(
        `${entry.id}: registry type = "${registryType}",不是 block/component(类型异常)`,
      );
      continue;
    }

    const before = previousTypes.get(entry.id);
    if (before && before !== registryType) {
      errors.push(`${entry.id}: 类型从 lock 里的 "${before}" 变成了 "${registryType}"`);
      continue;
    }

    // catalog 的 kind 只是 Task 1 按名字预填的猜测,与 registry 不一致时只警告,
    // 由人(主 agent)去改 components.json —— 本脚本不写 catalog。
    if (entry.kind && entry.kind !== registryType) {
      warnings.push(
        `${entry.id}: catalog kind="${entry.kind}" 但 registry type="${registryType}"`,
      );
    }

    locked.push({name: entry.id, type: registryType});
  }

  const found = locked.length;
  console.log(`hyperframes registry sync — manifest: ${source}`);
  console.log(`  approved ids: ${approved.length}`);
  console.log(`  found in registry: ${found}`);
  console.log(`  missing / abnormal: ${approved.length - found}`);
  const blocks = locked.filter((item) => item.type === 'block').length;
  console.log(`  types: block=${blocks} component=${locked.length - blocks}`);

  if (warnings.length > 0) {
    console.log(`  kind 与 catalog 不一致(仅提示,不改 catalog): ${warnings.length}`);
    for (const message of warnings) console.log(`    ! ${message}`);
  }

  if (errors.length > 0) {
    console.error(`FAIL hyperframes sync: ${errors.length} 个问题`);
    for (const message of errors) console.error(`  - ${message}`);
    process.exit(1);
  }
  if (strict && warnings.length > 0) {
    console.error(`FAIL hyperframes sync (--strict): ${warnings.length} 个 kind 不一致`);
    process.exit(1);
  }

  const lock = {
    manifestUrl: MANIFEST_URL,
    retrievedAt: new Date().toISOString(),
    registryName: data?.name ?? null,
    manifestItemCount: items.length,
    approvedCount: approved.length,
    catalogKindMismatch: warnings,
    items: locked.sort((a, b) => a.name.localeCompare(b.name)),
  };
  await writeFile(LOCK, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  console.log(`PASS hyperframes sync: ${found}/${approved.length} → ${path.relative(REPO, LOCK)}`);
}

main().catch((error) => {
  console.error(`FAIL hyperframes sync: ${error.message}`);
  process.exit(1);
});
