import {resolveCaptionStyle,validateCaptionTrack} from '../../templates/remotion-base/src/editor/captions.mjs';
/** A shared delta preserves spacing between inherited and per-cue positions. */
export function moveCaptionPositions(track,ids,dx,dy){
 if(!Number.isFinite(dx)||!Number.isFinite(dy))throw Error('字幕位移必须是有限数值');
 const chosen=new Set(ids),selected=track.cues.filter(c=>chosen.has(c.id));
 if(!selected.length||(!dx&&!dy))return track;
 const styles=selected.map(c=>resolveCaptionStyle(track,c));
 dx=Math.max(-Math.min(...styles.map(s=>s.positionXPercent)),Math.min(100-Math.max(...styles.map(s=>s.positionXPercent)),dx));
 dy=Math.max(Math.max(...styles.map(s=>s.bottomPercent))-90,Math.min(Math.min(...styles.map(s=>s.bottomPercent)),dy));
 if(!dx&&!dy)return track;
 const next={...track,cues:track.cues.map(c=>{if(!chosen.has(c.id))return c;const s=resolveCaptionStyle(track,c);return {...c,style:{...c.style,positionXPercent:s.positionXPercent+dx,bottomPercent:s.bottomPercent-dy}};})};
 validateCaptionTrack(next);return next;
}
export function createCaptionPositionDrag({track,ids,x,y,width,height,onPreview,onCommit}){
 if(!(width>0&&height>0))throw Error('字幕预览尺寸无效');
 let latest=track,started=false,closed=false;
 return {
  move(point){if(closed)return;const dx=point.clientX-x,dy=point.clientY-y;if(!started&&Math.hypot(dx,dy)<4)return;started=true;latest=moveCaptionPositions(track,ids,dx/width*100,dy/height*100);onPreview(latest);},
  end(){if(closed)return;closed=true;if(latest!==track)onCommit(latest);},
  cancel(){if(closed)return;closed=true;onPreview(track);},
 };
}
