import React from 'react';
import {Freeze,Img,Loop,OffthreadVideo,staticFile,useCurrentFrame,useVideoConfig} from 'remotion';
import {EditorBackground,EditorScene,EditableText} from '../editor/preset-editing';
import {SceneBackground} from '../editor/SceneBackground';
import {TuneSkin} from '../style/tune';
import {stageGeometry,stageVideoTiming,titleCharacterState} from './media-stage.mjs';
import {TUNE_FONTS} from './KeyConcept';
import '../lib/fonts';

export type MediaStageProps={durationSeconds:number;canvas?:string;sceneBackground?:any;editorBackground?:'original'|'transparent';variant?:{titleFace?:'smiley'|'serif'|'bold';titleFx?:'stagger'|'reveal'|'tracking';fit?:'contain'|'cover';ratio?:'auto'|'16:9'|'9:16'|'1:1';videoEnd?:'freeze'|'loop';sound?:'off'|'keep'};slots:{title:string;image?:string;clip?:string;imgW?:number;imgH?:number;srcW?:number;srcH?:number;srcDur?:number;startSeconds?:number;mediaScale?:number;radius?:number};tune?:any};
const FACE={smiley:{fontFamily:'"Archivo", "Smiley Sans"',fontWeight:400},serif:{fontFamily:'"Instrument Serif", "Noto Serif SC"',fontWeight:700},bold:{fontFamily:'"Archivo", "Noto Sans SC"',fontWeight:850}};
const mediaUrl=(path:string,dir:string)=>staticFile(path.includes('/')?path:`${dir}/${path}`);
const Inner:React.FC<MediaStageProps>=(props)=>{
 const {slots,variant={},tune={}}=props,frame=useCurrentFrame(),{width,height,fps}=useVideoConfig();
 const unit=Math.min(width/1920,height/1080),portrait=height>width;
 const video=Boolean(slots.clip),path=video?slots.clip:slots.image;
 const sourceRatio=video?(slots.srcW??1920)/(slots.srcH??1080):(slots.imgW??1920)/(slots.imgH??1080);
 const ratios={'16:9':16/9,'9:16':9/16,'1:1':1},ratio=variant.ratio&&variant.ratio!=='auto'?ratios[variant.ratio]:sourceRatio;
 const g=stageGeometry(width,height,ratio,slots.mediaScale??1);
 const mediaIn=1-Math.pow(1-Math.max(0,Math.min(1,(frame/fps-.18)/.62)),3);
 const title=slots.title??'',chars=Array.from(title);
 const titleSize=Math.min((portrait?94:70)*unit,(width*.8)/(Math.max(1,chars.reduce((n,c)=>n+(/[\u0000-\u007f]/.test(c)?.58:1),0)))) ;
 const face=FACE[variant.titleFace??'smiley'];
 const timing=stageVideoTiming(slots.srcDur??props.durationSeconds,slots.startSeconds??0,fps);
 const style:React.CSSProperties={width:'100%',height:'100%',objectFit:variant.fit??'contain',display:'block'};
 const videoNode=path&&video?<OffthreadVideo src={mediaUrl(path,'footage')} trimBefore={timing.trim} muted={variant.sound!=='keep'} pauseWhenBuffering={false} style={style}/>:null;
 return <EditorScene style={{backgroundColor:'#10151C'}}>
  <EditorBackground><SceneBackground props={{...props,sceneBackground:props.sceneBackground??{type:'wall-a'}}}/></EditorBackground>
  <div style={{position:'absolute',inset:0,transform:`translate(${tune.x??0}px,${tune.y??0}px) scale(${tune.scale??1})`}}>
   <div style={{position:'absolute',left:width*.07,top:portrait?Math.max(height*.065,g.y-titleSize*1.45-height*.045):height*.065,display:'flex',alignItems:'center',gap:26*unit,maxWidth:width*.86}}>
    <div style={{width:36*unit,height:4*unit,background:'#E8B45B',transformOrigin:'left',transform:`scaleX(${Math.min(1,frame/(fps*.32))})`,flexShrink:0}}/>
    <EditableText part="title" style={{...face,...(tune.font&&tune.font!=='skin'?{fontFamily:TUNE_FONTS[tune.font as keyof typeof TUNE_FONTS]}:{}),fontSize:titleSize,lineHeight:1.45,color:'#F0F2F5',letterSpacing:'.025em',whiteSpace:'pre',fontSynthesis:'none'}}>
     {chars.map((c,i)=>{const a=titleCharacterState(frame,fps,i,chars.length,variant.titleFx??'stagger');return <span key={i} style={{display:'inline-block',overflow:'hidden',verticalAlign:'top',padding:'0 .06em',margin:'0 -.06em'}}><span style={{display:'inline-block',opacity:a.opacity,transform:`translate(${a.x}em,${a.y}%)`}}>{c}</span></span>;})}
    </EditableText>
   </div>
   <div data-editor-part="media" style={{position:'absolute',left:g.x,top:g.y,width:g.width,height:g.height,overflow:'hidden',borderRadius:(slots.radius??18)*unit,opacity:mediaIn,transform:`translateY(${24*unit*(1-mediaIn)}px) scale(${.975+.025*mediaIn})`,boxShadow:'0 24px 80px #00000045',outline:'1px solid #ffffff15'}}>
    {path?video?(variant.videoEnd==='loop'?<Loop durationInFrames={timing.available}>{videoNode}</Loop>:<Freeze active={frame>=timing.available} frame={timing.available-1}>{videoNode}</Freeze>):<Img src={mediaUrl(path,'screens')} style={style}/>:null}
   </div>
  </div>
 </EditorScene>;
};
export const PresetMediaStage:React.FC<MediaStageProps>=(p)=><TuneSkin tune={p.tune}><Inner {...p}/></TuneSkin>;
