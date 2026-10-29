import {immersiveMotion,stackLayer} from './immersive-stack.mjs';
import React from 'react';
import {AbsoluteFill,Freeze,Img,Loop,OffthreadVideo,Sequence,staticFile,useCurrentFrame,useRemotionEnvironment,useVideoConfig} from 'remotion';
import type {EditorInstance} from './types';
import {mediaGeometry,mediaItemTiming,mediaMotionStyle,mediaSequenceState,resolveMediaMotion,validateMediaProps} from './media-layout.mjs';
import {pipMediaStyle} from './SourcePip';
export const MediaComposition:React.FC<{instance:EditorInstance}>=({instance})=>{
 const frame=useCurrentFrame(),{width,height,fps}=useVideoConfig(),{isRendering}=useRemotionEnvironment();
 const p=instance.props,duration=instance.durationFrames/fps;
 // Empty slots are useful in the editor, but can never become a final export.
 if(isRendering)validateMediaProps(instance.assetId,p,{durationSeconds:duration,requireAssets:true,fps});
 const sequence=instance.assetId==='media-split'&&p.mode==='sequence';
 const immersive=instance.assetId==='media-stack'&&p.framing==='immersive'&&p.layout!=='spread';
 const geometry=mediaGeometry(instance.assetId,p,width,height);
 const states=sequence?mediaSequenceState(p,frame,fps,duration,width,height):null;
 return <AbsoluteFill style={{overflow:'hidden',background:p.editorBackground==='transparent'?'transparent':p.backgroundColor}}>{p.items.map((item:any,index:number)=>{
 const state=states?.[index],t=state?.timing??mediaItemTiming(item,frame,fps,duration,p.playback),g=state?.geometry??geometry[index];if(!t.visible)return null;
 const enter=state?.enterProgress??t.enterProgress,exit=state?.exitProgress??t.exitProgress;
 const motionName=resolveMediaMotion(item,p,exit<1?'exit':'enter'),progress=exit<1?exit:enter;
 const baseMotion=mediaMotionStyle(item,motionName,progress,width,height);
 const motion=immersive?immersiveMotion(item,motionName,progress,width,height,baseMotion):baseMotion;
 const style=pipMediaStyle(g.crop,null),media=item.media;
 const video=media?.kind==='video'?<OffthreadVideo transparent={media.hasAlpha===true} src={staticFile(!isRendering&&media.previewPublicPath?media.previewPublicPath:media.publicPath)} trimBefore={t.trim} muted pauseWhenBuffering={false} style={style}/>:null;
 return <div key={item.id} data-media-item={item.id} style={{position:'absolute',pointerEvents:'auto',zIndex:instance.assetId==='media-stack'?stackLayer(p,index):undefined,left:g.left,top:g.top,width:g.width,height:g.height,clipPath:g.clipPath,opacity:motion.opacity,transform:`${motion.transform==='none'?'':motion.transform} scale(${g.scale}) rotate(${g.rotation}deg)`,borderRadius:item.radius??(instance.assetId==='media-stack'?12:0),overflow:'hidden',boxShadow:instance.assetId==='media-stack'?`0 ${(p.shadow??30)*.45}px ${(p.shadow??30)*1.5}px rgba(0,0,0,${(p.shadow??30)/100})`:undefined}}>
 <div style={{position:'absolute',inset:0,clipPath:motion.clipPath}}>{media?.kind==='image'?<Img src={staticFile(media.publicPath)} style={style}/>:media?.kind==='video'?<Sequence from={t.start} durationInFrames={Math.max(1,t.end-t.start)} layout="none">{p.playback==='loop'?<Loop durationInFrames={t.available} layout="none">{video}</Loop>:<Freeze frame={t.available-1} active={t.local>=t.available}>{video}</Freeze>}</Sequence>:<div style={{position:'absolute',inset:0,display:'grid',placeItems:'center',border:'2px dashed #8291a8',boxSizing:'border-box',background:'#283242',color:'#cad5e4',fontSize:Math.min(g.width,g.height)*.09}}>{item.label} · 待导入</div>}
 <div style={{position:'absolute',inset:0,border:`${item.borderWidth??0}px solid ${item.borderColor??'#ffffff'}`,borderRadius:item.radius??(instance.assetId==='media-stack'?12:0),boxSizing:'border-box',pointerEvents:'none'}}/>
 </div></div>;
 })}</AbsoluteFill>;
};
