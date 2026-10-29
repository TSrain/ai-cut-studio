import { cameraDisplayClips } from './timeline-view.mjs';
export const productionKindNames={animation:'动画',footage:'素材',camera:'镜头',captions:'字幕',sound:'声音'};
const list=v=>Array.isArray(v)?v:[];
const text=v=>typeof v==='string'?v.trim():'';
const overlap=(a,b)=>a.startFrame<b.startFrame+b.durationFrames&&b.startFrame<a.startFrame+a.durationFrames;
const intersects=(a,b)=>list(a).some(x=>list(b).includes(x));
const rangeText=(r,fps)=>`${(r.startFrame/fps).toFixed(2)}–${((r.startFrame+r.durationFrames)/fps).toFixed(2)} 秒`;
const licenseName=v=>typeof v==='string'?v:v?.name??'';
export function getPlanShotView(doc,shot,jobs=[],resources={}) {
 const fps=doc.canvas.fps.num/doc.canvas.fps.den,ranges=list(shot.timing?.ranges),row=shot.upstream?.packageShot??shot.details?.packageShot??{};
 const archived=list(resources.analysis?.sections).find(s=>s.id===shot.id)??list(resources.analysis?.sections).find(s=>intersects(s.sourceCueIds,shot.sourceCueIds??row.sourceCueIds));
 const section={...row,...archived,...shot},cueIds=section.sourceCueIds??row.sourceCueIds??[];
 const related=r=>ranges.some(s=>overlap(r,s));
 const liveInstances=list(doc.instances).filter(i=>related(i));
 const bound=list(shot.bindings).map(b=>list(doc.instances).find(i=>i.id===b.instanceId)).filter(Boolean);
 const tracks=list(doc.tracks),audioTracks=list(doc.audioTracks);
 const visible=i=>!i.hidden&&!i.disabled&&tracks.find(t=>t.id===i.trackId)?.hidden!==true&&tracks.find(t=>t.id===i.trackId)?.disabled!==true;
 const itemFor=(i,kind)=>({text:i.name||i.assetId,time:rangeText(i,fps),status:visible(i)?'已入轨':'已隐藏',detail:kind==='animation'?`模板 ${i.assetId}`:'',instanceId:i.id});
 const templates=bound.filter(i=>i.assetId!=='source-pip'&&!i.props?.footageIdentity&&!i.props?.deliveryIdentity);
 const declaredNeed=shot.animationNeed??archived?.animationNeed??row.animationNeed;
 const required=declaredNeed==='required'||(!declaredNeed&&list(shot.slots).some(s=>s.type==='animation'));
 const sections=[];
 if(required||templates.length){
  const items=[];
  if(required){
   const changed=Object.hasOwn(shot,'animationNeed')&&shot.animationNeed!==archived?.animationNeed;
   const information=shot.requiredInformation||shot.relationships?[...list(shot.requiredInformation),...list(shot.relationships)]:changed?[text(shot.mediaDescription)]:[...list(section.information),...list(section.relations)];
   items.push({text:information.filter(Boolean).join('；')||text(shot.mediaDescription)||list(shot.slots).filter(s=>s.type==='animation').map(s=>s.description).join('；')||'需要动画',status:templates.length?'':'待制作'});
  }
  items.push(...templates.map(i=>itemFor(i,'animation')));
  if(required&&section.templateMatch?.gaps?.length)items.push({text:section.templateMatch.gaps.join('；'),status:'待补充'});
  sections.push({kind:'animation',title:required?'需要动画':'当前动画',items});
 }
 const review=resources.footage??{},footageSections=list(review.sections).filter(s=>s.id===shot.id||intersects(s.sourceCueIds,cueIds));
 const sectionIds=new Set([shot.id,...footageSections.map(s=>s.id)]);
 const placements=list(review.placements).filter(p=>sectionIds.has(p.sectionId)||intersects(p.sourceCueIds,cueIds));
 const candidates=[];
 for(const c of list(shot.candidates).filter(c=>!c.ignored))candidates.push({...c,url:c.url,status:c.localPath?'已下载':'网站线索',license:licenseName(c.license)});
 for(const c of list(review.candidates)){
  if(!list(c.matchedSectionIds).some(id=>sectionIds.has(id))&&!placements.some(p=>p.candidateId===c.id))continue;
  const instances=list(doc.instances).filter(i=>i.props?.footageIdentity?.candidateId===c.id&&related(i));
  candidates.push({...c,url:c.pageUrl??c.url,reason:c.matchReason??c.visibleContent??c.reason,path:c.path,previewPath:c.review?.frames?.[0]?.path??c.previewPath,license:licenseName(c.license),status:instances.length?'已入轨':c.path?(c.technical?.passed?'已核验 · 项目素材':'已下载 · 待核验'):'网站线索',instanceIds:instances.map(i=>i.id)});
 }
 // Website leads retain the retrieval boundary: no uninspected lead becomes a local asset.
 for(const s of footageSections)for(const c of [...list(s.candidates),...list(s.websiteLeads),...list(s.leads)])candidates.push({...c,url:c.pageUrl??c.url,status:c.path?'已下载 · 待核验':'网站线索',license:licenseName(c.license)});
 const uniqueCandidates=[...new Map(candidates.map(c=>[c.id??c.url,c])).values()].filter(c=>c.id||c.url);
 const media=liveInstances.filter(i=>i.assetId==='source-pip'||i.props?.footageIdentity||i.props?.deliveryIdentity||i.assetId?.startsWith('media-'));
 const footageItems=media.map(i=>({...itemFor(i,'footage'),text:i.name||'素材画面'}));
 const footagePlan=text(shot.footageIntent?.description??section.footageIntent?.description);
 if(footagePlan)footageItems.push({text:footagePlan,status:'计划'});
 for(const slot of list(shot.slots).filter(s=>s.type!=='animation'))if(!bound.some(i=>media.includes(i)))footageItems.push({text:slot.description,status:'待素材'});
 if(footageItems.length||uniqueCandidates.length)sections.push({kind:'footage',title:'素材画面',items:footageItems.length?footageItems:[{text:`${uniqueCandidates.length} 个候选，尚未安排入轨`,status:'候选'}]});
 let camera=[];try{camera=cameraDisplayClips(doc).filter(c=>related({startFrame:c.displayStart,durationFrames:c.displayEnd-c.displayStart}));}catch{camera=[];}
 const cameraItems=camera.map(c=>({text:c.holdToEnd?'推近后保持':`推近 → 保持${c.out>0?' → 拉回':''}`,detail:`${c.name||'真人镜头'} · ${c.zoom.toFixed(2)} 倍`,time:rangeText({startFrame:c.displayStart,durationFrames:c.displayEnd-c.displayStart},fps),status:c.enabled===false?'已关闭':'已应用'}));
 const cameraIntent=section.cameraIntent;
 if(!cameraItems.length&&cameraIntent&&!['none','keep-original','base-framing-and-footage'].includes(cameraIntent.decision??cameraIntent.mode)){
  const detail=text(cameraIntent.description??cameraIntent.intent??cameraIntent.reason??cameraIntent.purpose);
  if(detail)cameraItems.push({text:detail,status:'计划'});
 }
 if(cameraItems.length)sections.push({kind:'camera',title:'真人镜头',items:cameraItems});
 const cues=list(doc.captions?.cues).filter(c=>related({startFrame:c.startFrame,durationFrames:c.endFrame-c.startFrame}));
 const captionIntent=section.captionIntent??section.captionsIntent;
 if(cues.length||captionIntent){sections.push({kind:'captions',title:'字幕',items:[...(cues.length?[{text:cues.map(c=>c.text).join(' / '),detail:`${cues.length} 条字幕`,status:doc.captions?.enabled===false?'已关闭':'已应用'}]:[]),...(captionIntent?[{text:typeof captionIntent==='string'?captionIntent:text(captionIntent.description??captionIntent.intent),status:'计划'}]:[])]});}
 const audio=list(doc.audioClips).filter(related);
 const soundItems=audio.map(c=>({text:c.name||'音效',detail:`音量 ${Math.round((c.volume??1)*100)}%`,time:rangeText(c,fps),status:c.muted||c.disabled||audioTracks.find(t=>t.id===c.trackId)?.muted||audioTracks.find(t=>t.id===c.trackId)?.disabled?'已静音':'已入轨 · 待试听'}));
 const sound=shot.soundDesign??archived?.soundDesign??row.soundDesign;
 if(!audio.length&&sound?.decision==='cues')for(const c of list(sound.cues))soundItems.push({text:c.intent||c.event||'音效',detail:[c.anchor,c.texture].filter(Boolean).join('；'),status:'待安排'});
 const actions=list(shot.productionActions??row.productionActions);
 const soundIntent=text(shot.soundIntent??(!sound?.decision?row['声音意图']:''));
 if(!soundItems.length&&soundIntent&&!/^(无|保留原声|原声|不加音效)/.test(soundIntent))soundItems.push({text:soundIntent,status:'计划'});
 if(!soundItems.length&&actions.some(a=>['sound','music','audio'].includes(a)))soundItems.push({text:'声音安排待补充',status:'计划'});
 if(!soundItems.length&&sound?.decision==='silence')soundItems.push({text:'保留人声，不加音效',status:''});
 if(soundItems.length)sections.push({kind:'sound',title:'声音',items:soundItems});
 const kinds=shot.cancelled?[]:sections.filter(s=>s.kind==='captions'?!!captionIntent:s.kind==='sound'?audio.length||sound?.decision==='cues'||soundIntent||actions.some(a=>['sound','music','audio'].includes(a)):true).map(s=>s.kind);
 return {shotId:shot.id,title:shot.title,narration:shot.narration,ranges,time:ranges.length?ranges.map(r=>rangeText(r,fps)).join('、'):'尚未定位',sections,candidates:uniqueCandidates,kinds};
}
/** Minimal editorial preview. Engineering detail stays available in full controls. */
export function getPlanPreviewView(doc,shot,jobs=[],resources={}){
 const full=getPlanShotView(doc,shot,jobs,resources),row=shot.upstream?.packageShot??shot.details?.packageShot??{};
 const ids=shot.sourceCueIds??row.sourceCueIds??[];
 const semantic=list(resources.analysis?.sections).find(s=>s.id===shot.id)??list(resources.analysis?.sections).find(s=>intersects(s.sourceCueIds,ids))??{};
 const footageSections=list(resources.footage?.sections).filter(s=>s.id===shot.id||intersects(s.sourceCueIds,ids));
 const active=list(doc.instances).filter(i=>full.ranges.some(r=>overlap(i,r))&&!i.disabled&&!i.hidden&&!list(doc.tracks).some(t=>t.id===i.trackId&&(t.disabled||t.hidden)));
 const animationIds=new Set(list(shot.bindings).filter(b=>list(shot.slots).some(s=>s.id===b.slotId&&s.type==='animation')).map(b=>b.instanceId));
 const native=active.some(i=>animationIds.has(i.id)||i.props?.deliveryIdentity||(i.assetId!=='source-pip'&&!i.assetId?.startsWith('media-')));
 const actualFootage=active.some(i=>i.props?.footageIdentity||((i.assetId==='source-pip'||i.assetId?.startsWith('media-'))&&!animationIds.has(i.id)&&!i.props?.deliveryIdentity&&!i.props?.aiVideoIdentity&&(i.props?.sourceMode==='media'||i.props?.media)));
 const animationNeed=shot.animationNeed??shot.animationBrief?.animationNeed??semantic.animationNeed??row.animationNeed;
 const plannedTemplate=(shot.templateMatch??semantic.templateMatch??row.templateMatch)?.status;
 const requestedAnimation=['required','optional'].includes(animationNeed)||(!animationNeed&&(native||list(shot.slots).some(s=>s.type==='animation')||['direct','partial'].includes(plannedTemplate)));
 const revisedFootage=jobs.some(j=>j.kind==='revise'&&j.shotId===shot.id&&list(j.results).some(r=>r.kind==='shot-revision'&&r.state==='applied'&&list(r.patches).some(p=>p.entity==='shot'&&p.id===shot.id&&['visualRequirement','mediaDescription'].includes(p.field)&&JSON.stringify(p.after)===JSON.stringify(shot[p.field])&&JSON.stringify(p.before)!==JSON.stringify(p.after))));
 const footageIntent=text(shot.footageIntent?.description??row.footageIntent?.description)||(revisedFootage?text(shot.visualRequirement)||text(shot.mediaDescription):'');
 const plannedFootage=footageSections.some(s=>s.footageNeed==='required')||!!footageIntent||list(shot.slots).some(s=>s.type!=='animation');
 const networkItems=active.filter(i=>i.props?.footageIdentity&&!i.props?.aiVideoIdentity).map(i=>({text:i.name?.replace(/^真实素材\s*[·：:]\s*/,'')||'网络素材',time:rangeText(i,doc.canvas.fps.num/doc.canvas.fps.den),status:'已入轨',instanceId:i.id}));
 const networkFootage=full.candidates.some(c=>!c.ignored)||networkItems.length>0;
 const aiCandidates=list(shot.aiVideoCandidates).filter(c=>!c.ignored&&text(c.prompt)&&c.requirementVersion===shot.requirementVersion);
 const needFootage=actualFootage||plannedFootage||networkFootage;
 const visualKinds=shot.cancelled?[]:[...(requestedAnimation||native?['animation']:[]),...(networkFootage?['footage']:[]),...(aiCandidates.length?['aiVideo']:[])];
 const visible=!shot.cancelled&&(requestedAnimation||native||needFootage||aiCandidates.length>0);
 const category=(requestedAnimation||native)&&needFootage?'mixed':requestedAnimation||native?'animation':'footage';
 const information=shot.requiredInformation??semantic.information??row.requiredInformation;
 const raw=text(shot.expressionGoal)||list(shot.requiredInformation).join('；')||text(semantic.goal)||list(information).join('；')||text(shot.visualRequirement)||text(shot.mediaDescription);
 const sentences=raw.replace(/\s+/g,' ').replace(/^(?:理解|记住)(?=[\u4e00-\u9fff])/,'').split(/(?<=[。！？!?])/).filter(Boolean);
 const summary=sentences.slice(0,2).join('').slice(0,110).replace(/[；，、 ]+$/,'');
 const targets=footageSections.flatMap(s=>list(s.visualTargets).map(t=>text(t.description))).filter(Boolean);
 const searchIntent=footageIntent||[...new Set(targets)].slice(0,3).join('；')||list(shot.slots).filter(s=>s.type!=='animation').map(s=>s.description).join('；')||full.candidates.slice(0,2).map(c=>c.visibleContent||c.title).filter(Boolean).join('；')||networkItems.slice(0,2).map(i=>i.text).join('；').slice(0,110);
 const narration=text(shot.narration)||text(row.narration)||list(doc.captions?.cues).filter(c=>full.ranges.some(r=>overlap({startFrame:c.startFrame,durationFrames:c.endFrame-c.startFrame},r))).map(c=>c.text).join('\n');
 const brief={...semantic,...row.animationBrief,...shot.animationBrief};
 const animationTexts=[
  text(brief.goal)||text(shot.expressionGoal)||text(shot.visualRequirement)||summary,
  list(shot.requiredInformation??brief.information).join('；'),
  list(shot.relationships??brief.relations).join('；'),
  text(brief.reason)||text((shot.templateMatch??semantic.templateMatch??row.templateMatch)?.reason),
  ...active.filter(i=>animationIds.has(i.id)||i.props?.deliveryIdentity||(i.assetId!=='source-pip'&&!i.assetId?.startsWith('media-'))).map(i=>i.name?`当前动画：${i.name}`:''),
 ].filter(Boolean);
 const animationSection={kind:'animation',title:'动画安排',items:requestedAnimation||native?[...new Set(animationTexts)].map(value=>({text:value})).concat(animationTexts.length?[]:[{text:'适合尝试动画，具体安排尚未补充'}]):[{text:'保留口播画面，无需额外动画'}]};
 const sections=visible?[
  ...(narration?[{kind:'narration',title:'本段口播',items:[{text:narration}]}]:[]),
  animationSection,
  ...(needFootage&&searchIntent?[{kind:'footage',title:'真实素材',items:[{text:searchIntent}]}]:[]),
  ...(aiCandidates.length?[{kind:'aiVideo',title:'AI 视频',items:aiCandidates.map(c=>({text:c.title,detail:c.reason}))}]:[]),
 ]:[];
 return {...full,visible,tryAnimation:requestedAnimation,category,visualKinds,networkItems,animationSection:visualKinds.includes('animation')?animationSection:undefined,sections,kinds:visible?[...(requestedAnimation||native?['animation']:[]),...(needFootage?['footage']:[])]:[]};
}
