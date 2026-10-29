import React from 'react';
import {AbsoluteFill,useCurrentFrame,useVideoConfig} from 'remotion';
import {EditableText} from '../editor/preset-editing';
import {behindTitleMotion} from '../editor/behind-title.mjs';
export const PresetBehindTitle:React.FC<any>=({slots={title:'M5 Max'},durationSeconds=3,tune={}})=>{
 const f=useCurrentFrame(),{fps,width,height}=useVideoConfig();
 const m=behindTitleMotion(f,Math.max(1,Math.round(durationSeconds*fps)),fps,slots.enterSeconds??.18,slots.exitSeconds??.15,{enterFx:slots.enterFx,exitFx:slots.exitFx,width,height});
 return <AbsoluteFill style={{pointerEvents:'none'}}><div style={{position:'absolute',left:width*(slots.positionX??.5),top:height*(slots.positionY??.2),transform:`translate(-50%,-50%) translate(${m.x}px,${m.y}px) scale(${m.scale})`,opacity:m.opacity,filter:`blur(${m.blur}px)`}}><EditableText part="title" style={{fontFamily:slots.fontFamily||'Archivo, "Noto Sans SC", sans-serif',fontWeight:900,fontSize:Math.min(width,height)*(slots.fontSizeRatio??.21),letterSpacing:'-.055em',lineHeight:.96,color:slots.color||'#ffffff',whiteSpace:'pre',textAlign:'center',textShadow:'0 3px 18px rgba(0,0,0,.12)'}}>{slots.title}</EditableText></div></AbsoluteFill>;
};
