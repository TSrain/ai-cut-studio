import React from 'react';
import type {PlanShot} from '../../templates/remotion-base/src/editor/types';
const time=(n:number)=>`${n.toFixed(2)} 秒`;
const summary=(intent:Record<string,unknown>)=>String(intent.description ?? intent.purpose ?? intent.reason ?? intent.mode ?? '已规划，制作时校准');
export function PlanTimingDetails({shot}:{shot:PlanShot}) {
  const t=shot.effectTiming,camera=shot.cameraIntent,layer=shot.presenterLayerIntent;
  if(!t&&!camera&&!layer)return null;
  return <details className="plan-design-timing"><summary>时间与镜头设计</summary>
    {t&&<><p>{t.status==='confirmed'?'已确认效果时间':'效果时间草案，制作时校准'}{shot.timing.manual?' · 当前采用手动区间':''}</p>
      <small>以下为原视频位置；上方计划区间已跟随剪辑映射。</small>
      <dl><dt>入场开始</dt><dd>{time(t.startSeconds)}</dd><dt>关键变化</dt><dd>{time(t.changeSeconds)}</dd><dt>停留结束／退场开始</dt><dd>{time(t.holdSeconds)}</dd><dt>退场完成</dt><dd>{time(t.endSeconds)}</dd></dl>
      <p>{t.evidence.reason}</p></>}
    {camera&&<p><b>镜头安排：</b>{summary(camera)}</p>}
    {layer&&<p><b>人物分层：</b>{summary(layer)}</p>}
  </details>;
}
