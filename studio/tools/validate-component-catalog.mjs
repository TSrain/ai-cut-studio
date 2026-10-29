#!/usr/bin/env node
// tools/validate-component-catalog.mjs
// 用法: node tools/validate-component-catalog.mjs docs/catalog/components.json
// 读入 JSON 目录文件,打印全部错误;有错 exit 1,通过则打印 PASS component catalog: <N> entries
import {readFile} from 'node:fs/promises';
import {validateCatalog} from './lib/component-catalog.mjs';

const file = process.argv[2] ?? 'docs/catalog/components.json';

let entries;
try {
  entries = JSON.parse(await readFile(file, 'utf8'));
} catch (error) {
  console.error(`FAIL component catalog: cannot read ${file}`);
  console.error(`  ${error.message}`);
  process.exit(1);
}

const {ok, errors} = validateCatalog(entries);

if (!ok) {
  console.error(`FAIL component catalog: ${errors.length} error(s) in ${file}`);
  for (const message of errors) console.error(`  - ${message}`);
  process.exit(1);
}

console.log(`PASS component catalog: ${entries.length} entries`);
