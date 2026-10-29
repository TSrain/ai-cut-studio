import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import http from 'node:http';
import https from 'node:https';
import {createWriteStream} from 'node:fs';
import {rm} from 'node:fs/promises';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export function isPublicAddress(ip){
 if(isIP(ip)===4){const [a,b]=ip.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19));}
 if(isIP(ip)===6) return /^2[0-9a-f]{3}:/i.test(ip)&&!/^2001:(?:db8|0|2):/i.test(ip);
 return false;
}
export function assertReusableCandidate(c){
 const url=c.downloadUrl;
 if(typeof url!=='string')throw new Error('该候选只有来源网页，尚无已确认的直接下载地址');
 const license=typeof c.license==='string'?c.license:typeof c.license?.name==='string'?c.license.name:'';
 if(!/^(CC0|CC-BY(?:-SA)?(?: [1-4]\.0)?|public domain|Pexels(?: License)?|Pixabay(?: License)?|Unsplash(?: License)?|free reusable)$/i.test(license.trim()))throw new Error('候选缺少已确认的免费复用授权，暂不能下载');
 return url;
}
async function publicDoh(hostname){
 const url=new URL('https://1.1.1.1/dns-query');url.searchParams.set('name',hostname);url.searchParams.set('type','A');
 return new Promise((resolve,reject)=>{
  const request=https.get(url,{headers:{accept:'application/dns-json'}},response=>{
   if(response.statusCode!==200){response.resume();reject(new Error('公网DNS查询失败'));return;}
   let text='';response.setEncoding('utf8');response.on('data',chunk=>{text+=chunk;if(text.length>65536)response.destroy(new Error('公网DNS响应过大'));});response.on('error',reject);
   response.on('end',()=>{try{const result=JSON.parse(text);if(result.Status!==0||result.Question?.[0]?.name?.replace(/\.$/,'').toLowerCase()!==hostname.toLowerCase())throw new Error('公网DNS响应身份无效');resolve((result.Answer??[]).filter(a=>a.type===1).map(a=>({address:a.data,family:4})));}catch(error){reject(error);}});
  });request.on('error',reject);request.setTimeout(8000,()=>request.destroy(new Error('公网DNS查询超时')));
 });
}
export async function resolvePublicAddresses(hostname,{lookupFn=lookup,dohFn=publicDoh}={}){
 hostname=hostname.replace(/^\[|\]$/g,'');
 if(isIP(hostname)){if(!isPublicAddress(hostname))throw new Error('下载地址指向非公网网络');return [{address:hostname,family:isIP(hostname)}];}
 let addresses,timer;
 try {addresses=await Promise.race([lookupFn(hostname,{all:true}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('下载DNS查询超时')),10000);})]);}
 finally{clearTimeout(timer);}
 // macOS proxy fake-IP ranges are benchmark-only, never usable download destinations.
 // Resolve these through one fixed, certificate-validated public DoH endpoint instead.
 const fake=address=>/^198\.(18|19)\./.test(address)||/^2001:2:/i.test(address);
 if(addresses.length&&addresses.every(a=>fake(a.address)))addresses=await dohFn(hostname);
 if(!addresses.length||addresses.some(a=>!isPublicAddress(a.address)))throw new Error('下载地址指向非公网网络');
 return addresses;
}
export async function downloadPublicMedia(url,target){
 const deadline=Date.now()+120000;
 try{
 for(let redirects=0;redirects<=5;redirects++){
  const u=new URL(url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.port&&!['80','443'].includes(u.port))throw new Error('下载地址协议、凭据或端口不允许');
  const addresses=await resolvePublicAddresses(u.hostname);
  const pinned=addresses[0];
  const response=await new Promise((resolve,reject)=>{
   const request=(u.protocol==='https:'?https:http).get(u,{lookup:(_host,opts,cb)=>opts?.all?cb(null,[pinned]):cb(null,pinned.address,pinned.family)},resolve);
   request.on('error',reject);request.setTimeout(Math.max(1,deadline-Date.now()),()=>request.destroy(new Error('下载超时')));
  });
  if([301,302,303,307,308].includes(response.statusCode)){response.resume();if(!response.headers.location)throw new Error('下载重定向缺少地址');url=new URL(response.headers.location,u).href;continue;}
  if(response.statusCode!==200){response.resume();throw new Error(`下载失败 HTTP ${response.statusCode}`);}
  const limit=512*1024*1024;if(Number(response.headers['content-length'])>limit){response.destroy();throw new Error('候选文件超过512MB');}
  let bytes=0;const timer=setTimeout(()=>response.destroy(new Error('下载超时')),Math.max(1,deadline-Date.now()));
  try{await pipeline(response,new Transform({transform(chunk,_enc,cb){bytes+=chunk.length;cb(bytes>limit?new Error('候选文件超过512MB'):null,chunk);}}),createWriteStream(target,{flags:'wx'}));}finally{clearTimeout(timer);}
  return;
 }
 throw new Error('下载重定向过多');
 }catch(error){await rm(target,{force:true});throw error;}
}
export async function inspectDownloadedMedia(path){
 const {stdout}=await exec('ffprobe',['-v','error','-show_streams','-show_format','-of','json',path],{timeout:30000,maxBuffer:1024*1024});
 const p=JSON.parse(stdout),s=p.streams?.find(x=>x.codec_type==='video');
 if(!s||Math.min(s.width,s.height)<720)throw new Error('候选原始短边低于720px或不是有效媒体');
 await exec('ffmpeg',['-v','error','-xerror','-i',path,'-map','0:v:0','-f','null','-'],{timeout:120000,maxBuffer:1024*1024});
 return {width:s.width,height:s.height,durationSeconds:Number(p.format?.duration)||0,kind:Number(p.format?.duration)>0?'video':'image'};
}
