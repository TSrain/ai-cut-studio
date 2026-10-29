import React from 'react';
import {Player, Thumbnail} from '@remotion/player';
import {useCurrentFrame} from 'remotion';
import {ChapterProgress} from '../../templates/remotion-base/src/editor/ChapterProgress';
import {MediaComposition} from '../../templates/remotion-base/src/editor/MediaComposition';
import {PipFrame} from '../../templates/remotion-base/src/editor/SourcePip';
import {pipGeometry, PIP_DEFAULTS} from '../../templates/remotion-base/src/editor/source-pip.mjs';
import {defaultMediaProps} from '../../templates/remotion-base/src/editor/media-layout.mjs';

const frames=180, width=640, height=360;
const chapters=[['开场',0,60],['核心观点',60,120],['总结',120,180]].map(([title,startFrame,endFrame],i)=>({id:String(i),title:String(title),startFrame:Number(startFrame),endFrame:Number(endFrame),sourceCueIds:[]}));
const demoMedia = {
  'media-stack': [
    {kind:'image',publicPath:'assets/editor-demos/project-readme.png',width:2318,height:714},
    {kind:'image',publicPath:'assets/editor-demos/remotion-page.jpg',width:1200,height:4000},
    {kind:'image',publicPath:'assets/editor-demos/release-notes.png',width:1140,height:530},
  ],
  'media-split': [
    {kind:'video',publicPath:'assets/editor-demos/talking-head.mp4',width:960,height:540,durationSeconds:6},
    {kind:'video',publicPath:'assets/editor-demos/workspace.mp4',width:960,height:540,durationSeconds:6},
  ],
};
const mediaInstances=Object.fromEntries(['media-stack','media-split'].map(id=>{
  const props=defaultMediaProps(id);
  props.items=props.items.map((item:any,i:number)=>({...item,media:demoMedia[id][i]}));
  return [id,{id:`demo-${id}`,assetId:id,startFrame:0,durationFrames:frames,zIndex:0,props}];
}));

/** Uses the editor's actual layout and motion with sample content, without editing a project. */
function BuiltinDemo({assetId}:{assetId:string}) {
  const frame=useCurrentFrame();
  if(assetId==='chapter-progress')return <div style={{position:'absolute',inset:0,background:'#17212e'}}><ChapterProgress chapters={chapters} thickness={12} tune={{y:62}} elements={Object.fromEntries(chapters.map(c=>[c.id,{fontSize:24}]))}/></div>;
  if(assetId!=='source-pip')return <MediaComposition instance={mediaInstances[assetId] as any}/>;
  const props={...PIP_DEFAULTS,transitionSeconds:.8};
  const g=pipGeometry(width,height,frames,frame,30,props);
  return <div style={{position:'absolute',inset:0,background:'#162132'}}>
    <svg viewBox="0 0 640 360" style={{width:'100%',height:'100%'}}><path d="M48 265L128 184L215 225L328 110L404 155" fill="none" stroke="#82b1eb" strokeWidth="12"/><rect x="48" y="45" width="230" height="20" rx="10" fill="#dce6f4"/></svg>
    <PipFrame instance={{id:'demo-pip',zIndex:0} as any} g={g} width={width} height={height} borderColor={props.borderColor}>
      <svg viewBox="0 0 360 360" preserveAspectRatio="xMidYMid slice" style={{width:'100%',height:'100%',background:'#a8794c'}}><circle cx="180" cy="133" r="61" fill="#fff0d9"/><path d="M58 360v-65a122 115 0 0 1 244 0v65" fill="#e6d6be"/></svg>
    </PipFrame>
  </div>;
}
export function TemplateHoverPreview({assetId,active}:{assetId:string;active:boolean}) {
  const common={component:BuiltinDemo,inputProps:{assetId},durationInFrames:frames,compositionWidth:width,compositionHeight:height,fps:30,style:{width:'100%',height:'100%',pointerEvents:'none' as const}};
  return <div data-hover-preview={assetId} data-preview-active={active} style={{width:'100%',height:'100%'}}>
    {active?<Player {...common} autoPlay loop initiallyMuted controls={false} clickToPlay={false} spaceKeyToPlayOrPause={false} acknowledgeRemotionLicense/>:<Thumbnail {...common} frameToDisplay={90}/>}
  </div>;
}
