import React from 'react';
import {captionAtFrame,cleanCaptionText,resolveCaptionStyle} from './captions.mjs';
import type {CaptionTrack} from './captions.mjs';

const rgba=(hex:string,opacity:number)=>{
  const value=hex.slice(1);const full=value.length===3?Array.from(value).map(char=>char+char).join(''):value;
  return `rgba(${parseInt(full.slice(0,2),16)}, ${parseInt(full.slice(2,4),16)}, ${parseInt(full.slice(4,6),16)}, ${opacity})`;
};
/** Frame is document-global: range exports use the same subtitle boundaries as the preview. */
export const CaptionLayer:React.FC<{track?:CaptionTrack;frame:number;width:number;height:number;renderMode:'full'|'layer'|'instances';interactive?:boolean}> = ({track,frame,width,height,renderMode,interactive=false})=>{
  if(renderMode==='instances')return null;
  const cue=captionAtFrame(track,frame);
  if(!cue||!track)return null;
  const s=resolveCaptionStyle(track,cue),scale=height/1080;
  const fontWeight=s.fontFamily==='Noto Sans SC'?600:s.fontFamily==='Noto Serif SC'?700:400;
  return <div data-editor-caption={cue.id} role={interactive?'button':undefined} tabIndex={interactive?0:undefined} aria-label={interactive?`画布字幕：${cleanCaptionText(cue.text)}`:undefined} style={{position:'absolute',left:`${s.positionXPercent}%`,bottom:`${s.bottomPercent}%`,transform:'translateX(-50%)',width:'max-content',maxWidth:width*s.maxWidthPercent/100,boxSizing:'border-box',padding:`${s.paddingY*scale}px ${s.paddingX*scale}px`,borderRadius:s.borderRadius*scale,backgroundColor:rgba(s.backgroundColor,s.backgroundOpacity),fontFamily:`"${s.fontFamily}", "Noto Sans SC", sans-serif`,fontSize:s.fontSize*scale,fontWeight,fontSynthesis:'none',color:s.color,lineHeight:1.35,textAlign:'center',whiteSpace:'pre-wrap',overflowWrap:'anywhere',zIndex:2147483647,pointerEvents:interactive?'auto':'none',cursor:interactive?'move':undefined,userSelect:interactive?'none':undefined,touchAction:interactive?'none':undefined}}>{cleanCaptionText(cue.text)}</div>;
};
