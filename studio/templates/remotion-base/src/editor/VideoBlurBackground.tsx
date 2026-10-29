import React from 'react';
import {AbsoluteFill, useVideoConfig} from 'remotion';
import type {EditorDocument} from './types';
import {SourcePip} from './SourcePip';

/** A muted duplicate uses the same edited source clock as the main video. */
export const VideoBlurBackground: React.FC<{
  background: {blur:number;color:string};
  document?: EditorDocument;
  timelineStartFrame: number;
  previewSource?: {path:string;url:string};
}> = ({background,document,timelineStartFrame,previewSource}) => {
  const {width,height} = useVideoConfig();
  const shortSide = Math.min(width,height);
  const blur = background.blur * shortSide / 1080;
  // Extend the image by three blur radii on each edge to avoid dark fringes.
  const scale = 1 + 6 * blur / shortSide;
  return <AbsoluteFill data-scene-background="video-blur" style={{backgroundColor:background.color,overflow:'hidden',pointerEvents:'none'}}>
    {document?.source ? <AbsoluteFill style={{filter:`blur(${blur}px)`,transform:`scale(${scale})`}}>
      <SourcePip document={document} instance={null} rangeStartFrame={timelineStartFrame} previewSource={previewSource} muted/>
    </AbsoluteFill> : <AbsoluteFill style={{alignItems:'center',justifyContent:'center',color:'#AAB0BC',fontSize:shortSide/32}}>请先添加口播底片</AbsoluteFill>}
  </AbsoluteFill>;
};
