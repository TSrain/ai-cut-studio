import React,{useEffect,useMemo,useState} from 'react';
import {sourceThumbnailCells} from './source-thumbnail-cells.mjs';
import {chooseLevel,tilesForRange,visiblePeaks} from './waveform-levels.mjs';
type Preview={durationSeconds:number;thumbnails:{time:number;url:string}[];peaks:number[];sampleSeconds:number};
const requests=new Map<string,Promise<Preview>>();
function preview(path:string) {
 if(!requests.has(path))requests.set(path,fetch(`/api/editor/timeline-media?path=${encodeURIComponent(path)}`).then(async response=>{if(!response.ok)throw Error('预览暂不可用');const result=await response.json();if(!Array.isArray(result.thumbnails)||!Array.isArray(result.peaks))throw Error('预览数据无效');return result;}).catch(error=>{requests.delete(path);throw error;}));
 return requests.get(path)!;
}
const tileRequests=new Map<string,Promise<number[]>>(),EMPTY_TILES=new Map<number,number[]>();
function peakTileRequest(path:string,level:number,tile:number){
 const key=`${path}\n${level}\n${tile}`;
 if(!tileRequests.has(key)){
  if(tileRequests.size>400)tileRequests.delete(tileRequests.keys().next().value!);
  tileRequests.set(key,fetch(`/api/editor/timeline-peaks?path=${encodeURIComponent(path)}&level=${level}&tile=${tile}`).then(async response=>{if(!response.ok)throw Error('波形分块暂不可用');const result=await response.json();if(!Array.isArray(result.peaks))throw Error('波形数据无效');return result.peaks as number[];}).catch(error=>{tileRequests.delete(key);throw error;}));
 }
 return tileRequests.get(key)!;
}
/** Zoom-dependent detail: pick a peak level from px/second and load only tiles in the visible window. */
function useFinePeaks(path:string,enabled:boolean,pxPerSecond:number|undefined,visible:{start:number;end:number}|null|undefined,duration:number|undefined){
 const level=chooseLevel(pxPerSecond??0),[loaded,setLoaded]=useState<{key:string;tiles:Map<number,number[]>}>({key:'',tiles:new Map()});
 const tiles=enabled&&level>0&&visible?tilesForRange(level,visible.start,visible.end,duration??Infinity):[];
 const key=`${path}|${level}`,wanted=tiles.join(',');
 useEffect(()=>{
  if(!tiles.length)return;let live=true;
  for(const tile of tiles)peakTileRequest(path,level,tile).then(peaks=>{if(!live)return;setLoaded(previous=>{const map=previous.key===key?new Map(previous.tiles):new Map<number,number[]>();map.set(tile,peaks);return {key,tiles:map};});},()=>{});
  return()=>{live=false;};
 },[key,wanted]);
 return {level,tiles:loaded.key===key?loaded.tiles:EMPTY_TILES};
}
/** Decorative media samples follow absolute media in-points, independent of clip position. */
export function SourceStrip({source,clip,fps,width,showWaveform=false,pxPerSecond,visible}:{source:{path:string};clip:{sourceInFrame:number;durationFrames:number};fps:number;width:number;showWaveform?:boolean;pxPerSecond?:number;visible?:{start:number;end:number}|null}) {
 const [state,setState]=useState<{path:string;data?:Preview;error?:string}>({path:source.path});
 useEffect(()=>{let live=true;setState({path:source.path});preview(source.path).then(data=>{if(live)setState({path:source.path,data});},()=>{if(live)setState({path:source.path,error:'缩略图 / 波形暂不可用'});});return()=>{live=false;};},[source.path]);
 const data=state.path===source.path?state.data:undefined,start=clip.sourceInFrame/fps,duration=clip.durationFrames/fps,end=start+duration;
 const fine=useFinePeaks(source.path,showWaveform&&!!data?.peaks.length,pxPerSecond,visible,data?.durationSeconds);
 const waveform=useMemo(()=>{
  if(!showWaveform||!data?.peaks.length||!data.sampleSeconds||duration<=0)return '';
  if(fine.level>0&&fine.tiles.size&&visible){
   const from=Math.max(start,visible.start),to=Math.min(end,visible.end),peaks=visiblePeaks(fine.level,fine.tiles,from,to);
   if(peaks.length)return peaks.map(p=>{const x=((p.seconds-start)/duration)*1000,h=Math.sqrt(Math.max(0,p.value))*13;return `M${x.toFixed(3)},${(14-h).toFixed(2)}V${(14+h).toFixed(2)}`;}).join('');
  }
  const first=Math.max(0,Math.floor(start/data.sampleSeconds)),last=Math.min(data.peaks.length,Math.ceil(end/data.sampleSeconds));
  return data.peaks.slice(first,last).map((peak,index)=>{const x=(((first+index+.5)*data.sampleSeconds-start)/duration)*1000,h=Math.sqrt(Math.max(0,peak))*13;return `M${x.toFixed(2)},${(14-h).toFixed(2)}V${(14+h).toFixed(2)}`;}).join('');
 },[data,start,duration,end,showWaveform,fine.level,fine.tiles,visible?.start,visible?.end]);
 const cells=useMemo(()=>sourceThumbnailCells({thumbnails:data?.thumbnails??[],start,duration,width}),[data,start,duration,width]);
 return <div data-source-strip="" aria-hidden="true" style={{position:'absolute',inset:0,overflow:'hidden',pointerEvents:'none',borderRadius:'inherit'}}>
  {data?<>
   <div style={{position:'absolute',top:0,left:0,right:0,bottom:showWaveform?28:0}}>{cells.map((cell,index)=><div key={index} style={{position:'absolute',left:cell.left,width:cell.width,height:'100%',backgroundImage:`url(${JSON.stringify(cell.url)})`,backgroundSize:'cover',backgroundRepeat:'no-repeat',backgroundPosition:'center'}}/>)}</div>
   {showWaveform&&(data.peaks.length?<svg data-source-waveform="" data-waveform-level={fine.level>0&&fine.tiles.size?fine.level:0} viewBox="0 0 1000 28" preserveAspectRatio="none" style={{position:'absolute',left:0,right:0,bottom:0,width:'100%',height:28,background:'rgba(3,20,24,.42)'}}><path d={waveform} stroke="#7ad5c4" strokeWidth="1.3" vectorEffect="non-scaling-stroke"/></svg>:<span style={{position:'absolute',bottom:4,left:7,fontSize:10,opacity:.7}}>无音轨</span>)}
  </>:<span style={{position:'absolute',bottom:5,left:7,fontSize:10,opacity:.6}}>{state.error??'正在读取缩略图 / 波形…'}</span>}
 </div>;
}
