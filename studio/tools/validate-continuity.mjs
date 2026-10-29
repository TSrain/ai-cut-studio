#!/usr/bin/env node
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {validateContinuity} from './lib/broll-quality.mjs';
try {
 const [reportPath,contractPath]=process.argv.slice(2);
 const report=JSON.parse(await readFile(reportPath,'utf8'));
 const contract=JSON.parse(await readFile(contractPath,'utf8'));
 validateContinuity(report,contract.shots.map(s=>s.id));
 for(const b of report.boundaries) for(const frame of b.frames) {
   const file=await stat(path.resolve(path.dirname(reportPath),frame));
   if(!file.isFile() || file.size===0) throw new Error('continuity frame unavailable');
 }
 console.log('PASS continuity');
} catch(error) {console.error(`FAIL ${error.message}`);process.exitCode=1;}
