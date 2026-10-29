import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import * as shots from '../lib/aroll-shot-plan.mjs';

const segments=[{from:0,to:4,zoomFrom:1,zoomTo:1.06,easing:'ramped'}];
const anchor={x:.57,y:.32};
test('rendered static marker follows a subpixel zoom without lateral rocking',(t)=>{
 const vf=shots.buildCameraFilter(segments,{width:640,height:360,fps:30,anchor});
 const input="nullsrc=s=640x360:r=30:d=4,format=gray,geq=lum='220*exp(-((X-350)*(X-350)+(Y-115)*(Y-115))/100)',format=yuv420p";
 const q=spawnSync('ffmpeg',['-v','error','-f','lavfi','-i',input,'-vf',vf,'-pix_fmt','gray','-f','rawvideo','-'],{maxBuffer:40e6});
 assert.equal(q.status,0,String(q.stderr));
 const centers=[];
 for(let n=0;n<120;n++){
 let sum=0,xsum=0,ysum=0;
 for(let y=85;y<145;y++)for(let x=320;x<380;x++){
 const v=q.stdout[n*640*360+y*640+x];sum+=v;xsum+=x*v;ysum+=y*v;
 }
 centers.push([xsum/sum,ysum/sum]);
 }
 let largestReverse=0,largestVerticalStep=0;
 for(let i=1;i<centers.length;i++){
 largestReverse=Math.max(largestReverse,centers[i][0]-centers[i-1][0]);
 largestVerticalStep=Math.max(largestVerticalStep,Math.abs(centers[i][1]-centers[i-1][1]));
 }
 t.diagnostic(`max reverse=${largestReverse.toFixed(4)}px; max vertical step=${largestVerticalStep.toFixed(4)}px`);
 assert.ok(largestReverse<.08,`unwanted horizontal reversal ${largestReverse.toFixed(3)}px`);
 assert.ok(largestVerticalStep<.08,`unwanted vertical step ${largestVerticalStep.toFixed(3)}px`);
 assert.ok(centers.at(-1)[0]<centers[0][0]-.7,'zoom must actually move the off-anchor marker');
});
