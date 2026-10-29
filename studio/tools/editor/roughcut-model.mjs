import {rippleProject} from './source-ripple.mjs';
import {sha256Hex} from './sha256.mjs';
import {DEFAULT_CAPTION_STYLE,validateCaptionTrack} from '../../templates/remotion-base/src/editor/captions.mjs';

// This is a policy score, not an estimated probability of a correct deletion.
const AUTO_DELETE_SCORE = 0.9;
const fail = message => { throw new Error(`粗剪：${message}`); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value, label, min = 0) => { if (!Number.isSafeInteger(value) || value < min) fail(`${label}必须是${min ? '正' : '非负'}整数帧`); };
const clone = value => structuredClone(value);
function stable(value) {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
// v1 stored the exact canonical JSON (hundreds of KB per document). v2 stores the full
// SHA-256 of the same canonical JSON: collision-resistant, constant size. Documents with
// v1 values still validate exactly and are upgraded the next time the state is written.
const legacyFingerprint = value => `roughcut-v1:${stable(value)}`;
const fingerprint = value => `roughcut-v2:${sha256Hex(stable(value))}`;
function fingerprintMatches(stored, value) {
  if (typeof stored !== 'string') return false;
  if (stored.startsWith('roughcut-v2:')) return stored === fingerprint(value);
  return stored.startsWith('roughcut-v1:') && stored === legacyFingerprint(value);
}
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function fpsValue(fps) {
  if (!plain(fps)) fail('缺少原片帧率');
  integer(fps.num, '帧率分子', 1); integer(fps.den, '帧率分母', 1);
  return fps.num / fps.den;
}
function identity(document) {
  const s = document?.source;
  return {source:s ? {path:s.path ?? null,publicPath:s.publicPath ?? null,startFrame:s.startFrame ?? 0,durationFrames:s.durationFrames ?? null,sha256:s.sha256 ?? null,mediaIdentity:s.mediaIdentity ?? null,clips:s.clips === undefined ? null : s.clips.map(({id,startFrame,durationFrames,sourceInFrame})=>({id,startFrame,durationFrames,sourceInFrame}))} : null,fps:document?.canvas?.fps,durationFrames:document?.canvas?.durationFrames};
}
// The source key is an identity shared with analysis jobs; it stays in the exact v1 form.
export function roughcutSourceKey(document) { return legacyFingerprint(identity(document)); }
function optionsFor(options = {}) {
  if (!plain(options)) fail('参数格式无效');
  const result = {minPauseSeconds:options.minPauseSeconds ?? 1.2,keepPauseSeconds:options.keepPauseSeconds ?? 0.5};
  if (!Number.isFinite(result.minPauseSeconds) || !Number.isFinite(result.keepPauseSeconds) || result.minPauseSeconds <= 0 || result.keepPauseSeconds <= 0 || result.keepPauseSeconds >= result.minPauseSeconds) fail('停顿参数须为正数，保留气口必须短于最小停顿');
  return result;
}
function assertSimple(document, initial = false) {
  const source = document?.source;
  if (!plain(source) || typeof source.path !== 'string' || !source.path) fail('请先载入完整原片');
  if (source.locked || source.clips?.some(c => c.locked) || document.captions?.locked || document.tracks?.some(t => t.locked) || document.audioTracks?.some(t => t.locked)) fail('原片或轨道已锁定，请先解锁或建立原片副本');
  if (document.instances?.length || document.audioClips?.length || document.markers?.length || source.cameraPlan || document.productionPlan) fail('工程已有镜头、素材、音频、标记或制作计划，请建立原片粗剪副本，避免重排现有修改');
  fpsValue(document.canvas?.fps); integer(document.canvas?.durationFrames, '工程时长', 1);
  if (!initial) return;
  const duration = document.canvas.durationFrames;
  if ((source.startFrame ?? 0) !== 0 || (source.durationFrames !== undefined && source.durationFrames !== duration)) fail('仅完整原片可直接粗剪，请建立原片副本');
  if (source.clips !== undefined && (!Array.isArray(source.clips) || source.clips.length !== 1 || source.clips[0].startFrame !== 0 || source.clips[0].sourceInFrame !== 0 || source.clips[0].durationFrames !== duration)) fail('原片已经手动剪辑或映射不完整，请建立原片粗剪副本');
  if (document.captions !== undefined) validateCaptionTrack(document.captions, {durationFrames:duration});
}
const originalDocument = original => ({source:original.source,canvas:{fps:original.fps,durationFrames:original.canvasDurationFrames},...(original.hadCaptions ? {captions:original.captions} : {})});
const resultParts = document => ({source:document.source,fps:document.canvas.fps,durationFrames:document.canvas.durationFrames,captions:document.captions ?? null});
function readAnalysis(input, original) {
  if (!plain(input) || input.version !== 1 || !['word','segment'].includes(input.timing) || !Array.isArray(input.units) || !Array.isArray(input.decisions) || !Array.isArray(input.silences)) fail('分析结果格式无效');
  const fps = fpsValue(original.fps), duration = original.canvasDurationFrames;
  if (input.sourceKey !== roughcutSourceKey(originalDocument(original))) fail('分析来源与当前原片不匹配，原片或时间轴可能已变更，请重新分析');
  if (!Number.isFinite(input.sourceDurationSeconds) || input.sourceDurationSeconds <= 0 || Math.abs(input.sourceDurationSeconds - duration/fps) > Math.max(2.001/fps,original.timingToleranceSeconds ?? 0)) fail('分析原片时长与工程不匹配');
  const a = clone(input), ids = new Map(); let last = -1;
  if (a.warnings === undefined) a.warnings = [];
  if (!Array.isArray(a.warnings) || a.warnings.some(w => typeof w !== 'string')) fail('分析警告须为文字列表');
  for (const [index,u] of a.units.entries()) {
    if (!plain(u) || typeof u.id !== 'string' || !u.id || ids.has(u.id) || typeof u.text !== 'string' || !u.text.trim()) fail('字词 ID 为空、重复或原话缺失');
    if (!Number.isFinite(u.startSeconds) || !Number.isFinite(u.endSeconds) || u.startSeconds < 0 || u.endSeconds <= u.startSeconds || u.endSeconds > input.sourceDurationSeconds + 1e-7 || u.startSeconds < last) fail('字词时间乱序、非法或超出原片');
    if (!['word','segment'].includes(u.timing ?? a.timing)) fail('字词时间精度无效');
    if (u.groupId !== undefined && (typeof u.groupId !== 'string' || !u.groupId)) fail('字词分组无效');
    for (const field of ['safeBoundaries','completeSentence']) if (u[field] !== undefined && typeof u[field] !== 'boolean') fail('字词保护标记无效');
    if (u.protectionReasons !== undefined && (!Array.isArray(u.protectionReasons) || u.protectionReasons.some(r => typeof r !== 'string'))) fail('字词保护原因无效');
    ids.set(u.id,index); last = u.startSeconds;
  }
  if (a.protectedRanges !== undefined && !Array.isArray(a.protectedRanges)) fail('保护区间格式无效');
  for (const r of a.protectedRanges ?? []) {
    if (!plain(r) || !Number.isFinite(r.startSeconds) || !Number.isFinite(r.endSeconds) || r.startSeconds < 0 || r.endSeconds <= r.startSeconds || r.endSeconds > a.sourceDurationSeconds) fail('保护区间非法或越界');
  }
  const decisionIds = new Set(), targeted = new Set();
  for (const d of a.decisions) {
    if (!plain(d) || typeof d.id !== 'string' || !d.id || decisionIds.has(d.id) || !['keep','review','delete'].includes(d.action) || typeof d.reason !== 'string' || !Array.isArray(d.unitIds) || !d.unitIds.length) fail('语义决策格式无效');
    if (['startSeconds','endSeconds','startFrame','endFrame','text'].some(k => Object.hasOwn(d,k))) fail('模型只能引用字词 ID，不能指定时间或改写原话');
    if (d.kind !== undefined && (typeof d.kind !== 'string' || !d.kind || d.kind === 'pause')) fail('语义删除种类无效，停顿只能来自音频检测区间');
    if (d.confidence !== undefined && (!Number.isFinite(d.confidence) || d.confidence < 0 || d.confidence > 1)) fail('模型判断分值必须在 0 到 1 之间');
    decisionIds.add(d.id);
    let previous = -1;
    for (const id of d.unitIds) {
      const index = ids.get(id);
      if (index === undefined || index <= previous) fail('语义决策引用不存在、重复或乱序的字词 ID');
      if (previous >= 0 && (index !== previous + 1 || (a.units[index].groupId ?? a.units[index].id) !== (a.units[previous].groupId ?? a.units[previous].id))) fail('单条删除必须引用同组连续字词，请拆成独立决策');
      if (d.action !== 'keep' && targeted.has(id)) fail('多个删除或复核决策重复引用同一字词');
      if (d.action !== 'keep') targeted.add(id);
      previous = index;
    }
    if (d.keepUnitIds !== undefined && (!Array.isArray(d.keepUnitIds) || new Set(d.keepUnitIds).size !== d.keepUnitIds.length || d.keepUnitIds.some(id => !ids.has(id)))) fail('明确保留列表引用不存在或重复的字词');
  }
  let lastSilence = -1;
  for (const s of a.silences) {
    if (!plain(s) || !Number.isFinite(s.startSeconds) || !Number.isFinite(s.endSeconds) || s.startSeconds < 0 || s.endSeconds <= s.startSeconds || s.endSeconds > input.sourceDurationSeconds + 1e-7 || s.startSeconds < lastSilence) fail('停顿区间乱序、非法或越界');
    lastSilence = s.endSeconds;
  }
  if (a.editPlan !== undefined) validateEditPlan(a,ids);
  if (a.captionOverrides !== undefined) {
    if (!a.editPlan || !plain(a.captionOverrides) || Object.entries(a.captionOverrides).some(([id,text])=>!ids.has(id)||typeof text!=='string'||!text.trim()||/[\r\n]/.test(text))) fail('字幕纠错必须引用已有字词 ID 和非空单行文字');
  }
  return a;
}
function unitFrames(state) {
  const fps = fpsValue(state.original.fps), total = state.original.canvasDurationFrames;
  return state.analysis.units.map(u => {
    const start = Math.min(total,Math.round(u.startSeconds*fps)), end = Math.min(total,Math.round(u.endSeconds*fps));
    const startFrame = Math.min(total-1,start);
    return {...u,timing:u.timing ?? state.analysis.timing,collapsed:end<=start,startFrame,endFrame:Math.max(startFrame+1,end)};
  });
}
function unitProtection(state, units) {
  const protectedIds = new Map();
  const protect = (id,reason) => protectedIds.set(id, [protectedIds.get(id),reason].filter(Boolean).join('；'));
  for (const d of state.analysis.decisions) for (const id of [...(d.keepUnitIds ?? []),...(d.action === 'keep' ? d.unitIds : [])]) protect(id,'语义决策明确保留');
  for (const [index,u] of units.entries()) {
    if ((state.analysis.protectedRanges ?? []).some(r => r.startSeconds < u.endSeconds && r.endSeconds > u.startSeconds)) protect(u.id,'字词与明确保护区间重叠');
    if (u.collapsed) protect(u.id,'字词短于当前帧率的一帧');
    if (u.safeBoundaries === false || u.protectionReasons?.length) protect(u.id,`边界或原话需要保护${u.protectionReasons?.length ? `：${u.protectionReasons.join('；')}` : ''}`);
    if (u.timing === 'segment' && (u.completeSentence !== true || u.safeBoundaries !== true)) protect(u.id,'句级删除缺少完整整句与安全边界确认');
    for (let j = index + 1; j < units.length && (units[j].startSeconds < u.endSeconds - 1e-9 || units[j].startFrame < u.endFrame); j++) { protect(u.id,'字词时间重叠，保留原话'); protect(units[j].id,'字词时间重叠，保留原话'); }
  }
  return protectedIds;
}
const blockedRanges = state => [...state.analysis.units,...(state.analysis.protectedRanges ?? [])].map(r => ({startSeconds:r.startSeconds,endSeconds:r.endSeconds})).sort((a,b) => a.startSeconds-b.startSeconds);
// Callers iterating every silence pass the sorted blocked ranges once (was rebuilt per silence).
function safeSilenceGaps(state, silence, blocked = blockedRanges(state)) {
  const gaps = []; let cursor = silence.startSeconds;
  for (const range of blocked) {
    if (range.endSeconds <= cursor) continue;
    if (range.startSeconds >= silence.endSeconds) break;
    if (range.startSeconds > cursor) gaps.push({startSeconds:cursor,endSeconds:Math.min(range.startSeconds,silence.endSeconds)});
    cursor = Math.max(cursor,range.endSeconds);
    if (cursor >= silence.endSeconds) break;
  }
  if (cursor < silence.endSeconds) gaps.push({startSeconds:cursor,endSeconds:silence.endSeconds});
  return gaps;
}
const unitsText = units => units.reduce((text,u) => joinText(text,u.text),'');
function captionDeletionReason(state, startFrame, endFrame, units) {
  if (!state.original.hadCaptions) return '';
  for (const cue of state.original.captions.cues) {
    if (cue.endFrame <= startFrame || cue.startFrame >= endFrame) continue;
    if (startFrame <= cue.startFrame && endFrame >= cue.endFrame) continue;
    const matching = units.filter(u => u.startFrame < cue.endFrame && u.endFrame > cue.startFrame);
    if (!matching.some(u => u.startFrame < endFrame && u.endFrame > startFrame)) continue;
    if (matching.some(u => u.startFrame < cue.startFrame || u.endFrame > cue.endFrame) || unitsText(matching).trim() !== cue.text.trim()) return '已有字幕含手动纠错或时间无法精确匹配；保留该句，避免覆盖原字幕';
  }
  return '';
}
function cutOverlapsProtection(state,startFrame,endFrame) {
  const fps = fpsValue(state.original.fps);
  return (state.analysis.protectedRanges ?? []).some(r => r.startSeconds*fps < endFrame && r.endSeconds*fps > startFrame);
}
function validateEditPlan(a, ids) {
  const p = a.editPlan;
  if (!plain(p) || Object.keys(p).some(k => !['version','mode','selections','omissions','reviewNotes'].includes(k)) || p.version !== 1 || p.mode !== 'complete-takes' || !Array.isArray(p.selections) || !p.selections.length || !Array.isArray(p.omissions) || !Array.isArray(p.reviewNotes) || p.reviewNotes.some(n => typeof n !== 'string')) fail('完整表达选择计划格式无效');
  const covered = new Set(), selectionIds = new Set();
  for (const list of [p.selections,p.omissions]) {
    let last = -1;
    for (const item of list) {
      if (!plain(item) || typeof item.reason !== 'string' || !item.reason.trim() || Object.keys(item).some(k => !['id','startUnitId','endUnitId','reason','kind','coveredBySelectionIds'].includes(k))) fail('完整表达只允许引用已有字词 ID 和原因，不能输出时间');
      const start = ids.get(item.startUnitId), end = ids.get(item.endUnitId);
      if (start === undefined || end === undefined || end < start || start <= last) fail('完整表达引用不存在或乱序的字词 ID');
      for (let i=start;i<=end;i++) { if (covered.has(i)) fail('完整表达选择与省略重叠'); covered.add(i); }
      last = end;
      if (list === p.selections) {
        if (Object.keys(item).some(k => !['id','startUnitId','endUnitId','reason'].includes(k))) fail('完整表达选择字段无效');
        if (typeof item.id !== 'string' || !item.id || selectionIds.has(item.id)) fail('完整表达选择 ID 缺失或重复');
        selectionIds.add(item.id);
      } else if (!['retake','false_start','aside'].includes(item.kind) || !Array.isArray(item.coveredBySelectionIds) || (item.kind === 'retake' && !item.coveredBySelectionIds.length) || new Set(item.coveredBySelectionIds).size !== item.coveredBySelectionIds.length || item.coveredBySelectionIds.some(id => !selectionIds.has(id))) fail('省略种类或替代表达引用无效');
    }
  }
  if (covered.size !== a.units.length) fail('完整表达选择和省略必须恰好覆盖全部原始字词');
  for (const item of [...p.selections,...p.omissions]) {
    const chosen=a.units.slice(ids.get(item.startUnitId),ids.get(item.endUnitId)+1);
    if (unreliableTake(chosen)) {
      const warning=`${item.startUnitId}—${item.endUnitId}：转写或端点不可靠，保留原片待核对`;
      if (!a.warnings.includes(warning)) a.warnings.push(warning);
    }
  }
}
function unreliableTake(chosen) {
  return chosen.some(u => (u.protectionReasons ?? []).some(r=>r!=='zero_duration_alignment') || (u.safeBoundaries===false && !u.protectionReasons?.includes('zero_duration_alignment')));
}
function completeTakeCandidates(state) {
  const units = unitFrames(state), byId = new Map(units.map((u,i) => [u.id,i]));
  const fps = fpsValue(state.original.fps), total = state.original.canvasDurationFrames, keep = [], protectedGroups = new Set(), protectedKeeps = [];
  const ranges = state.analysis.editPlan.selections.map(s => ({...s,start:byId.get(s.startUnitId),end:byId.get(s.endUnitId)}));
  const selectedIds = new Set(ranges.flatMap(r => units.slice(r.start,r.end+1).map(u=>u.id)));
  for (const r of ranges) {
    if (unreliableTake(units.slice(r.start,r.end+1))) { keep.push({startFrame:Math.min(units[r.start].startFrame,units[r.start-1]?.endFrame ?? 0),endFrame:Math.max(...units.slice(r.start,r.end+1).map(u=>u.endFrame),units[r.end+1]?.startFrame ?? total)});continue; }
    const first = units[r.start], last = units[r.end], previous = units[r.start-1], following = units[r.end+1];
    // Air is bounded by every adjacent omitted atomic unit, never by silence-detector guesses.
    const start = Math.max(0,first.startFrame-Math.round(.1*fps),previous && !selectedIds.has(previous.id) ? previous.endFrame : 0);
    const end = Math.min(total,last.endFrame+Math.round(.18*fps),following && !selectedIds.has(following.id) ? following.startFrame : total);
    keep.push({startFrame:Math.min(start,first.startFrame),endFrame:Math.max(end,last.endFrame)});
  }
  // Missing transcript protects its source group, not a cross-group omission.
  // Preserve a review candidate so an explicit manual choice can resolve it later.
  for (const o of state.analysis.editPlan.omissions) for (const u of units.slice(byId.get(o.startUnitId),byId.get(o.endUnitId)+1)) {
    if (u.collapsed || unreliableTake([u])) protectedGroups.add(u.groupId ?? u.id);
  }
  for (const groupId of protectedGroups) {
    const chosen=units.filter(u=>(u.groupId ?? u.id)===groupId), first=chosen[0], last=chosen.at(-1);
    const previous=units[byId.get(first.id)-1],following=units[byId.get(last.id)+1];
    // Unaligned speech may precede/follow the aligned words in this group.
    // Protect the full unknown local interval up to neighboring group speech,
    // while leaving the selected neighbor its available natural air.
    const groupEnd=Math.max(...chosen.map(u=>u.endFrame));
    const startFrame=previous ? Math.min(first.startFrame,previous.endFrame+(selectedIds.has(previous.id)?Math.round(.18*fps):0)) : 0;
    const endFrame=following ? Math.max(groupEnd,following.startFrame-(selectedIds.has(following.id)?Math.round(.1*fps):0)) : total;
    keep.push({startFrame,endFrame});protectedKeeps.push({startFrame,endFrame});
  }
  for (const d of state.analysis.decisions) for (const id of [...(d.keepUnitIds ?? []),...(d.action==='keep'?d.unitIds:[])]) { const u=units[byId.get(id)];keep.push({startFrame:u.startFrame,endFrame:u.endFrame}); }
  for (const r of state.analysis.protectedRanges ?? []) keep.push({startFrame:Math.floor(r.startSeconds*fps),endFrame:Math.ceil(r.endSeconds*fps)});
  keep.sort((a,b)=>a.startFrame-b.startFrame);
  const merged=[];
  for (const r of keep) {
    const previous=merged.at(-1);
    // Never bridge an omitted word, even when timing overlaps or frame rounding touches.
    if (previous && r.startFrame<=previous.endFrame) previous.endFrame=Math.max(previous.endFrame,r.endFrame);
    else merged.push({...r});
  }
  // Compress detector-confirmed silence only inside an already selected source span.
  // Every split must leave complete retained speech on both sides; this cannot
  // create an isolated breath/air fragment around an omission or protection island.
  let retained=merged;
  const half=state.options.keepPauseSeconds/2;
  const blocked=blockedRanges(state);
  for (const silence of state.analysis.silences) for (const gap of safeSilenceGaps(state,silence,blocked)) {
    if (gap.endSeconds-gap.startSeconds+1e-9 < state.options.minPauseSeconds) continue;
    const startFrame=Math.ceil((gap.startSeconds+half)*fps-1e-9),endFrame=Math.floor((gap.endSeconds-half)*fps+1e-9);
    if (endFrame<=startFrame || protectedKeeps.some(r=>r.startFrame<endFrame&&r.endFrame>startFrame)) continue;
    const next=[];
    for (const r of retained) {
      // Range test first: scanning every unit for each (gap, range) pair is quadratic.
      if (startFrame<=r.startFrame || endFrame>=r.endFrame) {next.push(r);continue;}
      const selected=units.filter(u=>selectedIds.has(u.id)&&u.startFrame>=r.startFrame&&u.endFrame<=r.endFrame);
      if (unreliableTake(selected) || !selected.some(u=>u.endFrame<=startFrame) || !selected.some(u=>u.startFrame>=endFrame)) {next.push(r);continue;}
      next.push({startFrame:r.startFrame,endFrame:startFrame},{startFrame:endFrame,endFrame:r.endFrame});
    }
    retained=next;
  }
  const cuts=[];let cursor=0;
  const add=end=>{
    if (end<=cursor) return;
    const chosen=units.filter(u=>u.startFrame<end && u.endFrame>cursor);
    const partial=chosen.some(u=>u.startFrame<cursor || u.endFrame>end || selectedIds.has(u.id));
    const captionReason=captionDeletionReason(state,cursor,end,units);
    cuts.push({id:`roughcut-take-cut-${cuts.length+1}`,kind:'complete-take',unitIds:chosen.map(u=>u.id),startFrame:cursor,endFrame:end,enabled:!partial&&!captionReason,reason:state.analysis.editPlan.omissions.filter(o=>chosen.some(u=>byId.get(u.id)>=byId.get(o.startUnitId)&&byId.get(u.id)<=byId.get(o.endUnitId))).map(o=>o.reason).join('；') || '移除完整表达外的无讲话余量',confidence:null,review:!!partial||!!captionReason,reviewReason:captionReason || (partial?'边界无法保全完整字词，保留待核对':''),safeToEnable:!partial&&!captionReason});
  };
  for (const r of retained) { add(r.startFrame);cursor=Math.max(cursor,r.endFrame); }
  add(total);
  // Use the whole protected kept component when it contains no selected words.
  // This joins adjacent enabled deletions exactly after manual adoption, so no
  // artificial breath-only fragment survives around the reviewed group.
  for (const r of retained) {
    const protectedUnits=units.filter(u=>protectedGroups.has(u.groupId ?? u.id)&&!selectedIds.has(u.id)&&u.startFrame>=r.startFrame&&u.endFrame<=r.endFrame);
    const reviewed=new Set();
    for (const u of protectedUnits) {
      if (reviewed.has(u.id)) continue;
      const selected=units.filter(v=>selectedIds.has(v.id));
      const previous=selected.filter(v=>v.endFrame<=u.startFrame).at(-1),following=selected.find(v=>v.startFrame>=u.endFrame);
      const startFrame=Math.max(r.startFrame,previous ? Math.min(u.startFrame,previous.endFrame+Math.round(.18*fps)) : 0);
      const endFrame=Math.min(r.endFrame,following ? Math.max(u.endFrame,following.startFrame-Math.round(.1*fps)) : total);
      if (endFrame<=startFrame) continue;
      const chosen=units.filter(v=>v.startFrame<endFrame&&v.endFrame>startFrame);
      chosen.forEach(v=>reviewed.add(v.id));
      const reasons=[...new Set(chosen.flatMap(v=>v.protectionReasons ?? []))];
      cuts.push({id:`roughcut-take-review-${cuts.length+1}`,kind:'complete-take',unitIds:chosen.map(v=>v.id),startFrame,endFrame,enabled:false,reason:'省略范围内的局部转写待核对，可明确手动采用',confidence:null,review:true,reviewReason:`转写或边界受保护：${reasons.join('；') || '字词短于一帧'}`,safeToEnable:false});
    }
  }
  return cuts;
}
function candidates(state) {
  if (state.analysis.editPlan) return completeTakeCandidates(state);
  const units = unitFrames(state), byId = new Map(units.map(u => [u.id,u])), protections = unitProtection(state,units), cuts = [];
  for (const d of state.analysis.decisions) {
    if (d.action === 'keep') continue;
    const selected = d.unitIds.map(id => byId.get(id));
    const hardReasons = [...new Set(selected.map(u => protections.get(u.id)).filter(Boolean))];
    const softReasons = d.action === 'review' ? ['语义分析建议人工复核'] : !(d.confidence >= AUTO_DELETE_SCORE) ? ['模型判断分值未达到保守自动删除阈值；分值不是校准概率'] : [];
    const startFrame = selected[0].startFrame, endFrame = Math.max(...selected.map(u => u.endFrame));
    if (startFrame >= endFrame) hardReasons.push('字词区间短于一帧');
    if (cutOverlapsProtection(state,startFrame,endFrame)) hardReasons.push('完整删除范围与明确保护区间重叠，保留原片');
    const captionReason = captionDeletionReason(state,startFrame,endFrame,units);
    if (captionReason) hardReasons.push(captionReason);
    cuts.push({id:`roughcut-cut-${cuts.length+1}`,decisionId:d.id,kind:d.kind ?? 'speech',unitIds:[...d.unitIds],startFrame,endFrame,enabled:!hardReasons.length && !softReasons.length,reason:d.reason,confidence:d.confidence ?? null,review:!!(hardReasons.length || softReasons.length),reviewReason:[...hardReasons,...softReasons].join('；'),safeToEnable:!hardReasons.length});
  }
  const fps = fpsValue(state.original.fps), half = state.options.keepPauseSeconds / 2;
  const blocked = blockedRanges(state);
  for (const [index,s] of state.analysis.silences.entries()) {
    for (const [gapIndex,gap] of safeSilenceGaps(state,s,blocked).entries()) {
      if (gap.endSeconds-gap.startSeconds + 1e-9 < state.options.minPauseSeconds) continue;
      const startFrame = Math.ceil((gap.startSeconds+half)*fps-1e-9), endFrame = Math.min(state.original.canvasDurationFrames,Math.floor((gap.endSeconds-half)*fps+1e-9));
      if (endFrame <= startFrame || cuts.some(c => c.enabled && c.startFrame < endFrame && c.endFrame > startFrame)) continue;
      cuts.push({id:`roughcut-pause-${index+1}-${gapIndex+1}`,silenceIndex:index,gapIndex,gapStartSeconds:gap.startSeconds,gapEndSeconds:gap.endSeconds,kind:'pause',unitIds:[],startFrame,endFrame,enabled:true,reason:'压缩无讲话长停顿中部，保留两侧气口',confidence:null,review:false,reviewReason:'',safeToEnable:true});
    }
  }
  return cuts;
}
function validateCuts(state) {
  if (!Array.isArray(state.cuts)) fail('删除记录格式无效');
  const expected = candidates(state), units = unitFrames(state), fps = fpsValue(state.original.fps), total = state.original.canvasDurationFrames;
  if (expected.length !== state.cuts.length) fail('删除记录与原始分析不一致');
  for (const [index,cut] of state.cuts.entries()) {
    const candidate = expected[index];
    if (!plain(cut)) fail('删除记录格式无效');
    const strip = c => Object.fromEntries(Object.entries(c).filter(([key]) => !['startFrame','endFrame','enabled','manual'].includes(key)));
    if (stable(strip(cut)) !== stable(strip(candidate))) fail('删除记录身份或保护标记被修改');
    integer(cut.startFrame,'删除起点'); integer(cut.endFrame,'删除终点');
    if (typeof cut.enabled !== 'boolean') fail('删除启用状态必须是布尔值');
    if (cut.manual !== undefined && typeof cut.manual !== 'boolean') fail('手动采用标记必须是布尔值');
    if (cut.manual && cut.kind === 'pause') fail('手动采用仅支持完整语义候选，停顿仍须遵守静音保护');
    if (cut.endFrame > total || cut.endFrame <= cut.startFrame) fail('删除区间非法或超出原片');
    if (cut.enabled && !cut.safeToEnable && !cut.manual) fail(cut.reviewReason || '该区间受保护，不能删除');
    // Only the dedicated manual edit may bypass automatic semantic/alignment guards.
    // Physical ranges, complete units and subtitle integrity remain mandatory below.
    if (!cut.safeToEnable && !cut.enabled && !cut.manual) {
      if (cut.startFrame !== candidate.startFrame || cut.endFrame !== candidate.endFrame) fail('受保护的区间不能调整切点，请保留并重新分析');
      continue;
    }
    if (cutOverlapsProtection(state,cut.startFrame,cut.endFrame)) fail('完整删除范围与明确保护区间重叠，请缩小区间');
    let selected = 0;
    for (const u of units) {
      if (cut.startFrame >= u.endFrame || cut.endFrame <= u.startFrame) continue;
      if (!cut.unitIds.includes(u.id)) fail('切点会删除明确保留的字词，请缩小区间');
      if (cut.manual && u.collapsed) fail('字词短于当前帧率的一帧，无法按完整单位手动删除');
      if (cut.startFrame > u.startFrame || cut.endFrame < u.endFrame) fail('切点必须保留或删除完整字词／整句，不能切掉半个单位');
      selected++;
    }
    if (state.analysis.editPlan && cut.kind === 'complete-take') {
      const captionReason = captionDeletionReason(state,cut.startFrame,cut.endFrame,units);
      if (captionReason) fail(captionReason);
    } else if (cut.kind === 'pause') {
      const half = state.options.keepPauseSeconds/2;
      if (cut.startFrame < Math.ceil((cut.gapStartSeconds+half)*fps-1e-9) || cut.endFrame > Math.floor((cut.gapEndSeconds-half)*fps+1e-9)) fail('停顿切点必须保留两侧气口，不能扩展到讲话');
    } else {
      if (!selected) fail('删除区间必须包含所选完整字词，恢复请关闭删除');
      if (cut.manual && selected !== cut.unitIds.length) fail('手动采用须覆盖候选全部完整字词／整句，恢复请关闭删除');
      const captionReason = captionDeletionReason(state,cut.startFrame,cut.endFrame,units);
      if (captionReason) fail(captionReason);
      // Keep up to 80 ms of available air next to retained speech; never infer breaths from energy.
      const chosen = units.filter(u => cut.unitIds.includes(u.id)), start = chosen[0].startFrame, end = Math.max(...chosen.map(u => u.endFrame));
      const previous = units.filter(u => !cut.unitIds.includes(u.id) && u.endFrame <= start).at(-1);
      const following = units.find(u => !cut.unitIds.includes(u.id) && u.startFrame >= end);
      if (previous && cut.startFrame < previous.endFrame + Math.min(Math.ceil(.08*fps),Math.floor((start-previous.endFrame)/2))) fail('切点太靠近上一句，需要保留自然气口');
      if (following && cut.endFrame > following.startFrame - Math.min(Math.ceil(.08*fps),Math.floor((following.startFrame-end)/2))) fail('切点太靠近下一句，需要保留自然气口');
    }
  }
  let end = 0, removed = 0;
  for (const cut of state.cuts.filter(c => c.enabled).sort((a,b) => a.startFrame-b.startFrame)) {
    if (cut.startFrame < end) fail('启用的删除区间重叠，请先恢复其中一条');
    removed += cut.endFrame-cut.startFrame; end = cut.endFrame;
  }
  if (removed >= total) fail('不能删除整段原片，请至少保留一帧内容');
}
function joinText(left,right) {
  if (!left) return right;
  return /[\p{Script=Latin}\p{N}]$/u.test(left) && /^[\p{Script=Latin}\p{N}]/u.test(right) ? `${left} ${right}` : `${left}${right}`;
}
function buildCaptions(state, clips, durationFrames) {
  const original = state.original;
  if (!state.cuts.some(c => c.enabled) && original.hadCaptions) return clone(original.captions);
  const units = unitFrames(state), active = state.cuts.filter(c => c.enabled);
  const removed = u => active.some(c => c.startFrame <= u.startFrame && c.endFrame >= u.endFrame);
  const projectRange = (start,end) => {
    const ranges = clips.filter(c => c.sourceInFrame < end && c.sourceInFrame+c.durationFrames > start);
    if (!ranges.length) return null;
    const first = ranges[0], last = ranges.at(-1);
    return {startFrame:first.startFrame+Math.max(start-first.sourceInFrame,0),endFrame:last.startFrame+Math.min(end-last.sourceInFrame,last.durationFrames)};
  };
  const sourceTrack = original.hadCaptions ? clone(original.captions) : {version:1,enabled:true,style:{...DEFAULT_CAPTION_STYLE},cues:[]};
  const cues = [], covered = new Set();
  // Existing subtitle IDs, corrections and local styling belong to the user. Map by time,
  // not transcript group IDs, which are from a different ID namespace.
  for (const cue of sourceTrack.cues) {
    const matching = units.filter(u => u.startFrame < cue.endFrame && u.endFrame > cue.startFrame);
    matching.forEach(u => covered.add(u.id));
    const semanticCut = active.filter(c => c.kind !== 'pause' && c.startFrame < cue.endFrame && c.endFrame > cue.startFrame);
    if (semanticCut.some(c => c.startFrame <= cue.startFrame && c.endFrame >= cue.endFrame)) continue;
    if (matching.some(removed)) {
      if (matching.some(u => u.startFrame < cue.startFrame || u.endFrame > cue.endFrame) || unitsText(matching).trim() !== cue.text.trim()) fail('已有字幕含手动纠错，无法可靠同步删除，请保留该句');
      const kept = matching.filter(u => !removed(u));
      if (!kept.length) continue;
      const range = projectRange(kept[0].startFrame,kept.at(-1).endFrame), text = unitsText(kept);
      if (range) cues.push({...cue,...range,text,initialText:text});
    } else {
      const range = projectRange(cue.startFrame,cue.endFrame);
      if (!range) fail('删除会使已有字幕失去时间位置，请恢复该区间或调整字幕');
      cues.push({...cue,...range});
    }
  }
  const groups = [], fps = fpsValue(original.fps);
  for (const u of units) {
    if (removed(u) || covered.has(u.id)) continue;
    const range = projectRange(u.startFrame,u.endFrame);
    if (!range || range.endFrame <= range.startFrame) continue;
    const v2=state.policy.captionLayoutVersion===2;
    const text=v2 ? state.analysis.captionOverrides?.[u.id] ?? u.text : u.text;
    const clipId=v2 ? clips.find(c=>u.startFrame>=c.sourceInFrame&&u.endFrame<=c.sourceInFrame+c.durationFrames)?.id : undefined;
    const groupId = u.groupId ?? u.id, group = groups.at(-1);
    const overlap = group && range.startFrame < group.endFrame;
    // Only real unit boundaries may split a caption. Indivisible uncertain segments
    // remain whole even when they exceed these readability limits.
    const shortCaptions = [1,2].includes(state.policy.captionLayoutVersion);
    const breakPhrase = shortCaptions && group && (
      /[。！？!?；;，,：:]$/.test(group.text) ||
      range.startFrame-group.endFrame >= .65*fps ||
      [...joinText(group.text,text)].length > 18 ||
      range.endFrame-group.startFrame > 4*fps
    );
    const sameClip=!v2 || group?.clipId===clipId;
    if (group && sameClip && (overlap || (group.groupId === groupId && !breakPhrase))) {
      group.text = joinText(group.text,text);group.originalText=joinText(group.originalText,u.text); group.endFrame = Math.max(group.endFrame,range.endFrame);
    } else groups.push({groupId,...range,text,originalText:u.text,clipId,lengthTail:!!(v2&&sameClip&&group&&group.groupId===groupId&&([...joinText(group.text,text)].length>18||range.endFrame-group.startFrame>4*fps)&&!/[。！？!?；;，,：:]$/.test(group.text)&&range.startFrame-group.endFrame<.65*fps)});
  }
  if (state.policy.captionLayoutVersion===2) for (let i=1;i<groups.length;i++) {
    const tail=groups[i],previous=groups[i-1];
    if (tail.lengthTail&&[...tail.text].length<=3&&tail.endFrame-tail.startFrame<.5*fps&&tail.groupId===previous.groupId&&tail.clipId===previous.clipId&&tail.startFrame-previous.endFrame<.65*fps&&[...joinText(previous.text,tail.text)].length<=22&&tail.endFrame-previous.startFrame<=5*fps) {
      previous.text=joinText(previous.text,tail.text);previous.originalText=joinText(previous.originalText,tail.originalText);previous.endFrame=tail.endFrame;groups.splice(i--,1);
    }
  }
  const ids = new Set(cues.map(c => c.id)); let serial = 0;
  for (const g of groups) {
    let id; do { id = `roughcut-caption-${++serial}`; } while (ids.has(id)); ids.add(id);
    cues.push({id,startFrame:g.startFrame,endFrame:g.endFrame,text:g.text,originalText:state.policy.captionLayoutVersion===2?g.originalText:g.text,initialText:g.text});
  }
  const track = {...sourceTrack,timeBinding:'source',cues:cues.sort((a,b) => a.startFrame-b.startFrame)};
  validateCaptionTrack(track,{durationFrames}); return track;
}

function build(state) {
  const original = state.original, total = original.canvasDurationFrames, active = state.cuts.filter(c => c.enabled).sort((a,b) => a.startFrame-b.startFrame);
  const source = clone(original.source), clips = []; let sourceFrame = 0, projectFrame = 0;
  const add = end => {
    if (end <= sourceFrame) return;
    const template = original.source.clips?.[0] ?? {name:'主视频'};
    clips.push({...template,id:`roughcut-source-${clips.length+1}`,startFrame:projectFrame,sourceInFrame:sourceFrame,durationFrames:end-sourceFrame});
    projectFrame += end-sourceFrame;
  };
  for (const cut of active) { add(cut.startFrame); sourceFrame = cut.endFrame; }
  add(total);
  if (active.length) source.clips = clips;
  const captions = buildCaptions(state,clips,projectFrame);
  return {source,canvas:{fps:clone(original.fps),durationFrames:projectFrame},captions};
}
const baselineValue = state => ({sourceKey:state.sourceKey,original:state.original,analysis:state.analysis,options:state.options,policy:state.policy});
const baseline = state => fingerprint(baselineValue(state));
/** Upgrade a validated legacy (v1, full JSON) baseline to the compact hash form. */
function compactBaseline(state) { if (typeof state.baselineFingerprint === 'string' && !state.baselineFingerprint.startsWith('roughcut-v2:')) state.baselineFingerprint = baseline(state); }
function validateBase(state) {
  if (!plain(state) || state.version !== 1 || !plain(state.original) || !plain(state.analysis) || typeof state.resultFingerprint !== 'string') fail('可恢复状态缺失或版本无效');
  const original = state.original;
  if (typeof original.hadCaptions !== 'boolean' || (original.hadCaptions && !plain(original.captions))) fail('原始字幕快照无效');
  if (state.sourceKey !== roughcutSourceKey(originalDocument(original)) || !fingerprintMatches(state.baselineFingerprint,baselineValue(state))) fail('原片或不可变分析快照被修改，请恢复备份后重新分析');
  assertSimple({...originalDocument(original),instances:[]},true);
  if (stable(optionsFor(state.options)) !== stable(state.options)) fail('粗剪参数无效');
  if (stable(readAnalysis(state.analysis,original)) !== stable(state.analysis)) fail('原始分析格式已变更');
  if (stable(state.policy) !== stable({autoDeleteScore:AUTO_DELETE_SCORE,confidenceMeaning:'uncalibrated-model-score',boundaryGuardSeconds:0.08,...([1,2].includes(state.policy?.captionLayoutVersion)?{captionLayoutVersion:state.policy.captionLayoutVersion}:{})})) fail('粗剪保护策略无效');
  validateCuts(state);
}
function validateManualTimeline(state){
  if(state.manualTimeline){
    const m=state.manualTimeline;
    if(m.version!==1||!Array.isArray(m.clips)||!m.clips.length||stable(m.fps)!==stable(state.original.fps)||!fingerprintMatches(m.fingerprint,{clips:m.clips,durationFrames:m.durationFrames,fps:m.fps}))fail('手动时间轴快照无效');
    integer(m.durationFrames,'手动时间轴时长',1);
    const ids=new Set();let last=0;
    for(const c of [...m.clips].sort((a,b)=>a.startFrame-b.startFrame)){
      integer(c.startFrame,'片段起点');integer(c.durationFrames,'片段时长',1);integer(c.sourceInFrame,'原片起点');
      if(!c.id||ids.has(c.id)||c.startFrame<last||c.startFrame+c.durationFrames>m.durationFrames||c.sourceInFrame+c.durationFrames>state.original.canvasDurationFrames)fail('手动时间轴片段越界或重叠');
      ids.add(c.id);last=c.startFrame+c.durationFrames;
    }
  }
}
export function validateRoughcut(state) {
  validateBase(state);
  if (!fingerprintMatches(state.resultFingerprint,resultParts(build(state)))) fail('生成映射指纹不匹配，粗剪状态可能被修改');
  validateManualTimeline(state);
  return true;
}
/** Keep immutable analysis/cuts recoverable while retaining the exact editable source mapping. */
export function recordRoughcutTimeline(document){
 if(!document.roughcut)return document;
 // The baseline is unchanged by this command; store/save and cut operations still
 // validate it fully. Avoid rebuilding thousands of ASR units on every pointer move.
 const next=clone(document),state=next.roughcut;
 const mapping={clips:clone(next.source.clips),durationFrames:next.canvas.durationFrames,fps:clone(next.canvas.fps)};
 state.manualTimeline={version:1,...mapping,fingerprint:fingerprint(mapping)};
 validateManualTimeline(state);freeze(state.original);freeze(state.analysis);return next;
}
export function restoreRoughcutCaptions(document,revealed){
 if(!document.roughcut||!revealed)return document;
 const d=clone(document),state=d.roughcut,from=revealed.sourceInFrame,to=from+revealed.durationFrames;
 const units=unitFrames(state).filter(u=>u.startFrame<to&&u.endFrame>from),cues=[],used=new Set(d.captions?.cues.map(c=>c.id)??[]);
 let serial=0,previousGroup=null;
 for(const u of units){
  const startFrame=revealed.startFrame+Math.max(from,u.startFrame)-from,endFrame=revealed.startFrame+Math.min(to,u.endFrame)-from;
  const text=state.analysis.captionOverrides?.[u.id]??u.text;
  let id;do{id=`roughcut-restored-${u.id}-${++serial}`;}while(used.has(id));used.add(id);
  const original=state.original.captions?.cues.find(c=>c.startFrame<=u.startFrame&&c.endFrame>=u.endFrame);
  const previous=cues.at(-1),group=u.groupId??u.id,fps=fpsValue(d.canvas.fps);
  const merge=previous&&(startFrame<previous.endFrame||(group===previousGroup&&startFrame-previous.endFrame<.65*fps&&endFrame-previous.startFrame<=4*fps&&[...joinText(previous.text,text)].length<=18&&!/[。！？!?；;，,：:]$/.test(previous.text)));
  if(merge){previous.text=joinText(previous.text,text);previous.initialText=previous.text;previous.originalText=joinText(previous.originalText,u.text);previous.endFrame=Math.max(previous.endFrame,endFrame);}
  else cues.push({...(original?.style?{style:clone(original.style)}:{}),id,startFrame,endFrame,text,originalText:u.text,initialText:text});
  previousGroup=group;
 }
 // Original captions without ASR timing are the best available retained text.
 if(!units.length)for(const c of state.original.captions?.cues??[]){
  const a=Math.max(from,c.startFrame),b=Math.min(to,c.endFrame);if(b<=a)continue;
  let id;do{id=`${c.id}-restored-${++serial}`;}while(used.has(id));used.add(id);
  cues.push({...clone(c),id,startFrame:revealed.startFrame+a-from,endFrame:revealed.startFrame+b-from});
 }
 if(cues.length){
  if(d.captions?.locked)fail('字幕轨道已锁定，不能添加恢复的字幕');
  d.captions={...(d.captions??{version:1,enabled:true,timeBinding:'source',style:{...DEFAULT_CAPTION_STYLE}}),cues:[...(d.captions?.cues??[]),...cues].sort((a,b)=>a.startFrame-b.startFrame)};
  validateCaptionTrack(d.captions,{durationFrames:d.canvas.durationFrames});
 }
 return d;
}
function assertManualCurrent(document){
 validateRoughcut(document.roughcut);
 const m=document.roughcut.manualTimeline;
 if(!m||stable(m.clips)!==stable(document.source.clips)||m.durationFrames!==document.canvas.durationFrames||stable(m.fps)!==stable(document.canvas.fps))fail('手动时间轴已变更，请先保存当前片段映射');
 if(document.source.locked)fail('主视频已锁定');
}
function orderedSource(document){
 const clips=[...document.source.clips].sort((a,b)=>a.startFrame-b.startFrame);let project=0,source=0;
 for(const c of clips){if(c.startFrame!==project||c.sourceInFrame<source)fail('手动时间轴存在重复或重排原片，恢复位置有歧义；请使用原片副本');project=c.startFrame+c.durationFrames;source=c.sourceInFrame+c.durationFrames;}
 return clips;
}
function subtractRange(a,b){
 if(!a)return [];if(!b||b.endFrame<=a.startFrame||b.startFrame>=a.endFrame)return [a];
 return [{startFrame:a.startFrame,endFrame:Math.min(a.endFrame,b.startFrame)},{startFrame:Math.max(a.startFrame,b.endFrame),endFrame:a.endFrame}].filter(r=>r.endFrame>r.startFrame);
}
// Remove only exposed original footage in a source range, rippling everything above it.
function removeSourceRanges(next,ranges){
 for(const range of ranges){
  for(const original of [...orderedSource(next)].reverse()){
   const a=Math.max(range.startFrame,original.sourceInFrame),b=Math.min(range.endFrame,original.sourceInFrame+original.durationFrames);if(b<=a)continue;
   const at=original.startFrame+a-original.sourceInFrame,remove=b-a;
   if(next.source.locked||next.source.clips.some(c=>c.locked&&c.startFrame+c.durationFrames>at))fail('受影响主视频片段已锁定');
   const before=next;next=rippleProject(next,{at,remove});
   const used=new Set(before.source.clips.map(c=>c.id));
   next.source.clips=before.source.clips.flatMap(c=>{
    if(c.id!==original.id)return [{...c,startFrame:c.startFrame>=at+remove?c.startFrame-remove:c.startFrame}];
    const parts=[];if(a>c.sourceInFrame)parts.push({...c,durationFrames:a-c.sourceInFrame});
    if(b<c.sourceInFrame+c.durationFrames){let id=c.id;if(parts.length){id=`${c.id}-restore-${b}`;let n=1;while(used.has(id))id=`${c.id}-restore-${b}-${n++}`;}parts.push({...c,id,startFrame:at,sourceInFrame:b,durationFrames:c.sourceInFrame+c.durationFrames-b});}
    return parts;
   });
  }
 }
 return next;
}
// Restore only missing portions of source ranges; never duplicate already exposed footage.
function restoreSourceRanges(next,ranges){
 for(const range of ranges){
  let gaps=[range];for(const c of orderedSource(next))gaps=gaps.flatMap(g=>subtractRange(g,{startFrame:c.sourceInFrame,endFrame:c.sourceInFrame+c.durationFrames}));
  for(const gap of gaps){
   const clips=orderedSource(next),following=clips.find(c=>c.sourceInFrame>=gap.endFrame),at=following?.startFrame??next.canvas.durationFrames,insert=gap.endFrame-gap.startFrame;
   if(next.source.locked||clips.some(c=>c.locked&&c.startFrame>=at))fail('受影响主视频片段已锁定');
   next=rippleProject(next,{at,insert});
   next.source.clips=clips.map(c=>({...c,startFrame:c.startFrame>=at?c.startFrame+insert:c.startFrame}));
   let id=`roughcut-restored-source-${gap.startFrame}`;let n=1;while(next.source.clips.some(c=>c.id===id))id=`roughcut-restored-source-${gap.startFrame}-${n++}`;
   next.source.clips.push({...(following??clips.at(-1)),id,startFrame:at,sourceInFrame:gap.startFrame,durationFrames:insert});next.source.clips.sort((a,b)=>a.startFrame-b.startFrame);
   next=restoreRoughcutCaptions(next,{sourceInFrame:gap.startFrame,startFrame:at,durationFrames:insert});
  }
 }
 return next;
}
function applyManualCut(document,state,oldCut,newCut){
 assertManualCurrent(document);orderedSource(document);
 const old=oldCut.enabled?oldCut:null,now=newCut.enabled?newCut:null;
 let next=removeSourceRanges(clone(document),subtractRange(now,old));
 next=restoreSourceRanges(next,subtractRange(old,now));
 compactBaseline(state);state.resultFingerprint=fingerprint(resultParts(build(state)));delete state.manualTimeline;next.roughcut=state;
 return recordRoughcutTimeline(next);
}
function sourceRange(range,state){
 const total=state.original.canvasDurationFrames;
 if(!plain(range)||!Number.isSafeInteger(range.startFrame)||!Number.isSafeInteger(range.endFrame)||range.startFrame<0||range.endFrame>total||range.endFrame<=range.startFrame)fail('原片区间无效');
 return {startFrame:range.startFrame,endFrame:range.endFrame};
}
function manualBase(document){
 if(!document.roughcut)fail('工程没有粗剪记录');
 if(document.roughcut.manualTimeline)assertManualCurrent(document);
 else {assertCurrent(document);document=recordRoughcutTimeline(document);}
 orderedSource(document);return document;
}
/** Text-based editing: ripple-remove exposed footage in source ranges without touching candidate cuts. */
export function cutRoughcutSourceRanges(document,ranges){
 const base=manualBase(document),list=ranges.map(r=>sourceRange(r,base.roughcut));
 return recordRoughcutTimeline(removeSourceRanges(clone(base),list));
}
/** Reverse of cutRoughcutSourceRanges: re-expose missing footage (and its captions) in source ranges. */
export function restoreRoughcutSourceRanges(document,ranges){
 const base=manualBase(document),list=ranges.map(r=>sourceRange(r,base.roughcut));
 return recordRoughcutTimeline(restoreSourceRanges(clone(base),list));
}
/** Units with the same frame rounding the candidates use. */
export function roughcutUnitFrames(state){ return unitFrames(state); }
function assertCurrent(document) {
  const state = document.roughcut;
  validateRoughcut(state); assertSimple(document);
  if (!fingerprintMatches(state.resultFingerprint,resultParts(document))) fail('原片时间轴或字幕已有手动修改，与粗剪生成结果冲突；请撤销该修改或建立原片副本');
}
function applyState(document,state) {
  validateCuts(state);
  const generated = build(state), next = clone(document);
  next.source = generated.source; next.canvas.durationFrames = generated.canvas.durationFrames; next.captions = generated.captions;
  compactBaseline(state); state.resultFingerprint = fingerprint(resultParts(generated));
  next.roughcut = state; freeze(next.roughcut.original); freeze(next.roughcut.analysis);
  return next;
}
export function createRoughcut(document, analysis, options = {}) {
  const opts = optionsFor(options);
  if (document.roughcut !== undefined) {
    if(document.roughcut.manualTimeline)assertManualCurrent(document);else assertCurrent(document);
    if (stable(readAnalysis(analysis,document.roughcut.original)) !== stable(document.roughcut.analysis) || stable(opts) !== stable(document.roughcut.options)) fail('工程已有粗剪记录，请先恢复原片再应用新分析');
    const next = clone(document); freeze(next.roughcut.original); freeze(next.roughcut.analysis); return next;
  }
  assertSimple(document,true);
  const original = {source:clone(document.source),fps:clone(document.canvas.fps),canvasDurationFrames:document.canvas.durationFrames,timingToleranceSeconds:2.001/fpsValue(document.canvas.fps),hadCaptions:document.captions !== undefined,...(document.captions !== undefined ? {captions:clone(document.captions)} : {})};
  const state = {version:1,sourceKey:roughcutSourceKey(document),original,analysis:readAnalysis(analysis,original),options:opts,policy:{autoDeleteScore:AUTO_DELETE_SCORE,confidenceMeaning:'uncalibrated-model-score',boundaryGuardSeconds:0.08,captionLayoutVersion:analysis.editPlan?2:1},cuts:[],warnings:[],baselineFingerprint:'',resultFingerprint:''};
  state.cuts = candidates(state); state.warnings = [...state.analysis.warnings]; state.baselineFingerprint = baseline(state);
  return applyState(document,state);
}
export function setRoughcutCut(document,cutId,patch) {
  if(document.roughcut?.manualTimeline)assertManualCurrent(document);else assertCurrent(document);
  if (!plain(patch) || Object.keys(patch).some(k => !['enabled','startFrame','endFrame'].includes(k))) fail('仅支持调整删除启用状态和原片两端帧');
  const state = clone(document.roughcut), cut = state.cuts.find(c => c.id === cutId);
  if (!cut) fail('删除记录不存在');
  Object.assign(cut,patch); validateCuts(state);
  if(document.roughcut.manualTimeline)return applyManualCut(document,state,document.roughcut.cuts.find(c=>c.id===cutId),cut);
  return applyState(document,state);
}
/** Explicit editing provenance only; this does not record listening or user approval. */
export function adoptRoughcutCutManually(document,cutId) {
  if(document.roughcut?.manualTimeline)assertManualCurrent(document);else assertCurrent(document);
  const state = clone(document.roughcut), cut = state.cuts.find(c => c.id === cutId);
  if (!cut) fail('删除记录不存在');
  if (cut.kind === 'pause') fail('手动采用仅支持完整语义候选，停顿请调整现有切点');
  if (!cut.manual) {
    const candidate = candidates(state).find(c => c.id === cutId);
    cut.startFrame = candidate.startFrame; cut.endFrame = candidate.endFrame;
  }
  cut.manual = true; cut.enabled = true;
  validateCuts(state);
  if(document.roughcut.manualTimeline)return applyManualCut(document,state,document.roughcut.cuts.find(c=>c.id===cutId),cut);
  return applyState(document,state);
}
export function resetRoughcut(document) {
  if (document.roughcut === undefined) return clone(document);
  if(document.roughcut.manualTimeline){assertManualCurrent(document);assertSimple(document);}else assertCurrent(document);
  const next = clone(document), original = document.roughcut.original;
  next.source = clone(original.source); next.canvas.durationFrames = original.canvasDurationFrames;
  if (original.hadCaptions) next.captions = clone(original.captions); else delete next.captions;
  delete next.roughcut; return next;
}
export function roughcutRows(document) {
  if (!document.roughcut) return [];
  const state = document.roughcut, fps = fpsValue(state.original.fps), units = unitFrames(state), active = state.cuts.filter(c => c.enabled);
  return state.cuts.map(c => {
    const removedBefore = active.reduce((sum,other) => sum+Math.max(0,Math.min(c.startFrame,other.endFrame)-other.startFrame),0);
    let projectFrame=c.startFrame-removedBefore;
    if(state.manualTimeline){
      const clips=[...document.source.clips].sort((a,b)=>a.startFrame-b.startFrame),containing=clips.find(x=>x.sourceInFrame<=c.startFrame&&x.sourceInFrame+x.durationFrames>c.startFrame),following=clips.find(x=>x.sourceInFrame>=c.startFrame);
      projectFrame=containing?containing.startFrame+c.startFrame-containing.sourceInFrame:following?.startFrame??document.canvas.durationFrames-1;
    }
    return {...clone(c),text:units.filter(u => c.unitIds.includes(u.id) && u.startFrame < c.endFrame && u.endFrame > c.startFrame).reduce((text,u) => joinText(text,u.text),''),startSeconds:c.startFrame/fps,endSeconds:c.endFrame/fps,durationFrames:c.endFrame-c.startFrame,projectFrame:Math.max(0,Math.min(document.canvas.durationFrames-1,projectFrame))};
  });
}
function srtTime(frame,fps) {
  const milliseconds = Math.round(frame/fps*1000), hours = Math.floor(milliseconds/3600000), minutes = Math.floor(milliseconds/60000)%60, seconds = Math.floor(milliseconds/1000)%60;
  return `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')},${String(milliseconds%1000).padStart(3,'0')}`;
}
export function roughcutSrt(document) {
  const fps = fpsValue(document.canvas.fps);
  if (!document.captions) return '';
  validateCaptionTrack(document.captions,{durationFrames:document.canvas.durationFrames});
  return document.captions.cues.map((c,index) => `${index+1}\n${srtTime(c.startFrame,fps)} --> ${srtTime(c.endFrame,fps)}\n${c.text}\n`).join('\n');
}
/** Rebuild from immutable seconds at the target frame rate, rather than retiming fingerprints. */
export function retimeRoughcutDocument(document,retimed) {
  if (!document.roughcut) return retimed;
  if(document.roughcut.manualTimeline)assertManualCurrent(document);else assertCurrent(document);
  const targetFps = retimed.canvas.fps, rate = fpsValue(targetFps)/fpsValue(document.canvas.fps);
  if (rate === 1) return {...retimed,roughcut:clone(document.roughcut)};
  const old = document.roughcut, original = clone(old.original);
  original.fps = clone(targetFps); original.canvasDurationFrames = Math.round(original.canvasDurationFrames*rate);
  if (original.canvasDurationFrames < 1) fail('目标帧率无法保留原片');
  original.source.startFrame = Math.round((original.source.startFrame ?? 0)*rate);
  if (original.source.durationFrames !== undefined) original.source.durationFrames = original.canvasDurationFrames;
  if (original.source.clips) original.source.clips = original.source.clips.map(c => ({...c,startFrame:0,sourceInFrame:0,durationFrames:original.canvasDurationFrames}));
  if (original.hadCaptions) {
    original.captions.cues = original.captions.cues.map(c => ({...c,startFrame:Math.round(c.startFrame*rate),endFrame:Math.round(c.endFrame*rate)}));
    validateCaptionTrack(original.captions,{durationFrames:original.canvasDurationFrames});
  }
  const state = clone(old); state.original = original; state.sourceKey = roughcutSourceKey(originalDocument(original)); state.analysis.sourceKey = state.sourceKey;
  // A source probe may differ from the displayed last frame; preserve this measured duration.
  state.analysis = readAnalysis(state.analysis,original);
  const proposed = candidates(state);
  const oldUnits = unitFrames(old), nextUnits = new Map(unitFrames(state).map(u => [u.id,u]));
  state.cuts = old.cuts.map((c,index) => {
    const candidate = proposed[index];
    if (!candidate || candidate.id !== c.id) fail('目标帧率无法保留删除记录，请使用工程原帧率');
    let startFrame = Math.round(c.startFrame*rate), endFrame = Math.round(c.endFrame*rate);
    if (!candidate.safeToEnable && !c.enabled && !c.manual) return {...candidate,enabled:false,...(c.manual === undefined ? {} : {manual:c.manual})};
    if (c.kind === 'pause') {
      startFrame = Math.max(candidate.startFrame,startFrame); endFrame = Math.min(candidate.endFrame,endFrame);
    } else {
      const startsAt = oldUnits.find(u => c.unitIds.includes(u.id) && u.startFrame === c.startFrame);
      const endsAt = oldUnits.find(u => c.unitIds.includes(u.id) && u.endFrame === c.endFrame);
      if (startsAt) startFrame = nextUnits.get(startsAt.id).startFrame;
      if (endsAt) endFrame = nextUnits.get(endsAt.id).endFrame;
    }
    return {...candidate,enabled:c.enabled,startFrame,endFrame,...(c.manual === undefined ? {} : {manual:c.manual})};
  });
  state.baselineFingerprint = baseline(state);
  if(old.manualTimeline){delete state.manualTimeline;state.resultFingerprint=fingerprint(resultParts(build(state)));const next=recordRoughcutTimeline({...retimed,roughcut:state});validateRoughcut(next.roughcut);return next;}
  return applyState(retimed,state);
}
