"""Noninteractive revision of existing objects in one immutable shot snapshot.

The host supplies an editable whitelist, then independently revalidates every
before/after patch at ingestion. No media creation or external writes occur here.
"""
from __future__ import annotations
import copy
import json
import math


def revision_schema():
    return {'type':'object','additionalProperties':False,'required':['reason','gaps','patches','execution'],'properties':{
        'execution':{'type':'object','additionalProperties':False,'required':['kind','instructions'],'properties':{'kind':{'type':'string','enum':['none','footage']},'instructions':{'type':'string'}}},
        'reason':{'type':'string'},'gaps':{'type':'array','items':{'type':'string'}},
        'patches':{'type':'array','items':{'type':'object','additionalProperties':False,
            'required':['entity','id','field','beforeJson','afterJson'],'properties':{
                key:{'type':'string'} for key in ['entity','id','field','beforeJson','afterJson']}}}}}


def safe_value(value, before):
    if value == before:
        return True
    if isinstance(value, dict):
        return isinstance(before,dict) and value.keys()==before.keys() and all(
            (value[k]==before[k] if any(w in k.lower() for w in ['path','url','src','file','identity','reference']) else safe_value(value[k],before[k])) for k in value)
    if isinstance(value,list):
        return isinstance(before,list) and len(value)==len(before) and all(safe_value(v,b) for v,b in zip(value,before))
    if isinstance(value,bool):
        return isinstance(before,bool)
    if isinstance(value,(int,float)):
        return isinstance(before,(int,float)) and not isinstance(before,bool) and math.isfinite(value)
    return type(value) is type(before)


def validate_response(response, snapshot):
    if snapshot.get('kind')!='revise' or not snapshot.get('shotId') or not snapshot.get('target'):
        raise ValueError('Revision needs immutable selected shot and target')
    if not isinstance(response,dict) or not isinstance(response.get('reason'),str) or not response['reason'].strip():
        raise ValueError('Revision reason required')
    gaps=response.get('gaps'); patches=response.get('patches')
    if not isinstance(gaps,list) or not all(isinstance(g,str) and g.strip() for g in gaps) or not isinstance(patches,list):
        raise ValueError('Revision patches and actionable gaps required')
    execution=response.get('execution')
    if execution is not None:
        if not isinstance(execution,dict) or set(execution)!={'kind','instructions'} or execution['kind'] not in {'none','footage'} or not isinstance(execution['instructions'],str):
            raise ValueError('Invalid revision execution handoff')
        if execution['kind']=='none':execution=None
        elif not execution['instructions'].strip() or not snapshot.get('instructions','').strip():
            raise ValueError('Footage execution requires explicit human instructions')
    if not patches and not gaps and not execution:
        raise ValueError('Empty revision must report actionable gap')
    allowed={(p['entity'],p['id'],p['field']):p['before'] for p in snapshot.get('revisionContext',{}).get('editable',[])}
    output=[]; seen=set()
    for item in patches:
        p=copy.deepcopy(item)
        if 'beforeJson' in p:
            p['before']=json.loads(p.pop('beforeJson')); p['after']=json.loads(p.pop('afterJson'))
        if set(p)!= {'entity','id','field','before','after'}:
            raise ValueError('Unknown revision patch fields')
        key=(p['entity'],p['id'],p['field'])
        if key in seen or key not in allowed or p['before']!=allowed[key]:
            raise ValueError('Patch is outside frozen editable scope or has forged before value')
        seen.add(key)
        if p['entity']=='camera-create':
            clip=p['after'];keys={'id','start','in','hold','out','zoom','enabled','name','inEasing','outEasing'}
            if not isinstance(clip,dict) or set(clip)!=keys or clip['id']!=p['id'] or clip['enabled'] is not True:
                raise ValueError('Invalid camera creation')
            if not all(isinstance(clip[k],(int,float)) and math.isfinite(clip[k]) for k in ['start','in','hold','out','zoom']) or clip['in']<.2 or clip['out']<.2 or clip['hold']<0 or not 1<clip['zoom']<=1.35:
                raise ValueError('Invalid camera values')
            document=snapshot['document'];source=document.get('source') or {};rate=document['canvas']['fps'];fps=rate['num']/rate['den']
            start=clip['start']*fps+source.get('startFrame',0);end=start+(clip['in']+clip['hold']+clip['out'])*fps;target=snapshot['target']
            segments=source.get('clips') or [{'startFrame':0,'durationFrames':document['canvas'].get('durationFrames',source.get('durationFrames',target['startFrame']+target['durationFrames'])),'sourceInFrame':source.get('startFrame',0)}]
            projected=[]
            for segment in segments:
                left=max(start,segment['sourceInFrame']);right=min(end,segment['sourceInFrame']+segment['durationFrames'])
                if right>left:
                    projected.append((segment['startFrame']+left-segment['sourceInFrame'],segment['startFrame']+right-segment['sourceInFrame'],right-left))
            if source.get('locked') or len(projected)!=1 or abs(projected[0][2]-(end-start))>1e-5 or projected[0][0]<target['startFrame'] or projected[0][1]>target['startFrame']+target['durationFrames']:
                raise ValueError('Camera creation outside selected real source interval')
        elif p['entity']=='shot' and p['before'] is None:
            semantic_fields={'visualRequirement','mediaDescription','rationale','animationNeed','expressionGoal','requiredInformation','relationships','comprehensionDifficulty','factBoundary'}
            value=p['after']
            if p['field'] not in semantic_fields or not (isinstance(value,str) or isinstance(value,list) and all(isinstance(v,str) for v in value)):
                raise ValueError('Absent semantic field requires explicit text or text list')
            if p['field']=='animationNeed' and value not in {'required','optional','none'}:
                raise ValueError('Invalid animationNeed')
        elif not safe_value(p['after'],p['before']):
            raise ValueError('Patch changes path, structure, or value type')
        if p['entity']=='audio' and p['field']=='volume' and not 0<=p['after']<=2:
            raise ValueError('Invalid volume')
        if p['field'] in {'in','hold','out','fadeInFrames','fadeOutFrames'} and p['after']<0:
            raise ValueError('Invalid duration')
        output.append(p)
    return {'kind':'shot-revision','shotId':snapshot['shotId'],'target':copy.deepcopy(snapshot['target']),
            'jobId':snapshot['jobId'],'projectId':snapshot['projectId'],'reason':response['reason'],'gaps':gaps,'patches':output,
            **({'execution':copy.deepcopy(execution)} if execution else {})}


