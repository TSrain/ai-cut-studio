import React from 'react';

const labels: Record<string,string> = {
  queued:'排队中', preparing:'准备素材', bundling:'准备动画', rendering:'渲染画面',
  encoding:'编码视频', verifying:'校验文件', complete:'已完成', failed:'导出失败', cancelled:'已取消', cancelling:'正在取消',
};
const time = (seconds:number) => {
  const value = Math.max(0,Math.round(seconds));
  return value < 60 ? `${value} 秒` : `${Math.floor(value/60)} 分 ${value%60} 秒`;
};

export const ExportProgress = ({item}: {item:any}) => {
  const queued = !['rendering','running','complete','failed','cancelled','cancelling'].includes(item.status);
  const telemetry = queued ? {} : item.telemetry ?? (Number.isFinite(item.progress) ? {stage:'rendering',progress:item.progress} : {});
  const stage = ['cancelled','cancelling'].includes(item.status) ? item.status : item.status === 'complete' ? 'complete' : item.status === 'failed' ? 'failed'
    : queued ? 'queued' : telemetry.stage === 'complete' ? 'verifying' : telemetry.stage ?? 'preparing';
  const terminal = stage === 'complete' || stage === 'failed' || stage === 'cancelled';
  const progress = ['bundling','rendering','encoding'].includes(stage) && Number.isFinite(telemetry.progress)
    ? Math.max(0,Math.min(1,telemetry.progress)) : undefined;
  return <div style={{marginTop:8,minWidth:220,maxWidth:480,fontSize:12,color:'var(--muted, #9297a3)'}}>
    <div style={{display:'flex',justifyContent:'space-between',gap:12}}>
      <span>{labels[stage] ?? labels.preparing}{progress !== undefined && ` · ${Math.round(progress*100)}%`}</span>
      {Number.isFinite(telemetry.completed) && Number.isFinite(telemetry.total) && progress !== undefined &&
        <span>{telemetry.completed}/{telemetry.total} 帧</span>}
    </div>
    {!queued && telemetry.detail && <div style={{marginTop:5}}>{telemetry.detail}</div>}
    {!terminal && <progress aria-label={labels[stage] ?? labels.preparing} max={1} value={progress}
      style={{display:'block',width:'100%',height:6,marginTop:6,accentColor:'var(--accent, #9aa8ff)'}} />}
    {!queued && Number.isFinite(telemetry.elapsedSeconds) && <div style={{marginTop:5}}>
      已用 {time(telemetry.elapsedSeconds)}
      {!terminal && progress !== undefined && progress < 1 && Number.isFinite(telemetry.etaSeconds) && telemetry.etaSeconds > 0 &&
        ` · 预计本阶段剩余 ${time(telemetry.etaSeconds)}`}
    </div>}
  </div>;
};
