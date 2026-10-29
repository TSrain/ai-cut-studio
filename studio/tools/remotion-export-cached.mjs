#!/usr/bin/env node
// Shared export cache/policy for legacy template and caption export entrypoints.
import {createRequire} from 'node:module';
import {readFileSync,copyFileSync,mkdirSync,existsSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve,dirname,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {ensureExportBundle} from './lib/editor-bundle-cache.mjs';
import {cachedRaster,exportPolicy} from './lib/editor-export-cache.mjs';
const ROOT=resolve(fileURLToPath(new URL('..',import.meta.url))),argv=process.argv.slice(2);
if(argv[0]!=='--cwd'||!argv.includes('--'))throw Error('Usage: remotion-export-cached.mjs --cwd <project> -- remotion render <composition> ... <output>');
const cwd=resolve(argv[1]),args=argv.slice(argv.indexOf('--')+1);
if(args[0]!=='remotion'||args[1]!=='render')throw Error('Only render exports are supported');
const output=resolve(cwd,args.at(-1)),extension=extname(output).slice(1),require=createRequire(join(cwd,'package.json'));
if(!['mp4','mov'].includes(extension))throw Error('Only MP4/MOV exports are supported');
let payload={};const normalized=args.slice(0,-1).map(arg=>{
 if(arg.startsWith('--props=')){const value=arg.slice(8);payload=JSON.parse(value.startsWith('{')?value:readFileSync(resolve(cwd,value),'utf8'));return '--props='+JSON.stringify(payload);}return arg;
});
const cached=await ensureExportBundle({buildRoot:cwd,cacheRoot:join(ROOT,'workspace/editor-bundle-cache'),build:async(outDir,publicRoot)=>{
 const {bundle}=require('@remotion/bundler'),cliRoot=dirname(require.resolve('@remotion/cli/package.json'));
 await require(join(cliRoot,'dist/load-config.js')).loadConfigFile(cwd,'remotion.config.ts',false);
 const {ConfigInternals}=require('@remotion/cli/config');
 const entry=['src/index.ts','src/index.tsx','src/index.js','src/index.jsx'].map(x=>join(cwd,x)).find(existsSync);
 if(!entry)throw Error('Remotion entrypoint missing');
 await bundle({entryPoint:entry,rootDir:cwd,outDir,publicDir:publicRoot,symlinkPublicDir:true,webpackOverride:ConfigInternals.getWebpackOverrideFn(),enableCaching:ConfigInternals.getWebpackCaching()});
}});
const size=typeof payload.canvas==='string'?payload.canvas.split('x').map(Number):[payload.canvas?.width??1920,payload.canvas?.height??1080];
const policy=exportPolicy({width:size[0],height:size[1],fps:{num:30,den:1}},{transparent:extension==='mov'});
const fake={document:{payload,arguments:normalized}};
const cli=join(dirname(require.resolve('@remotion/cli/package.json')),'remotion-cli.js');
const verify=path=>{const d=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',path],{encoding:'utf8'}));if(!d.streams?.some(x=>x.codec_type==='video'&&x.width&&x.height)||!(Number(d.format?.duration)>0))throw Error('缓存导出无效');if(extension==='mov'&&normalized.includes('--pixel-format=yuva444p10le')&&!d.streams.some(x=>/^(yuva|rgba|gbrap|argb|bgra|abgr)/.test(x.pix_fmt)))throw Error('透明缓存缺少 Alpha');};
const result=await cachedRaster(fake,extension,{root:join(ROOT,'workspace/template-export-cache'),bundleKey:cached.key,publicRoot:join(cwd,'public'),verify,
 render:async(_props,_ext,temp)=>{
  const dir=join(ROOT,'workspace/template-export-cache','queue-'+randomUUID());mkdirSync(dir,{recursive:true});
  try{
   const command=[process.execPath,cli,'render',cached.path,...args.slice(2,-1).filter(x=>!x.startsWith('--concurrency=')),`--concurrency=${policy.concurrency}`,...(args.some(x=>x.startsWith('--hardware-acceleration='))?[]:['--hardware-acceleration=if-possible']),temp];
   const execute=async software=>{const q=join(dir,'queue.json'),c=software?command.map(x=>x==='--hardware-acceleration=if-possible'?'--hardware-acceleration=disable':x):command;
    writeFileSync(q,JSON.stringify([{id:'export',cwd,command:c,expectedOutput:temp}]));
    await new Promise((done,fail)=>{const child=spawn(process.execPath,[join(ROOT,'tools/render-queue.mjs'),q,'--concurrency','2'],{cwd,stdio:['ignore','pipe','pipe']});let tail='';child.stdout.on('data',b=>{process.stdout.write(b);tail=(tail+b).slice(-10000);});child.stderr.on('data',b=>{process.stderr.write(b);tail=(tail+b).slice(-10000);});child.on('error',fail);child.on('close',code=>code===0?done():fail(Error(tail)));});};
   try{await execute(false);}catch(e){if(!/hardware|videotoolbox|encoder/i.test(e.message))throw e;rmSync(temp,{force:true});await execute(true);}
  }finally{/* Keep queue receipts and failure logs; cachedRaster removes incomplete output files. */}
 }});
mkdirSync(dirname(output),{recursive:true});const published=output+'.publish-'+randomUUID();copyFileSync(result.path,published);(await import('node:fs')).renameSync(published,output);console.log(JSON.stringify({output,cacheHit:result.hit,key:result.key}));
