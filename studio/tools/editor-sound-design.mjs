#!/usr/bin/env node
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {stageSoundDesign,mergeSoundDesign} from './lib/editor-sound-design.mjs';
import {validateDocument} from './lib/editor-store.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const flags=new Map();for(let i=2;i<process.argv.length;i++){const k=process.argv[i];if(k==='--apply'){flags.set(k,true);continue;}if(!['--manifest','--document','--out','--url'].includes(k)||!process.argv[i+1])throw Error('Use --manifest file --out receipt [--document test.json | --url http://localhost:4358 --apply]');flags.set(k,process.argv[++i]);}
const manifest=JSON.parse(readFileSync(flags.get('--manifest'),'utf8')),base=flags.get('--url')??'http://localhost:4358';
const parsed=new URL(base);if(!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)||parsed.protocol!=='http:')throw Error('Only local editor API is supported');
if(flags.has('--document')&&flags.has('--apply'))throw Error('Offline document cannot be applied to live project');
const api=async(path,body)=>{const response=await fetch(base+'/api/editor/'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const value=await response.json();if(!response.ok)throw Error(value.error??'Editor request failed');return value;};
const document=flags.has('--document')?JSON.parse(readFileSync(flags.get('--document'),'utf8')):await api('load?id='+encodeURIComponent(manifest.projectId));
if(document.revision!==manifest.expectedRevision)throw Error('Project revision changed; resolve current timeline before applying sound');
const clips=stageSoundDesign(manifest,document,{root}),result=mergeSoundDesign(document,clips);validateDocument(result.document);
result.document.styleReference.allowedOverrides.soundDesign.planSha256=manifest.planSha256;
let saved;if(flags.has('--apply'))saved=await api('save',{document:result.document});
const receipt={version:1,projectId:document.id,state:saved?'applied':'prepared',revision:saved?.revision??document.revision,protectedEdits:result.protectedEdits,addedOrUpdated:clips.filter(c=>!result.protectedEdits.includes(c.id)).map(c=>c.id),unreviewed:manifest.cues.filter(c=>c.audition!=='reviewed').map(c=>c.id),...(saved?{}:{document:result.document})};
const output=resolve(flags.get('--out')??join(root,'workspace/sound-design',document.id+'-receipt.json'));mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({state:receipt.state,projectId:receipt.projectId,revision:receipt.revision,protectedEdits:receipt.protectedEdits,unreviewed:receipt.unreviewed,receipt:output}));
