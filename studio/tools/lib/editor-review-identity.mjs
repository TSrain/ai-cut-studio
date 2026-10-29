import {statSync,realpathSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
/** A source changed in place invalidates a pending review, even when its URL is unchanged. */
export function reviewMediaIdentity(root,document){
 const paths=new Set();
 function visit(value){if(typeof value==='string'&&/\.(mp4|mov|webm|m4v|mp3|wav|m4a|png|jpe?g|webp|svg)$/i.test(value))paths.add(value);else if(value&&typeof value==='object')Object.values(value).forEach(visit);}
 visit(document.source);visit(document.instances);visit(document.audioClips);
 return createHash('sha256').update(JSON.stringify([...paths].sort().map(p=>{
  for(const candidate of isAbsolute(p)?[p]:[join(root,'templates/remotion-base/public',p),join(root,p)])try{const real=realpathSync(candidate),s=statSync(real);return [p,real,s.size,s.mtimeMs,s.ctimeMs];}catch{}
  return [p,'missing'];
 }))).digest('hex');
}
