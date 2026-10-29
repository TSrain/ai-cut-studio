#!/usr/bin/env node
import {readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync} from 'node:fs';
import {resolve,join,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {composeDocument,validateComposition,compositionHash} from './lib/editor-compose.mjs';
import {stageCompositionMedia} from './lib/editor-compose-media.mjs';
import {defaultMediaProps,defaultMediaItem} from '../templates/remotion-base/src/editor/media-layout.mjs';
import {loadDocument,saveDocument,validateDocument,hashAssetSources} from './lib/editor-store.mjs';
import {validateEditorProps} from './lib/editor-props.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const flags=new Map();for(let i=2;i<process.argv.length;i+=2){if(!['--manifest','--receipt','--port'].includes(process.argv[i])||!process.argv[i+1])throw new Error('Use --manifest file --receipt file [--port 4325]');flags.set(process.argv[i],process.argv[i+1]);}
try{
 const manifestPath=resolve(flags.get('--manifest')??''),receiptPath=resolve(flags.get('--receipt')??'workspace/composition-receipt.json'),port=Number(flags.get('--port')??4325);
 if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid port');
 const input=validateComposition(JSON.parse(readFileSync(manifestPath,'utf8'))),rootDir=join(root,'workspace/editor-projects');
 const existing=existsSync(join(rootDir,input.id,'document.json'))?loadDocument(input.id,{rootDir}):null;
 // Check identity and canvas before staging any large files.
 if(existing&&(existing.id!==input.id||compositionHash(existing.canvas)!==compositionHash(input.canvas)))throw new Error('Existing identity/canvas differs; use a new project ID');
 const prepared=stageCompositionMedia(input,{root,base:dirname(manifestPath),itemDefaults:defaultMediaItem,defaults:asset=>['media-stack','media-split'].includes(asset)?defaultMediaProps(asset):{}});
 const result=composeDocument(prepared,{existing});validateDocument(result.document);
 for(const instance of result.document.instances)validateEditorProps(instance,result.document.canvas.durationFrames,{fps:result.document.canvas.fps.num/result.document.canvas.fps.den});
 const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):/\.(ts|tsx|mjs)$/.test(e.name)?[relative(root,join(dir,e.name))]:[]);
 const assetSourcePaths=walk(join(root,'templates/remotion-base/src')).sort();
 const currentHash=hashAssetSources(assetSourcePaths,root);
 let saved=result.document;
 if(!existing||compositionHash(existing)!==compositionHash(result.document)||existing.assetSourceHash!==currentHash)saved=saveDocument(result.document,{rootDir,assetSourceRoot:root,assetSourcePaths,expectedRevision:result.document.revision});
 const receipt={version:1,projectId:saved.id,revision:saved.revision,status:result.status,url:`http://localhost:${port}/editor?document=${encodeURIComponent(saved.id)}`,documentPath:join(rootDir,saved.id,'document.json'),manifestPath,pending:result.pending,protectedEdits:result.protectedEdits,selections:result.selections};
 mkdirSync(dirname(receiptPath),{recursive:true});writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));
}catch(error){console.error(error.message);process.exitCode=1;}
