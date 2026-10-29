import React from 'react';
import {AbsoluteFill} from 'remotion';
import '../lib/fonts';
import {NameWallA} from './backgrounds/NameWallA';
import {NameWallB} from './backgrounds/NameWallB';
import type {EditorDocument} from './types';
import {VideoBlurBackground} from './VideoBlurBackground';
import {resolveSceneBackground} from './scene-background.mjs';
export const SceneBackground:React.FC<{props:any;document?:EditorDocument;timelineStartFrame?:number;previewSource?:{path:string;url:string}}>=({props,document,timelineStartFrame=0,previewSource})=>{
 const bg=resolveSceneBackground(props);if(!bg)return null;
 if(bg.type==='video-blur')return <VideoBlurBackground background={bg} document={document} timelineStartFrame={timelineStartFrame} previewSource={previewSource}/>;
 if(bg.type==='solid')return <AbsoluteFill data-scene-background="solid" style={{backgroundColor:bg.color,pointerEvents:'none'}}/>;
 if(bg.type==='gradient')return <AbsoluteFill data-scene-background="gradient" style={{background:bg.gradientType==='radial'?`radial-gradient(ellipse at center, ${bg.color} 0%, ${bg.color2} 100%)`:`linear-gradient(${bg.angle}deg, ${bg.color} 0%, ${bg.color2} 100%)`,pointerEvents:'none'}}/>;
 const Wall=bg.type==='wall-a'?NameWallA:NameWallB;
 return <AbsoluteFill data-scene-background={bg.type} style={{pointerEvents:'none'}}><Wall {...bg}/></AbsoluteFill>;
};
export const SceneBackgroundPreview:React.FC<{background:any}>=({background})=><SceneBackground props={{sceneBackground:background}}/>;
