import {sourceFrameAt,projectSourceRange} from './clip-time.mjs';
export function validatePresenterLayer(document,instance){
 if(instance.props?.presenterLayer!=='behind')return;
 const m=instance.props.presenterForeground,s=document.source,fps=document.canvas.fps.num/document.canvas.fps.den;
 if(!m||m.version!==1||!s||m.sourcePath!==s.path||m.sourcePublicPath!==s.publicPath)throw Error('人物前景与当前底片不匹配，请重新准备');
 if(m.fps!==fps||![m.sourceStartFrame,m.frameCount,m.width,m.height].every(Number.isInteger)||m.sourceStartFrame<0||m.frameCount<1||m.width<1||m.height<1||!m.sourceSha256?.match(/^[a-f0-9]{64}$/)||!m.framesPublicPath||m.framesPublicPath.startsWith('/')||m.framesPublicPath.split('/').includes('..'))throw Error('人物前景元数据无效');
 if(instance.assetId==='source-pip'||instance.props.editorBackground!=='transparent'||instance.props.sceneBackground)throw Error('人物背后层仅支持透明文字/动画；不能使用小窗或整屏背景');
 const ranges=projectSourceRange(s,m.sourceStartFrame,m.sourceStartFrame+m.frameCount,document.canvas.durationFrames);
 let cursor=instance.startFrame;for(const r of ranges.sort((a,b)=>a.startFrame-b.startFrame)){if(r.startFrame<=cursor&&r.endFrame>cursor)cursor=r.endFrame;}
 if(cursor<instance.startFrame+instance.durationFrames)throw Error('人物前景未覆盖当前剪辑区间，请重新准备所需源帧');
}
export function presenterFrame(document,instance,frame){
 validatePresenterLayer(document,instance);
 const m=instance.props.presenterForeground,n=sourceFrameAt(document.source,frame,document.canvas.durationFrames);
 if(n===null||n<m.sourceStartFrame||n>=m.sourceStartFrame+m.frameCount)throw Error('当前底片帧超出人物前景区间');
 return `${m.framesPublicPath}/${String(n-m.sourceStartFrame).padStart(6,'0')}.png`;
}

/** Match SourcePip's centered object-fit:cover, then its camera scale/anchor. */
export function presenterMaskGeometry(canvas,matte,zoom,anchor){
 const fit=Math.max(canvas.width/matte.width,canvas.height/matte.height);
 const width=matte.width*fit,height=matte.height*fit;
 return {width:width*zoom,height:height*zoom,
  left:(canvas.width-width)/2*zoom+(1-zoom)*anchor.x*canvas.width,
  top:(canvas.height-height)/2*zoom+(1-zoom)*anchor.y*canvas.height};
}
