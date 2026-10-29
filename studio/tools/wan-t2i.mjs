#!/usr/bin/env node
// 阿里云百炼·万相文生图(默认 wan2.7-image,0.2 元/张)。
// 用法:
//   node tools/wan-t2i.mjs "提示词" --out projects/<name>/assets/xx.png [--size 2K|1K] [--n 1] [--model wan2.7-image] [--seed 42]
// 依赖:Node >= 18(自带 fetch);API key 读环境变量 DASHSCOPE_API_KEY。
// 生成的图按项目规矩登记 assets.md:来源=AI 生成,版权状态按百炼服务条款。

import {writeFile} from 'node:fs/promises';

const args = process.argv.slice(2);
const prompt = args.find((a) => !a.startsWith('--'));
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};

const apiKey = process.env.DASHSCOPE_API_KEY;
if (!apiKey) {
  console.error(
    '缺少 DASHSCOPE_API_KEY。获取:百炼控制台右上角「API-KEY」创建;' +
      '然后 echo \'export DASHSCOPE_API_KEY=sk-xxx\' >> ~/.zshrc 并重开终端。'
  );
  process.exit(1);
}
if (!prompt) {
  console.error('用法: node tools/wan-t2i.mjs "提示词" --out 输出.png [--size 2K] [--n 1]');
  process.exit(1);
}

const model = opt('model', 'wan2.7-image');
const size = opt('size', '2K');
const n = Number(opt('n', '1'));
const seed = opt('seed', null);
const out = opt('out', 'wan-output.png');
const base = process.env.DASHSCOPE_BASE_URL ?? 'https://dashscope.aliyuncs.com';

const body = {
  model,
  input: {messages: [{role: 'user', content: [{text: prompt}]}]},
  parameters: {size, n, watermark: false, ...(seed ? {seed: Number(seed)} : {})},
};

const res = await fetch(`${base}/api/v1/services/aigc/multimodal-generation/generation`, {
  method: 'POST',
  headers: {'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`},
  body: JSON.stringify(body),
});
const data = await res.json();
if (!res.ok) {
  console.error(`请求失败 HTTP ${res.status}: ${data.code ?? ''} ${data.message ?? JSON.stringify(data)}`);
  process.exit(1);
}

// 兼容两种返回形态:output.choices[].message.content[] 或 output[].content[]
const contents =
  data.output?.choices?.flatMap((c) => c.message?.content ?? []) ??
  (Array.isArray(data.output) ? data.output.flatMap((o) => o.content ?? []) : []);
const urls = contents.map((c) => c.image ?? (c.type === 'image' ? c.text : null)).filter(Boolean);

if (urls.length === 0) {
  console.error(`没拿到图片 URL,原始响应: ${JSON.stringify(data).slice(0, 800)}`);
  process.exit(1);
}

// 图片链接 24 小时过期,立即下载落盘
for (let i = 0; i < urls.length; i++) {
  const file = urls.length === 1 ? out : out.replace(/(\.\w+)?$/, (ext) => `-${i + 1}${ext || '.png'}`);
  const img = await fetch(urls[i]);
  await writeFile(file, Buffer.from(await img.arrayBuffer()));
  console.log(`已保存 ${file}`);
}
console.log(`模型 ${model},共 ${urls.length} 张(约 ${(urls.length * 0.2).toFixed(1)} 元)。记得登记 assets.md。`);
