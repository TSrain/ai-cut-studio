import {ensureTimeline,timelineItems,moveSelection} from './timeline-model.mjs';
export function insertEmptyTrack(document,kind,index){
 const d=ensureTimeline(document),key=kind==='audio'?'audioTracks':'tracks',tracks=d[key];
 if(!Number.isInteger(index)||index<0||index>tracks.length)throw Error('新轨道位置无效');
 const prefix=kind==='audio'?'audio':'visual';let n=1;while([...d.tracks,...d.audioTracks].some(t=>t.id===`${prefix}-${n}`))n++;
 const trackId=`${prefix}-${n}`;tracks.splice(index,0,{id:trackId,name:`${kind==='audio'?'音频':'叠加画面'} ${n}`});
 for(const i of d.instances)i.zIndex=d.tracks.findIndex(t=>t.id===i.trackId)*1000;
 return {document:d,trackId};
}
export function moveToNewTrack(document,ids,delta,index){
 const picked=timelineItems(document).filter(i=>ids.includes(i.key));
 if(!picked.length||picked.length!==new Set(ids).size)throw Error('所选片段不存在');
 if(picked.some(i=>i.locked))throw Error('所选轨道已锁定');
 if(picked.some(i=>i.kind==='source'))throw Error('主视频使用专属轨道');
 if(new Set(picked.map(i=>i.kind)).size!==1||new Set(picked.map(i=>i.trackId)).size!==1)throw Error('请拖动同一轨道的片段');
 const created=insertEmptyTrack(document,picked[0].kind==='audio'?'audio':'visual',index);
 return moveSelection(created.document,ids,delta,created.trackId);
}
/** Rows are in screen order; visual layer arrays run bottom to top. */
export function trackInsertionAt(rows,y,kind){
 if(!rows.length)return null;
 const boundaries=rows.map(r=>({top:r.top,index:r.index+(kind==='visual'?1:0)}));
 const last=rows.at(-1);boundaries.push({top:last.bottom,index:last.index+(kind==='audio'?1:0)});
 if(y<boundaries[0].top)return boundaries[0];
 if(y>boundaries.at(-1).top)return boundaries.at(-1);
 return boundaries.find(b=>Math.abs(b.top-y)<=7)??null;
}
