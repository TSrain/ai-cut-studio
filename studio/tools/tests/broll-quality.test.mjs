import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateContinuity, validatePresetReview} from '../lib/broll-quality.mjs';
test('rejects fabricated continuity, missing boundaries and failed checks', () => {
  assert.throws(() => validateContinuity({shots:['shot-003','shot-020'],links:[]},['shot-003','shot-020']));
  const doc={shots:['shot-003','shot-020'],boundaries:[{from:'shot-003',to:'shot-020',frames:['a.png','b.png'],checks:{focus:true,palette:true,typography:true,motionDirection:true,densityCurve:true,timing:false},passed:true}],continuityScore:9};
  assert.throws(() => validateContinuity(doc,doc.shots));
  doc.boundaries[0].checks.timing=true;
  assert.doesNotThrow(() => validateContinuity(doc,doc.shots));
});
test('single shot still requires structured continuity',()=>{
 assert.throws(()=>validateContinuity({},['shot-020']));
 assert.doesNotThrow(()=>validateContinuity({shots:['shot-020'],boundaries:[],continuityScore:9},['shot-020']));
});
test('verified preset review requires command evidence, no visual scorecard',()=>{
 const review={technical:{contract:true,output:true,fonts:true,assets:true,thumbnail:true}};
 assert.throws(()=>validatePresetReview(review));
 review.commands=['slots','preview','render','output'].map(name=>({name,exitCode:0,receiptPath:`/evidence/${name}.json`}));
 assert.doesNotThrow(()=>validatePresetReview(review));
 review.commands[0].exitCode=1; assert.throws(()=>validatePresetReview(review));
});
