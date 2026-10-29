import React from 'react';
import {Audio,Sequence,staticFile,useCurrentFrame} from 'remotion';
import type {EditorDocument,AudioClip} from './types';
import {audioVolumeAt} from './audio.mjs';
const Clip:React.FC<{clip:AudioClip}>=({clip})=>{const frame=useCurrentFrame();return <Audio useWebAudioApi allowAmplificationDuringRender src={clip.publicPath?staticFile(clip.publicPath):`/${clip.path}`} trimBefore={clip.sourceInFrame} volume={audioVolumeAt(clip,frame)}/>;};
export const AudioLayer:React.FC<{document:EditorDocument;rangeStartFrame?:number}>=({document,rangeStartFrame=0})=><>{(document.audioClips??[]).filter(c=>!c.muted&&!document.audioTracks?.find(t=>t.id===c.trackId)?.disabled).map(c=><Sequence key={c.id} from={c.startFrame-rangeStartFrame} durationInFrames={c.durationFrames} layout="none"><Clip clip={c}/></Sequence>)}</>;
