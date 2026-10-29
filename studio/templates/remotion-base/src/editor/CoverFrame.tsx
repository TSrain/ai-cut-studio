import React from 'react';
import {AbsoluteFill,Img,staticFile} from 'remotion';
export const CoverFrame:React.FC<{publicPath:string}>=({publicPath})=>{
 const src=staticFile(publicPath);
 return <AbsoluteFill style={{zIndex:2147483647,overflow:'hidden',background:'#111318',pointerEvents:'none'}}>
  <Img src={src} style={{position:'absolute',width:'100%',height:'100%',objectFit:'cover',filter:'blur(32px) brightness(.55)',transform:'scale(1.12)'}}/>
  <Img src={src} style={{position:'absolute',width:'100%',height:'100%',objectFit:'contain'}}/>
 </AbsoluteFill>;
};
