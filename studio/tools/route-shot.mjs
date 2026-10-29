#!/usr/bin/env node
// tools/route-shot.mjs
import {readFile} from 'node:fs/promises';
import {routeShot} from './lib/engine-router.mjs';

const path = process.argv[2];
if (!path) {
  console.error('Usage: node tools/route-shot.mjs <signals.json>');
  process.exit(2);
}
try {
  const result = routeShot(JSON.parse(await readFile(path, 'utf8')));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
