#!/usr/bin/env node
// tools/render-queue.mjs
//
// Bounded browser render queue (spec §12.2).
//
// The concurrency cap here constrains ONLY the formal browser render queue
// (default 2, drop to 1 when memory is tight). It must never be used as an
// excuse to cut shots, and it does not constrain proposal / asset / code /
// review parallelism — those run as wide as the harness allows.
//
// Completion is measured by artifacts, not by claims: an item passes only when
// its process exits 0 AND `expectedOutput` exists and is non-empty. A worker
// that says "done" while writing a 0-byte file is a failure.
//
// Child output is NEVER inherited: Remotion/FFmpeg progress bars are thousands
// of lines of carriage-return spam that would otherwise flood the caller's
// context. Full logs go to <queue>.logs/<id>.log; a passing item prints one
// summary line, a failing item additionally prints the last 40 log lines.
//
// Usage: node tools/render-queue.mjs <queue.json> [--concurrency 1|2]
//                                    [--require-confirmed <preview-manifest.json>]
//
// --require-confirmed is the B-roll preset gate: the queue refuses to start
// unless the preview manifest written by tools/preset-preview.mjs carries
// `status: "confirmed"`. Re-rendering previews resets it to pending, so a copy
// edit after the user's sign-off cannot slip straight into a full render.
//
// Queue file: JSON array of {id, cwd, command: string[], expectedOutput}.
// `command` MUST be an array — a string command would need a shell, and a shell
// turns any filename with a space or a quote into an injection point. Paths
// with spaces are normal in this project (projects/<date>-<name>), so the array
// form is not optional.
//
// Exit codes: 0 all passed, 1 at least one item failed, 2 bad usage/queue file.

import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {finished} from 'node:stream/promises';
import {mkdir, readFile, writeFile, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 2;

class UsageError extends Error {}

const parseArgs = (argv) => {
  let queuePath = null;
  let concurrency = MAX_CONCURRENCY;
  let requireConfirmed = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--concurrency') {
      i += 1;
      if (i >= argv.length) throw new UsageError('--concurrency needs a value of 1 or 2');
      concurrency = Number(argv[i]);
    } else if (arg.startsWith('--concurrency=')) {
      concurrency = Number(arg.slice('--concurrency='.length));
    } else if (arg === '--require-confirmed') {
      i += 1;
      if (i >= argv.length) throw new UsageError('--require-confirmed needs a preview manifest path');
      requireConfirmed = argv[i];
    } else if (arg.startsWith('--require-confirmed=')) {
      requireConfirmed = arg.slice('--require-confirmed='.length);
    } else if (arg.startsWith('--')) {
      throw new UsageError(`unknown option ${arg}`);
    } else if (queuePath === null) {
      queuePath = arg;
    } else {
      throw new UsageError(`unexpected argument ${arg}`);
    }
  }
  if (!queuePath) throw new UsageError('Usage: node tools/render-queue.mjs <queue.json> [--concurrency 1|2]');
  if (!Number.isInteger(concurrency) || concurrency < MIN_CONCURRENCY || concurrency > MAX_CONCURRENCY) {
    throw new UsageError(
      `concurrency must be an integer from ${MIN_CONCURRENCY} to ${MAX_CONCURRENCY}, got ${JSON.stringify(concurrency)}`,
    );
  }
  return {queuePath, concurrency, requireConfirmed};
};

// 预览确认闸门:没盖章不许开渲。读的是 tools/preset-preview.mjs 写的清单。
export const assertPreviewConfirmed = async (manifestPath) => {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw new UsageError(`--require-confirmed 读不到预览清单 ${manifestPath}: ${error.message}`);
  }
  if (manifest.status !== 'confirmed') {
    throw new UsageError(
      `预览未确认(status: ${manifest.status ?? '缺失'})—— 先把 ${manifest.sheet ?? 'contact-sheet.png'} 贴给用户过目,` +
        `再 node tools/preset-preview.mjs <project> --confirm "<用户原话>"`,
    );
  }
  return manifest;
};

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