def revise_shot(store, model_json):
    snapshot=store.snapshot
    store.update(stage='revise_shot',reason='根据当前 package 上下文处理所选片段意见')
    prompt=('你正在处理 Motion Studio 单片段修改意见。只修改当前选中片段，完整 package 与工程仅用于理解上下文。'
            '只返回 editable 白名单中既有对象字段的 before/after patch。beforeJson/afterJson 是该字段完整 JSON 值的字符串。'
            '保留所有候选 URL、已读标记、素材身份、手调、锁定、删除项和其他片段。不能生成定制动画、创建代码、下载素材、'
            '增加任意路径。镜头与声音可以修改白名单里已有参数。唯一允许新增的对象是 editable 明确列出的 camera-create：'
            'afterJson 必须完整包含 id（等于白名单id）、start（原视频秒点）、in、hold、out（秒）、zoom（1到1.35）、enabled:true、name、inEasing、outEasing。'
            '推入拉回至少0.2秒，start 用冻结上下文 cameraSourceInterval 的源视频秒点；完整镜头必须严格位于该范围，不剪切、不变速。缺该白名单时不创建。无法执行的新增音效/素材/动画等需求，'
            '在 gaps 中明确真正缺少的输入或不支持的能力。用户明确要求搜集、下载或替换真实媒体时，返回 execution:{kind:footage,instructions:具体用户素材要求}，由宿主派发限于本片段的素材执行任务；只读限制仅适用于本修改模型，不是素材支线的能力限制，不把不能下载写成 gap。没有明确素材执行请求时 execution 为 {kind:none,instructions:空字符串}。不能生成定制动画或以素材执行替代动画需求；不能声称已制作或试听。没有 patch、execution 或 gap 的空结果无效。'
            '\n先读取下列冻结 contextPaths 中的 analysisPath/summary/review 文档，用完整当前 package 语义、素材与真实工程上下文理解意见；'
            '只读这些冻结文件，不用旧理想视觉规则。当前 document.productionPlan.shots 的显式 canonical 字段优先于历史归档；'
            '缺失语义字段在 editable 中 before 为 null，可以写对应新值（字符串或文字数组）。归档 sections.animationNeed/information/relations/boundaries'
            '分别对应当前 shot.animationNeed/requiredInformation/relationships/factBoundary。意见要求不要动画或换素材表达时，必须把真实语义修改写入相应 canonical 字段，'
            '不能仅改理解目标；若还需要当前执行能力不支持的新素材/动画，语义 patch 与 footage execution 同时返回；真正不支持的新增动画或声音仍写明确 partial gap。\n用户意见：'+snapshot['instructions']+'\n冻结上下文：'+json.dumps(snapshot.get('revisionContext'),ensure_ascii=False))
    response=model_json(store,prompt,revision_schema())
    result=validate_response(response,snapshot)
    result['gaps']=list(dict.fromkeys(result['gaps']+snapshot.get('revisionContextGaps',[])))
    store.publish(result)
    summary=store.root/'shot-revision-summary.md'
    summary.write_text('# 当前片段修改\n\n'+result['reason']+'\n\n'+('\n'.join('- '+g for g in result['gaps']) if result['gaps'] else '修改已发布，等待宿主 CAS 回写；不代表实际观看或试听通过。')+'\n',encoding='utf-8')
    return store.finish('partial' if result['gaps'] else 'complete',stage='shot_revision_published',reason=result['reason'],outputs={'summaryPath':str(summary)})
