import React, {useId} from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';

export type NameWallAProps = {
  name: string; color: string; ink: string; strength: number; blur: number; speed: number;
  centerStrength?: number; contentWidth?: number; contentHeight?: number; feather?: number;
  signatureVisible?: boolean; signatureScale?: number; signatureX?: number; signatureY?: number;
  signatureInk?: string; signatureMuted?: string; accent?: string;
};
const fontFamily = '"Archivo", "Noto Sans SC", sans-serif';
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const modulo = (v: number, period: number) => ((v % period) + period) % period;

/** A fixed, feathered rectangular field. Only the pattern is attenuated. */
export const NameWallQuietArea: React.FC<{
  id: string; width: number; height: number; strength: number;
  areaWidth: number; areaHeight: number; feather: number;
}> = ({id, width, height, strength, areaWidth, areaHeight, feather}) => {
  const w=width*areaWidth/100, h=height*areaHeight/100;
  return <defs><filter id={`${id}-soft`} x="-100%" y="-100%" width="300%" height="300%" colorInterpolationFilters="sRGB">
    <feGaussianBlur stdDeviation={Math.min(width,height)*feather/100}/>
  </filter><mask id={id} maskUnits="userSpaceOnUse" x={0} y={0} width={width} height={height} style={{maskType:'luminance'}}>
    <rect width={width} height={height} fill="white"/>
    <rect x={(width-w)/2} y={(height-h)/2} width={w} height={h} fill="black" opacity={1-strength} filter={`url(#${id}-soft)`}/>
  </mask></defs>;
};

/** A separate, stationary signature; the name and yellow mark remain editable. */
export const NameWallSignature: React.FC<NameWallAProps> = (p) => {
  const {width,height}=useVideoConfig();
  if(p.signatureVisible!==true)return null;
  const size=width/1920*(p.signatureScale??1);
  const label=p.name.trim()||'大瑞 Keaton';
  const split=label.match(/^(\S+)\s+(.+)$/);
  const first=split?.[1]??label, second=split?.[2]??'';
  return <div data-name-wall-layer="signature" style={{position:'absolute',left:`${p.signatureX??4.5}%`,top:`${p.signatureY??4.5}%`,display:'flex',alignItems:'center',gap:16*size,whiteSpace:'nowrap',fontFamily}}>
    <span data-name-wall-layer="signature-mark" style={{display:'block',width:30*size,height:5*size,background:p.accent??'#E8B45B',flexShrink:0}}/>
    <span style={{display:'flex',alignItems:'baseline',gap:9*size,lineHeight:1.1}}>
      <span style={{fontWeight:850,fontSize:34*size,color:p.signatureInk??'#F0F2F5'}}>{first}</span>
      {second&&<span style={{fontWeight:700,fontSize:31*size,color:p.signatureMuted??'#8B939E'}}>{second}</span>}
    </span>
  </div>;
};

/** Three sparse rows. Whole name groups repeat, alternating fill and outline. */
export const NameWallA: React.FC<NameWallAProps> = (p) => {
  const frame=useCurrentFrame();
  const {width,height,fps}=useVideoConfig();
  const maskId=`name-wall-${useId().replace(/:/g,'')}`;
  const unit=Math.min(width,height)/1080;
  const label=p.name.trim()||'大瑞 Keaton';
  const fontSize=156*unit;
  const ems=Array.from(label).reduce((sum,c)=>sum+(/\s/.test(c)?.3:/[\u2e80-\u9fff\uf900-\ufaff]/.test(c)?1:.56),0);
  const textWidth=Math.max(1.8,ems)*fontSize;
  const tileWidth=textWidth+96*unit;
  // Fill/outline alternation repeats after TWO tiles. Modulo that full period
  // keeps wraps continuous; all rows translate together at 6 px/s by default.
  const period=tileWidth*2;
  const drift=modulo(frame/fps*10*clamp(p.speed,0,2)*unit,period);
  const columns=Math.ceil(width/tileWidth)+6;
  return <AbsoluteFill aria-hidden="true" style={{overflow:'hidden',pointerEvents:'none'}}>
    <AbsoluteFill data-name-wall-layer="base" style={{backgroundColor:p.color}}/>
    <svg data-name-wall-layer="pattern" width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{position:'absolute',inset:0}}>
      <NameWallQuietArea id={maskId} width={width} height={height} strength={p.centerStrength??1/3} areaWidth={p.contentWidth??65} areaHeight={p.contentHeight??60} feather={p.feather??12}/>
      <g data-name-wall-layer="fixed-mask" mask={`url(#${maskId})`}>
        <g style={{filter:p.blur>0?`blur(${p.blur*unit}px)`:undefined}}>
          {[.21,.55,.89].map((baseline,row)=><g key={row} transform={`translate(${-period-drift-(row===1?.38:.12)*tileWidth},${height*baseline})`}>
            {Array.from({length:columns},(_,column)=>{
              const outlined=column%2===1;
              return <text key={column} x={column*tileWidth} y={0} textLength={textWidth} lengthAdjust="spacingAndGlyphs"
                fill={outlined?'none':p.ink} stroke={outlined?p.ink:'none'} strokeWidth={outlined?1.7*unit:0}
                opacity={clamp(p.strength,0,1)*(outlined?.38:.24)} strokeLinejoin="round"
                style={{fontFamily,fontSize,fontWeight:900,letterSpacing:-2*unit}}>{label}</text>;
            })}
          </g>)}
        </g>
      </g>
    </svg>
    <NameWallSignature {...p}/>
  </AbsoluteFill>;
};