export const validateQueue = async (items) => {
  if (!Array.isArray(items)) throw new UsageError('queue file must contain a JSON array of items');
  if (items.length === 0) throw new UsageError('queue file must contain at least one item');
  const seen = new Set();
  for (const [index, item] of items.entries()) {
    const at = `item ${index}`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new UsageError(`${at}: must be an object`);
    if (!isNonEmptyString(item.id)) throw new UsageError(`${at}: id must be a non-empty string`);
    if (seen.has(item.id)) throw new UsageError(`${at}: duplicate id ${JSON.stringify(item.id)}`);
    seen.add(item.id);
    if (!isNonEmptyString(item.cwd)) throw new UsageError(`item ${item.id}: cwd is required`);
    if (typeof item.command === 'string') {
      throw new UsageError(
        `item ${item.id}: command must be an array of arguments, not a string (no shell evaluation)`,
      );
    }
    if (!Array.isArray(item.command)) throw new UsageError(`item ${item.id}: command must be an array of arguments`);
    if (item.command.length === 0) throw new UsageError(`item ${item.id}: command must not be empty`);
    // A blank argument is almost always an unresolved template variable
    // (`--frame=${frame}` with frame undefined), which silently renders the
    // wrong thing. Fail loudly instead.
    const blankArg = item.command.findIndex((part) => !isNonEmptyString(part));
    if (blankArg !== -1) {
      throw new UsageError(
        `item ${item.id}: command argument ${blankArg} is empty or not a string (unresolved variable?)`,
      );
    }
    if (!isNonEmptyString(item.expectedOutput)) {
      throw new UsageError(`item ${item.id}: expectedOutput must be a non-empty string`);
    }
    let info;
    try {
      info = await stat(item.cwd);
    } catch {
      throw new UsageError(`item ${item.id}: cwd does not exist: ${item.cwd}`);
    }
    if (!info.isDirectory()) throw new UsageError(`item ${item.id}: cwd is not a directory: ${item.cwd}`);
  }
  return items;
};

const inspectOutput = async (path) => {
  try {
    const info = await stat(path);
    if (!info.isFile()) return {outputExists: false, outputBytes: 0};
    return {outputExists: true, outputBytes: info.size};
  } catch {
    return {outputExists: false, outputBytes: 0};
  }
};

const runItem = async (item, logPath) => {
  const startedAt = Date.now();
  const stream = logPath ? createWriteStream(logPath) : null;
  let logFailed = false;
  const logDone = stream ? finished(stream).catch(() => { logFailed = true; }) : Promise.resolve();
  const outcome = await new Promise((resolve) => {
    let child;
    try {
      child = spawn(item.command[0], item.command.slice(1), {cwd: item.cwd, stdio: ['ignore', 'pipe', 'pipe']});
    } catch (error) {
      resolve({exitCode: null, signal: null, spawnError: error.message});
      return;
    }
    const resume = () => { child.stdout.resume(); child.stderr.resume(); };
    const append = (chunk) => {
      if (!stream || stream.destroyed) return;
      if (!stream.write(chunk)) { child.stdout.pause(); child.stderr.pause(); }
    };
    stream?.on('drain', resume);
    stream?.on('error', resume);
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    let settled = false;
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      resolve({exitCode: null, signal: null, spawnError: error.message});
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      resolve({exitCode: code, signal, spawnError: null});
    });
  });
  const durationMs = Date.now() - startedAt;
  stream?.end();
  await logDone;
  const log = stream && !logFailed ? logPath : null;
  const {outputExists, outputBytes} = await inspectOutput(item.expectedOutput);

  let reason = null;
  if (outcome.spawnError) reason = `failed to start command: ${outcome.spawnError}`;
  else if (outcome.signal) reason = `killed by signal ${outcome.signal}`;
  else if (outcome.exitCode !== 0) reason = `exit code ${outcome.exitCode}`;
  else if (!outputExists) reason = `expected output missing: ${item.expectedOutput}`;
  else if (outputBytes === 0) reason = `expected output is empty (0 bytes): ${item.expectedOutput}`;

  return {
    id: item.id,
    status: reason === null ? 'passed' : 'failed',
    exitCode: outcome.exitCode,
    signal: outcome.signal,
    durationMs,
    cwd: item.cwd,
    command: item.command,
    expectedOutput: item.expectedOutput,
    outputExists,
    outputBytes,
    reason,
    log,
  };
};

