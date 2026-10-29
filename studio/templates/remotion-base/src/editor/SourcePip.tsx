import React, {useMemo,useState} from 'react';
import {compileShotPlan, sampleCameraZoom} from './aroll-shot-plan.mjs';
import {OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig, useRemotionEnvironment} from 'remotion';
import type {EditorDocument, EditorInstance} from './types';
import {pipGeometry, PIP_DEFAULTS} from './source-pip.mjs';
import {instanceTiming,sourceFrameAt,sourceSegments} from './clip-time.mjs';
// Source clip decoders remain independent of PiP instances and visual mode changes.
// Preview warms only the next cut; export retains the original source and timing.
export const SourcePip: React.FC<{document:EditorDocument; previewSource?:{path:string;url:string}; instance:EditorInstance|null; rangeStartFrame?:number; muted?:boolean; hidden?:boolean}> = ({document,instance,rangeStartFrame=0,muted=false,hidden=false,previewSource}) => {
  const frame=useCurrentFrame()+rangeStartFrame; const {width,height,fps}=useVideoConfig();
  const source=document.source;
  const {isPlayer,isRendering}=useRemotionEnvironment();
  const [failedPreview,setFailedPreview]=useState<string|null>(null);
  const segments=useMemo(()=>source?.cameraPlan?compileShotPlan(source.cameraPlan):[],[source?.cameraPlan]);
  const mappedFrame=sourceFrameAt(source,frame,document.canvas.durationFrames);
  const cameraZoom=sampleCameraZoom(segments,((mappedFrame ?? source?.startFrame ?? 0)-(source?.startFrame ?? 0))/fps);
  const anchor=source?.cameraPlan?.anchor??{x:.5,y:.5};
  if (!source) return null;
  const p={...PIP_DEFAULTS,...instance?.props};
  const g=instance ? pipGeometry(width,height,instanceTiming(instance).duration,frame-instance.startFrame+instanceTiming(instance).offset,fps,p) : null;
  const proxy=isPlayer&&!isRendering&&previewSource?.path===source.path&&previewSource.url!==failedPreview?previewSource.url:null;
  const src=proxy??(source.publicPath ? staticFile(source.publicPath) : `/${source.path.replace(/^\/+/, '')}`);
  // Remotion otherwise derives #t=start,end from the current trim. Extending
  // either edge changes video.src and empties the decoder on every pointer move.
  // A stable, open-ended fragment leaves seeking to Remotion's frame clock.
  const playbackSrc=isPlayer&&!isRendering&&!src.includes('#')?`${src}#t=0`:src;
  const crop=instance?.props.crop ? g?.crop : null;
  const clips=sourceSegments(source,document.canvas.durationFrames);
  const nextClip=clips.find(clip=>clip.startFrame>frame);
  const currentClip=clips.find(clip=>frame>=clip.startFrame&&frame<clip.startFrame+clip.durationFrames);
  // Keep the warmed Sequence wrapper when it becomes active: changing premountFor
  // to zero remounts Remotion's video exactly at the cut. Only current/next decode.
  const previewPremount=(id:string)=>isPlayer&&!isRendering&&(id===currentClip?.id||id===nextClip?.id)?Math.round(fps*.5):0;
  return <PipFrame instance={instance} g={g} width={width} height={height} hidden={hidden} sourceFrame={mappedFrame??undefined} borderColor={p.borderColor}>
    {clips.map(clip=><Sequence key={clip.id} from={clip.startFrame-rangeStartFrame} durationInFrames={clip.durationFrames} {...(isPlayer&&!isRendering?{premountFor:previewPremount(clip.id)}:{layout:'none' as const})}><OffthreadVideo useWebAudioApi allowAmplificationDuringRender src={playbackSrc} onError={proxy?()=>setFailedPreview(proxy):undefined} muted={muted||source.muted} volume={source.volume??1} pauseWhenBuffering={!muted} trimBefore={clip.sourceInFrame} style={{...pipMediaStyle(crop,g),transform:`scale(${cameraZoom})`,transformOrigin:`${anchor.x*100}% ${anchor.y*100}%`}} /></Sequence>)}
  </PipFrame>;
};

export function pipMediaStyle(crop:any,g:any):React.CSSProperties {
 return {position:'absolute',left:crop?`${-crop.x/crop.width*100}%`:0,top:crop?`${-crop.y/crop.height*100}%`:0,width:crop?`${100/crop.width}%`:'100%',height:crop?`${100/crop.height}%`:'100%',maxWidth:'none',objectFit:'cover',objectPosition:g?`${g.cropX}% ${g.cropY}%`:'50% 50%'};
}
export const PipFrame:React.FC<{instance:EditorInstance|null;g:ReturnType<typeof pipGeometry>|null;width:number;height:number;hidden?:boolean;sourceFrame?:number;borderColor:string;children:React.ReactNode}> = ({instance,g,width,height,hidden,sourceFrame,borderColor,children}) => {
  return <div data-editor-instance={instance?.id} data-editor-part={instance?'asset':undefined} data-source-pip={instance?'':undefined} data-source-frame={sourceFrame} style={{position:'absolute',left:g?.left??0,top:g?.top??0,width:g?.width??width,height:g?.height??height,zIndex:instance ? instance.zIndex*2+1 : 0,borderRadius:g?.radius??0,overflow:'hidden',pointerEvents:hidden?'none':'auto',opacity:g?.opacity??1,visibility:hidden?'hidden':'visible',transform:g?`perspective(1200px) scale(${g.scale}) rotateY(${g.rotateY}deg)`:undefined,boxShadow:g?.shadow?`0 ${g.shadow/3}px ${g.shadow}px rgba(0,0,0,.3)`:undefined}}>
    {children}
    <div style={{position:'absolute',inset:0,border:`${g?.borderWidth??0}px solid ${borderColor}`,borderRadius:g?.radius??0,boxSizing:'border-box',pointerEvents:'none'}} />
  </div>;
};
