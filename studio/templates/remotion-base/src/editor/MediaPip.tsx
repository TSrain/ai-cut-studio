import React from 'react';
import {Freeze, Img, OffthreadVideo, staticFile, useCurrentFrame,useVideoConfig,useRemotionEnvironment} from 'remotion';
import type {EditorInstance} from './types';
import {cropRect,pipGeometry,pipMediaTiming,PIP_DEFAULTS} from './source-pip.mjs';
import {PipFrame,pipMediaStyle} from './SourcePip';
/** Independent footage uses sequence-local time, never the global main-track clock. */
export const MediaPip:React.FC<{instance:EditorInstance;hidden?:boolean}> = ({instance,hidden}) => {
 const {isRendering}=useRemotionEnvironment();
 const frame=useCurrentFrame(),{width,height,fps}=useVideoConfig(),media=instance.props.media;
 if(!media?.publicPath)return null;
 const p={...PIP_DEFAULTS,...instance.props};
 const crop=cropRect(p,media.width/media.height);
 const g=pipGeometry(width,height,instance.durationFrames,frame,fps,{...p,crop});
 const style=pipMediaStyle(g.crop,g),src=staticFile(!isRendering&&media.previewPublicPath?media.previewPublicPath:media.publicPath);
 const {trim,available,sourceFrame}=pipMediaTiming(media,frame,fps);
 return <PipFrame instance={instance} g={g} width={width} height={height} borderColor={p.borderColor} sourceFrame={sourceFrame} hidden={hidden}>
  {media.kind==='image'?<Img src={src} style={style}/>:<Freeze active={frame>=available} frame={available-1}><OffthreadVideo transparent={media.hasAlpha===true} src={src} trimBefore={trim} muted pauseWhenBuffering={false} style={{
   ...style,
   // Some browser decoders display VP9 Alpha's transparent pixels as black.
   // Keep the source image visible in the editor; exports use the original Alpha MOV.
   ...(!isRendering && media.hasAlpha ? {mixBlendMode:'screen' as const} : {}),
  }}/></Freeze>}
 </PipFrame>;
};