// At most `concurrency` children alive at any moment; the next item starts only
// after a running one settles (pass or fail — a failure never blocks the rest).
export const runQueue = async (items, concurrency, logDir = null) => {
  const results = new Array(items.length);
  let next = 0;
  const running = new Set();

  const startNext = () => {
    const index = next;
    next += 1;
    const logPath = logDir ? join(logDir, `${items[index].id}.log`) : null;
    const task = runItem(items[index], logPath).then((result) => {
      results[index] = result;
      running.delete(task);
    });
    running.add(task);
  };

  while (next < items.length && running.size < concurrency) startNext();
  while (running.size > 0) {
    await Promise.race(running);
    while (next < items.length && running.size < concurrency) startNext();
  }
  return results;
};

const resultsPathFor = (queuePath) =>
  queuePath.endsWith('.json') ? `${queuePath.slice(0, -'.json'.length)}.results.json` : `${queuePath}.results.json`;

const main = async () => {
  const {queuePath, concurrency, requireConfirmed} = parseArgs(process.argv.slice(2));
  if (requireConfirmed) {
    const manifest = await assertPreviewConfirmed(requireConfirmed);
    console.error(`[render-queue] 预览已确认(${manifest.confirmedAt}):${manifest.decision}`);
  }
  let raw;
  try {
    raw = await readFile(queuePath, 'utf8');
  } catch {
    throw new UsageError(`cannot read queue file: ${queuePath}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new UsageError(`queue file is not valid JSON: ${error.message}`);
  }
  const items = await validateQueue(parsed);

  const logDir = queuePath.endsWith('.json') ? `${queuePath.slice(0, -'.json'.length)}.logs` : `${queuePath}.logs`;
  await mkdir(logDir, {recursive: true});

  const startedAt = new Date();
  const results = await runQueue(items, concurrency, logDir);
  const finishedAt = new Date();

  const failed = results.filter((result) => result.status === 'failed');
  const summary = {
    queue: queuePath,
    concurrency,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    status: failed.length === 0 ? 'passed' : 'failed',
    results,
  };
  const resultsPath = resultsPathFor(queuePath);
  await writeFile(resultsPath, `${JSON.stringify(summary, null, 2)}\n`);

  for (const result of results) {
    const label = result.status === 'passed' ? 'PASS' : 'FAIL';
    console.error(`[render-queue] ${label} ${result.id} (${result.durationMs}ms)${result.reason ? ` — ${result.reason}` : ''}${result.log ? ` — log: ${result.log}` : ''}`);
    if (result.status === 'failed' && result.log) {
      const text = await readFile(result.log, 'utf8').catch(() => '');
      // 进度条用 \r 刷同一行,不归一化的话整条进度史会挤成一行巨串。
      const tail = text.replace(/\r/g, '\n').split('\n').filter((line) => line.trim() !== '').slice(-40);
      if (tail.length > 0) {
        console.error(`[render-queue] ---- ${result.id} log tail (last ${tail.length} lines) ----`);
        console.error(tail.join('\n').slice(-16000));
        console.error(`[render-queue] ---- end of ${result.id} log tail ----`);
      }
    }
  }
  console.error(`[render-queue] ${summary.passed}/${summary.total} passed, results written to ${resultsPath}; full logs in ${logDir}/`);
  process.exitCode = failed.length === 0 ? 0 : 1;
};

// pathToFileURL, not `file://${argv[1]}` — the studio path itself may contain spaces.
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  try {
    await main();
  } catch (error) {
    console.error(`[render-queue] ${error.message}`);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  }
}
