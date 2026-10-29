#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {loadPreset} from './lib/preset.mjs';
import {validatePresetReview} from './lib/broll-quality.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
try {
 const [contractPath,shotId,reviewPath]=process.argv.slice(2);
 const contract=JSON.parse(await readFile(contractPath,'utf8'));
 const shot=contract.shots.find(s=>s.id===shotId);
 if(!shot) throw new Error('shot missing in approved contract');
 const preset=shot.preset ? await loadPreset(root,shot.preset.id) : null;
 if(preset?.status==='verified' && preset.version===shot.preset.version) {
   const review=JSON.parse(await readFile(reviewPath,'utf8'));
   validatePresetReview(review);
   for(const entry of review.commands) {
     const receipt=JSON.parse(await readFile(path.resolve(path.dirname(reviewPath),entry.receiptPath),'utf8'));
     if(receipt.exitCode!==0 || receipt.signal || !receipt.command || typeof receipt.stdout!=='string' || typeof receipt.stderr!=='string') throw new Error(`invalid command receipt: ${entry.name}`);
   }
   console.log('PASS verified preset technical evidence');
 } else {
   const result=spawnSync(process.execPath,[path.join(root,'tools/validate-review.mjs'),reviewPath],{encoding:'utf8'});
   process.stdout.write(result.stdout??''); process.stderr.write(result.stderr??'');
   if(result.status!==0) throw new Error('custom/draft visual review failed');
 }
} catch(error) {console.error(`FAIL ${error.message}`);process.exitCode=1;}
