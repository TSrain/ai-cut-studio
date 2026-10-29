#!/usr/bin/env node
// tools/init-visual-project.mjs
// 用法: node tools/init-visual-project.mjs <project-dir> <project-name>
// 建出 §4.2 的标准项目结构。只用 fs.mkdir / readdir / writeFile,
// 绝不调用 shell 删除 —— 目标目录里已经有东西时宁可退出,也不碰用户的文件。
import {mkdir, readdir, writeFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';

const [rawDir, rawName] = process.argv.slice(2);

if (!rawDir || !rawName) {
  console.error('Usage: node tools/init-visual-project.mjs <project-dir> <project-name>');
  process.exit(2);
}

const projectDir = resolve(rawDir);
const projectName = rawName;

const DIRECTORIES = ['assets', 'styleframes', 'shots', 'out'];

const markdown = (title, body) => `# ${title}: ${projectName}\n\n${body}\n`;

const FILES = {
  'brief.md': markdown(
    'Brief',
    [
      '- 表达目标:',
      '- 观众与场景:',
      '- 比例与时长:',
      '- 素材策略:',
      '- 明确假设(信息不足时必须写在这里):',
    ].join('\n'),
  ),
  'storyboard.md': markdown(
    'Storyboard',
    '| 镜头 | 时间 | 画面 | 动画行为 | 文字 | 素材 | 音效 |\n|---|---|---|---|---|---|---|\n',
  ),
  'proposals.md': markdown(
    'Proposals',
    [
      '三张 Styleframe 的路径、隐藏设计摘要、用户最终选择与选择时间记录在这里。',
      '',
      '| Styleframe | PNG | 候选合同 | 方向摘要 |',
      '|---|---|---|---|',
      '',
      '选择结果: (待填)',
      '选择时间: (待填)',
    ].join('\n'),
  ),
  'assets.md': markdown(
    'Assets',
    '| 文件 | 来源 | 版权状态 | 使用位置 |\n|---|---|---|---|\n',
  ),
  'review.md': markdown(
    'Review',
    '视觉审查与连续性审查的人类可读记录;结构化结果在各镜 `review.json` 与 `continuity.json`。',
  ),
  'storyboard.json': JSON.stringify({version: 1, project: projectName, shots: []}, null, 2) + '\n',
  // 占位合同:结构合法但字段未填,必须由 Visual Director 冻结后才能通过 readVisualContract。
  'visual-contract.json':
    JSON.stringify({version: 1, project: projectName, mode: 'visual-first', shots: []}, null, 2) + '\n',
  'continuity.json': JSON.stringify({version: 1, project: projectName, links: []}, null, 2) + '\n',
  'build-log.json': JSON.stringify({version: 1, events: []}, null, 2) + '\n',
};

const isEmptyDirectory = async (path) => {
  try {
    const entries = await readdir(path);
    return entries.length === 0;
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    throw error;
  }
};

try {
  if (!(await isEmptyDirectory(projectDir))) {
    console.error(`Refuse to overwrite non-empty project directory: ${projectDir}`);
    process.exit(1);
  }

  await mkdir(projectDir, {recursive: true});
  for (const dir of DIRECTORIES) {
    await mkdir(join(projectDir, dir), {recursive: true});
  }
  for (const [name, content] of Object.entries(FILES)) {
    await writeFile(join(projectDir, name), content, 'utf8');
  }

  console.log(`Initialized visual project "${projectName}" at ${projectDir}`);
  console.log(`Next: freeze ${join(projectDir, 'visual-contract.json')}, then run tools/build-dispatch-manifest.mjs`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
