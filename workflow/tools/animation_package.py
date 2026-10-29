#!/usr/bin/env python3
"""Semantic animation needs, native preset transport and manual Claude prompt.

This module never generates animation code, invokes Claude or mutates an editor.
The canonical plan service applies its plan/template results with revision guards.
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
import math
import os
import re
from pathlib import Path

try:
    from .package_branches import orchestration_version
    from .transcribe import load_cues
    from .broll_timeline import normalize
    from .ai_video_package import validate_candidates, render_ai_video_report
except ImportError:
    from package_branches import orchestration_version
    from transcribe import load_cues
    from broll_timeline import normalize
    from ai_video_package import validate_candidates, render_ai_video_report

MODE = 'semantic-template-v1'
VISUALIZATION = Path(os.environ.get('VISUALIZATION_ROOT', Path(__file__).resolve().parents[2] / 'studio')).resolve()
VISUAL_FIELDS = {'states', 'designIntent', 'focus', 'beats', 'startSeconds', 'endSeconds', 'durationSeconds', 'keyframeDescription', 'concept', 'customOption', 'presentationMode'}


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def write_json(path, value):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)+'\n', encoding='utf-8')


def visualization_root(request):
    snapshot = read_json(request['projectSnapshotPath']) if request.get('projectSnapshotPath') else {}
    return Path(request.get('visualizationRoot') or os.environ.get('VISUALIZATION_ROOT') or snapshot.get('repositoryRoot') or VISUALIZATION).resolve()


def catalog(root=None):
    root = Path(root or VISUALIZATION)
    return {d['id']: d for p in sorted((Path(root)/'docs/presets').glob('*/preset.json'))
            if (d := read_json(p)).get('engine') == 'remotion'}


def absolute_file(value, label, optional=False):
    if value is None and optional:
        return None
    if not isinstance(value, str) or not Path(value).is_absolute() or not Path(value).is_file():
        raise ValueError(label+' 必须是真实文件绝对路径')
    return Path(value)


def templates_enabled(request):
    return request.get('scope', {}).get('templates') is not False


def template_match(row, request):
    if not templates_enabled(request):
        return {'status': 'none', 'presetId': None, 'props': {}, 'reason': '自动模板匹配已关闭'}
    return row.get('templateMatch', {})


def validate_analysis(data, request):
    if data.get('schemaVersion') != 1 or data.get('workflowMode') != MODE or data.get('projectId') != request['projectId']:
        raise ValueError('语义 package 版本或工程身份不一致')
    for key, request_key in [('sourceSrtPath','sourceSrtPath'), ('sourceVideoPath','videoPath')]:
        if data.get(key) != request.get(request_key):
            raise ValueError(key+' 与本次输入不一致')
        absolute_file(data.get(key), key, optional=True)
    cues = load_cues(Path(data['sourceSrtPath'])) if data.get('sourceSrtPath') else []
    sections = data.get('sections')
    if not isinstance(sections, list) or not sections:
        raise ValueError('必须分析完整口播段落')
    seen, ids = set(), []
    for row in sections:
        if not isinstance(row, dict) or VISUAL_FIELDS.intersection(row):
            raise ValueError('语义需求不能填写具体视觉设计或动画秒数')
        sid = row.get('id')
        if not isinstance(sid,str) or not sid or '/' in sid or '\\' in sid or sid in seen:
            raise ValueError('段落标识无效或重复')
        seen.add(sid)
        for key in ('title','narration','goal','reason'):
            if not isinstance(row.get(key),str) or not row[key].strip():
                raise ValueError('段落缺少 '+key)
        if row.get('animationNeed') not in {'required','optional','none'}:
            raise ValueError('动画必要性无效')
        for key in ('information','relations','boundaries'):
            value=row.get(key)
            if not isinstance(value,list) or any(not isinstance(v,str) or not v.strip() for v in value):
                raise ValueError('段落 '+key+' 必须是文字列表')
        indices=row.get('sourceCueIds',[])
        if cues:
            if not indices or any(type(i) is not int or not 1<=i<=len(cues) for i in indices) or indices != list(range(indices[0],indices[-1]+1)):
                raise ValueError('口播 cue 必须是连续实际编号')
            if normalize(row['narration']) != normalize(''.join(cues[i-1]['text'] for i in indices)):
                raise ValueError('口播原文与实际 SRT 不一致')
            ids.extend(indices)
        match=template_match(row, request)
        if match.get('status') not in {'direct','partial','none'} or not isinstance(match.get('reason'),str) or not match['reason'].strip():
            raise ValueError('模板匹配缺少结论与理由')
        if match['status']!='none':
            if not isinstance(match.get('presetId'),str) or not isinstance(match.get('props'),dict):
                raise ValueError('已匹配模板必须有原生 id 和 props')
        if match.get('sourceCueIds') and (not indices or any(i not in indices for i in match['sourceCueIds']) or match['sourceCueIds']!=list(range(match['sourceCueIds'][0],match['sourceCueIds'][-1]+1))):
            raise ValueError('本地模板 cue 必须是本段内连续实际编号')
        if any(key in row for key in ('soundDesign', 'cameraIntent')):
            if data.get('fullPackageVersion') != 1 or request.get('fullPackageVersion') != 1:
                raise ValueError('本轮非动画声音/镜头设计需要完整制作 fullPackageVersion=1')
            if 'cameraIntent' in row and (not isinstance(row['cameraIntent'], dict) or not row['cameraIntent']):
                raise ValueError('cameraIntent 必须是本轮非动画镜头设计对象')
        if 'aiVideoCandidates' in row:
            row['aiVideoCandidates'] = validate_candidates(row['aiVideoCandidates'], request, row)
    if cues and ids != list(range(1,len(cues)+1)):
        raise ValueError('完整口播必须按序覆盖全部 SRT，不重叠不遗漏')
    if any('soundDesign' in row for row in sections):
        try:
            from .sound_design import validate_sound_design
        except ImportError:
            from sound_design import validate_sound_design
        validate_sound_design({'soundDesignVersion': 1, 'shots': sections})
        for row in sections:
            for cue in row['soundDesign']['cues']:
                if normalize(cue['anchor']) not in normalize(row['narration']):
                    raise ValueError('声音 cue anchor 锚点必须对应本段实际口播原文')
    snapshot_path = request.get('projectSnapshotPath')
    snapshot_review = read_json(snapshot_path).get('templateReviewVersion') if snapshot_path and Path(snapshot_path).is_file() else None
    if templates_enabled(request) and (request.get('templateReviewVersion') == 1 or snapshot_review == 1):
        validate_template_review(data, request)
    json.dumps(data, allow_nan=False)
    return data


def validate_template_review(data, request):
    review = data.get('templateReview', {})
    rows = review.get('sections', [])
    expected = [s['id'] for s in data['sections']]
    if review.get('version') != 1 or not isinstance(rows, list) or [r.get('sectionId') for r in rows] != expected:
        raise ValueError('模板复审必须按序覆盖全文全部意义段，包括保留真人段')
    known = catalog(visualization_root(request))
    for row, section in zip(rows, data['sections']):
        if row.get('decision') not in {'apply', 'keep_presenter', 'blocked'} or not isinstance(row.get('reason'), str) or not row['reason'].strip():
            raise ValueError('模板复审缺少本段采用或留白理由')
        opportunities = row.get('opportunities')
        if not isinstance(opportunities, list) or any(not isinstance(x, str) or not x.strip() for x in opportunities):
            raise ValueError('模板复审缺少强调、结论、转折等表达机会记录')
        candidates = row.get('candidates')
        if not isinstance(candidates, list) or (opportunities and not candidates):
            raise ValueError('模板复审有表达机会时必须比较实际模板')
        selected = []
        for candidate in candidates:
            if candidate.get('presetId') not in known or candidate.get('decision') not in {'selected', 'rejected', 'blocked'}:
                raise ValueError('模板复审引用未知模板或缺少比较结论')
            if any(not isinstance(candidate.get(k), str) or not candidate[k].strip() for k in ('reason', 'visualBenefit')):
                raise ValueError('模板复审必须说明表达适配及具体画面收益')
            if candidate['decision'] == 'selected':
                selected.append(candidate['presetId'])
        match = section['templateMatch']
        if row['decision'] == 'apply' and (match['status'] == 'none' or selected != [match.get('presetId')]):
            raise ValueError('模板复审采用结论与实际 templateMatch 不一致')
        if row['decision'] != 'apply' and (selected or match['status'] != 'none'):
            raise ValueError('模板复审留白或阻塞不能继续提交已选模板')


def catalog_audit(root=None):
    root = Path(root or VISUALIZATION)
    definitions = catalog(root)
    menu = root/'docs/presets/MENU.md'
    text = menu.read_text(encoding='utf-8') if menu.is_file() else ''
    listed = {pid: int(version) for pid, version in re.findall(r'^## ([a-z0-9-]+) · .*? · v(\d+)', text, re.M)}
    missing = sorted(set(definitions)-set(listed))
    extra = sorted(set(listed)-set(definitions))
    changed = sorted(pid for pid in set(definitions)&set(listed) if definitions[pid].get('version') != listed[pid])
    return {'authoritativeIds': sorted(definitions), 'menuPath': str(menu.resolve()),
            'menuCurrent': menu.is_file() and not (missing or extra or changed),
            'missingFromMenu': missing, 'unknownMenuIds': extra, 'versionMismatches': changed}


def capability_index(presets, root=None):
    root = Path(root or VISUALIZATION)
    rows = [{'id':p['id'],'name':p.get('name'),'version':p.get('version'),'status':p.get('status'),
             'description':p.get('description'), 'anchors':p.get('anchors'), 'sample':p.get('sample'),
             'compositionId':p.get('compositionId'),
             'canvas':p.get('canvas'),'duration':p.get('duration'),'tags':p.get('tags'),
             'slots':p.get('slots'),'variants':p.get('variants'),'motion':p.get('motion'),
             'output':p.get('output'),'objective':p.get('objectiveTemplate'),
             'source':str(root/'docs/presets'/p['id']/'preset.json'),
             'sourceSha256':digest(root/'docs/presets'/p['id']/'preset.json')}
            for p in presets.values()]
    for row in rows:
        preset = presets[row['id']]
        for key, path in [('documentation', root/'docs/presets'/row['id']/'PRESET.md'),
                          ('component', root/preset['componentSource'] if preset.get('componentSource') else None)]:
            if path is not None and path.is_file():
                row[key] = {'path':str(path.resolve()), 'sha256':digest(path)}
    return rows


def validate_preset(preset, props, canvas, duration):
    if not any(abs(int(w)/int(h)-canvas['width']/canvas['height'])<.001 for w,h in (x.split('x') for x in preset.get('canvas',[]))):
        raise ValueError('模板当前画幅不能直接适配')
    bounds=preset.get('duration',{})
    if duration < bounds.get('min',0)-.034 or duration > bounds.get('max',86400)+.034:
        raise ValueError('当前区间超出模板原生时长范围')
    slots=props.get('slots',{})
    for key,desc in preset.get('slots',{}).items():
        val=slots.get(key)
        if desc.get('required') and (val is None or val=='' or val==[]):
            raise ValueError('模板必填槽位缺失: '+key)
        if val is None: continue
        if desc.get('type')=='list' and (not isinstance(val,list) or len(val)<desc.get('minItems',0) or len(val)>desc.get('maxItems',1000)):
            raise ValueError('模板列表槽位无效: '+key)
    for key,val in props.get('variant',{}).items():
        desc=preset.get('variants',{}).get(key)
        if not desc or (desc.get('values') and val not in desc['values']):
            raise ValueError('模板原生档位无效: '+key)


def build_plan(data, request, document):
    try:
        from .editor_plan_runtime import map_source_interval
    except ImportError:
        from editor_plan_runtime import map_source_interval
    plan=copy.deepcopy(document.get('productionPlan',{}))
    plan.setdefault('schemaVersion',1);plan['revision']=plan.get('revision',0)+1
    plan['animationWorkflow']=MODE
    plan['sourceSrtPath']=data.get('sourceSrtPath')
    plan['transcriptTimeBase']=request.get('transcriptTimeBase','source')
    if request.get('transcriptProvenancePath'):plan['transcriptProvenancePath']=request['transcriptProvenancePath']
    full=data.get('fullPackageVersion') == 1 and request.get('fullPackageVersion') == 1
    if full and any('soundDesign' in row for row in data['sections']):
        plan['soundDesignVersion']=1
    plan.setdefault('approval','draft')
    originals={s['id']:s for s in plan.get('shots',[])}
    cues=load_cues(Path(data['sourceSrtPath'])) if data.get('sourceSrtPath') else []
    presets=catalog(visualization_root(request)) if templates_enabled(request) else {};templates=[];issues=[];shots=[]
    if data.get('sourceSrtPath') and data.get('sourceVideoPath'):
        plan['transcriptBinding']={'sourceSha256':digest(data['sourceVideoPath']),'transcriptSha256':digest(data['sourceSrtPath'])}
    rate=document['canvas']['fps'];fps=rate['num']/rate['den'] if isinstance(rate,dict) else rate
    source=(document.get('source') or {}).get('path')
    def transcript_ranges(selected, shot_id):
        if request.get('transcriptTimeBase') == 'project':
            start=round(selected[0]['start']*fps);end=round(selected[-1]['end']*fps)
            if start < 0 or end > document['canvas']['durationFrames'] or end <= start:
                raise ValueError('工程时间字幕超出当前工程边界')
            return [{'id':shot_id+'-project-transcript','startFrame':start,'durationFrames':end-start}]
        return map_source_interval(document,source,selected[0]['start'],selected[-1]['end'],shot_id)
    for order,row in enumerate(data['sections'],1):
        target_shot=request.get('projectTarget',{}).get('shotId')
        if target_shot and row['id'] != target_shot:
            if row['id'] in originals:
                shots.append(copy.deepcopy(originals[row['id']]))
            continue
        shot=copy.deepcopy(originals.get(row['id'],{}))
        narration=row['narration'];description='；'.join(row['information'])
        if full:
            # Preserve the canonical text when SRT joining changes only layout.
            # Result identity uses narration and requirementVersion, so even a
            # harmless newline rewrite could otherwise duplicate native presets.
            if isinstance(shot.get('narration'),str) and re.sub(r'\s+', '', shot['narration']) == re.sub(r'\s+', '', narration):
                narration=shot['narration']
            if isinstance(shot.get('mediaDescription'),str) and re.sub(r'\s+', '', shot['mediaDescription']) == re.sub(r'\s+', '', description):
                description=shot['mediaDescription']
        shot.update(id=row['id'],order=order,title=row['title'],narration=narration,visualRequirement=row['goal'],mediaDescription=description,animationBrief={k:copy.deepcopy(row[k]) for k in ('animationNeed','goal','information','relations','boundaries','reason')},templateMatch=copy.deepcopy(template_match(row, request) if templates_enabled(request) else shot.get('templateMatch', template_match(row, request))))
        shot['sourceCueIds']=copy.deepcopy(row.get('sourceCueIds',[]))
        shot.setdefault('requirementVersion',1);shot.setdefault('approval','draft')
        shot.setdefault('slots',[]);shot.setdefault('bindings',[]);shot.setdefault('candidates',[]);shot.setdefault('keyframes',[])
        upstream=shot.setdefault('upstream',{})
        if full:
            for key in ('soundDesign', 'cameraIntent'):
                if key in row:
                    shot[key]=copy.deepcopy(row[key])
                    upstream.setdefault('packageShot',{})[key]=copy.deepcopy(row[key])
            if 'soundDesign' in row:
                shot['soundDesignVersion']=1
        for key in ('anchor','effectTiming'):
            if key in shot:
                upstream.setdefault('historicalAnimationTiming',{})[key]=shot.pop(key)
        shot.setdefault('timing',{'status':'unaligned','manual':False,'ranges':[]})
        if not shot['timing'].get('manual') and shot['timing'].get('status')!='manual' and cues and source:
            selected=[cues[i-1] for i in row['sourceCueIds']]
            ranges=transcript_ranges(selected,shot['id'])
            for target_range in ranges:
                prior=[r for r in shot['timing'].get('ranges',[]) if r.get('startFrame')==target_range['startFrame'] and r.get('durationFrames')==target_range['durationFrames']]
                if len(prior)==1:target_range['id']=prior[0]['id']
            shot['timing']={'status':'aligned' if ranges else 'unaligned','manual':False,'ranges':ranges,'origin':'semantic-template-srt'}
        elif not source and shot['timing'].get('status')!='manual':
            shot['timing']={'status':'unaligned','manual':False,'ranges':[]}
        if (row['animationNeed']!='none' or template_match(row, request)['status']!='none') and not shot['slots']:
            shot['slots']=[{'id':shot['id']+'-primary','type':'animation','description':row['goal'],'requirementVersion':shot['requirementVersion']}]
        previous=originals.get(row['id'])
        fields=('effectTiming','presenterLayerIntent','visualRequirement','mediaDescription','narration','slots') if full else ('effectTiming','cameraIntent','presenterLayerIntent','visualRequirement','mediaDescription','narration','slots')
        if previous and any(previous.get(k)!=shot.get(k) for k in fields):
            shot['requirementVersion']=max(previous.get('requirementVersion',1)+1,shot['requirementVersion'],*(b.get('requirementVersion',0)+1 for b in shot['bindings']))
            for slot in shot['slots']:slot['requirementVersion']=shot['requirementVersion']
            for binding in shot['bindings']:
                if binding.get('status')!='removed':binding['status']='requirements_changed'
            shot['approval']='needs_design'
            shot.pop('approvedRequirementVersion',None)
        if 'aiVideoCandidates' in row:
            # Version advancement precedes prompt binding. Rebinding an old prompt
            # to new requirements here would make a stale upload look current.
            shot['aiVideoCandidates']=validate_candidates(row['aiVideoCandidates'],request,dict(row,requirementVersion=shot['requirementVersion']))
        shots.append(shot)
        match=template_match(row, request)
        # Native emphasis is an independent benefit even when no custom
        # animation is needed; its match, rather than Claude need, decides it.
        if match['status']=='none':continue
        try:
            preset=presets.get(match['presetId'])
            if not preset:raise ValueError('本地模板不存在')
            if match.get('presetVersion') is not None and match['presetVersion']!=preset['version']:
                raise ValueError('本地模板版本不匹配')
            ranges=shot['timing']['ranges']
            if len(ranges)!=1:raise ValueError('没有唯一实际计划区间')
            parent=ranges[0];target={'rangeId':parent['id'],'startFrame':parent['startFrame'],'durationFrames':parent['durationFrames']}
            if match.get('sourceCueIds') and not shot['timing'].get('manual'):
                selected=[cues[i-1] for i in match['sourceCueIds']]
                subset=transcript_ranges(selected,shot['id'])
                if len(subset)!=1:raise ValueError('模板子区间不唯一')
                target.update(startFrame=subset[0]['startFrame'],durationFrames=subset[0]['durationFrames'])
            if 'startSeconds' in match or 'durationSeconds' in match:
                start=match.get('startSeconds');duration=match.get('durationSeconds')
                if any(type(v) not in (int,float) or not math.isfinite(v) for v in (start,duration)) or start<0 or duration<=0:
                    raise ValueError('模板子区间需要有效起点和正时长')
                target.update(startFrame=round(start*fps),durationFrames=round(duration*fps))
                if target['durationFrames']<1:raise ValueError('模板子区间不足一帧')
            if target['startFrame']<parent['startFrame'] or target['startFrame']+target['durationFrames']>parent['startFrame']+parent['durationFrames']:
                raise ValueError('模板目标超出当前计划区间')
            props=copy.deepcopy(match['props']);props['durationSeconds']=target['durationFrames']/fps
            validate_preset(preset,props,document['canvas'],props['durationSeconds'])
            slot=next((s for s in shot['slots'] if s.get('type')=='animation'),None)
            if not slot:raise ValueError('当前需求没有动画槽位，不改写用户槽位')
            if slot.get('presentationMode', shot.get('presentationMode')) == 'overlay':
                props.setdefault('editorBackground', 'transparent')
            templates.append({'kind':'template','shotId':shot['id'],'slotId':slot['id'],'requirementVersion':shot['requirementVersion'],'narration':shot['narration'],'template':{'id':preset['id'],'props':props},'target':target,'technical':{'passed':True,'details':{'basis':'native-preset-definition','presetVersion':preset['version']}},'reason':match['reason']})
        except ValueError as e:
            issues.append({'shotId':shot['id'],'reason':str(e)})
    # Preserve previously cancelled or unselected records and all original bindings.
    selected_ids={s['id'] for s in shots}
    shots.extend(copy.deepcopy(s) for s in plan.get('shots',[]) if s['id'] not in selected_ids)
    plan['shots']=shots
    plan.setdefault('packages',[]);plan.setdefault('conflicts',[]);plan.setdefault('changes',[])
    plan.setdefault('appliedResultIds',[]);plan.setdefault('dismissedResultIds',[]);plan.setdefault('hoverEnabled',True)
    return plan,templates,issues


def claude_delivery_instructions(request):
    return [
        '- 交付实际媒体，并在同目录附 UTF-8 的 animation-delivery.json；清单是导入时间和透明形式的准源，无需注册模板或构造原分镜合同。',
        '- 清单格式：schemaVersion=1、timeBase="project"、projectId="' + request['projectId'] + '"，files 为数组；每项含 file（文件名/相对清单路径/绝对路径）、startSeconds（起始秒数）、durationSeconds（实际时长）、transparent（布尔值）。',
        '- startSeconds 以当前 Motion Studio 工程时间轴开头为 0 秒；起始及实际时长由你决定，可跨段合镜，不需落入 Codex 原段落区间。工程如已剪切/变速，先读当前工程的 source.clips 映射；不要直接把原片秒点当工程秒点。',
        '- 当前工程与 source.clips：' + 'http://localhost:4358/api/editor/production-plan?projectId=' + request['projectId'] + '。',
        '- 回传透明叠层、画中画或已包含口播画面的整幅片段都可以；transparent=false 的整幅片段直接覆盖画面，不因原计划标成叠层而拒收，原口播音频保留，导入片段自带音频静音。',
        '- 清单文件按时间追加独立实例，非重叠尽量共用自动素材与动画轨道，叠加冲突时分轨，并列保留现有模板；段落标识仅作可选关联，不决定位置或形式。不使用抽帧猜位置；没有清单的普通素材才走内容识别。',
        '- 若决定用透明叠层，交真实带 Alpha 的文件并标 transparent=true；清单声明会与实际文件技术核对。音效不要烧入画面，由后续独立音轨处理。',
        '- 清单详细格式：../workflow/docs/animation-delivery-manifest.md。',
    ]


def render_claude_prompt(data, request):
    root=visualization_root(request)
    lines=['## 给 Claude 的动画提示词','', '请在本机 visualization 项目中完成下面保留段落的动画设计与制作。用户会删除不需要的段落；只处理剩余段落，段落标识用于关联需求，不强制一段一镜。','',
           '### 公共说明','',f"- 完整脚本：{request['finalScriptPath']}",f"- 本地 SRT：{data.get('sourceSrtPath') or '当前缺失，尚无真实时间依据'}",f"- 主口播视频：{data.get('sourceVideoPath') or '当前缺失'}",
           '- 复用以上本地 SRT，不重复上传或识别；先读取完整脚本和字幕上下文。',
           '- 每段设计前至少抽看真实口播的开头、中间、结尾，手势/实物/切镜处加抽，记录源文件、秒点、截图与判断；结合当前工程镜头和字幕决定纯真人、轻叠加或复杂演示，不只读SRT。',
           '- 要么简洁有效，要么复杂且值得占屏。简单概念放在真人画面旁演示；复杂场景占主画面时，保留同一时刻同步播放、原色的真人圆角小窗，不用静态头像。禁止简单图标和文字铺满全屏做成PPT。',
           '- 先定义关系，再让动作直接表达：快慢看完成先后，远近看距离变化，因果看状态变化；箭头不能代替关系。不要擅自把效率改成偏好，不虚构速度倍数或测量结论。',
           '- 铺垫留真人，动画切入即发生有效变化，结果看清后退出；不提前三四秒进场静等，不按整个字幕段填时长，不用无意义循环冒充信息推进。',
           '- 这是短视频：辅助画面一次只增加一个迅速读懂的重点。删除导航、章节号、页眉、重复标题和额外解释，不加安全免责声明脚注；事实边界留设计记录，不能靠小字补救误导画面。实际合成检查人物、手势、实物、字幕、节奏与手机尺寸可读性。',
           f"- 人物与阅读负担规则：{Path(__file__).resolve().parents[1]}/docs/animation-design-standard.md（短视频的人物保留与阅读负担）。",
           '- 具体画面、镜头数量、动画起止及持续时间由你决定，不受本地模板已有时间区间限制。',
           '- 画幅继承实际主视频或明确的工程画布，不默认竖屏；保持事实、可读性、确定性和必要的透明输出。',
           f"- 本期画布：{request['canvas']['width']} × {request['canvas']['height']}。",
           f'- 工作项目：{root}。',
           f'- 当前规则：{root}/AGENTS.md、{root}/.devin/skills/motion-broll/SKILL.md、{root}/docs/agent-runbook.md、{root}/docs/visual-first.md。',
           '- 本次是用户手动委托 Claude。按此次分工自主设计，不读取失效的旧 Claude 配置或历史 benchmark，不恢复动画审批停点。',
           f"- 输出位置：{Path(request['outputRoot'])/'claude-output'}（实际有产物时创建）。",
           *claude_delivery_instructions(request),'']
    for index,row in enumerate(data['sections'],1):
        if row['animationNeed']=='none':continue
        lines.extend([f"========== 段落 {index:02d}｜{row['title']} ==========",f"计划标识：{row['id']}",f"对应口播原文：{row['narration']}",f"必要性：{'建议' if row['animationNeed']=='required' else '可选'}；{row['reason']}",f"观众需要理解：{row['goal']}",'必须传达的信息：'+ '；'.join(row['information']),'关系与理解难点：'+'；'.join(row['relations']),'事实与内容边界：'+'；'.join(row['boundaries'])])
        if row.get('reusableTemplateNote'):
            lines.append('通用性建议：'+row['reusableTemplateNote'])
        lines.extend([f'========== 段落 {index:02d} 结束 ==========',''])
    return '\n'.join(lines).rstrip()+'\n'


def summary(data, request, templates, issues, production=None):
    planned={r['shotId']:r for r in templates};errors={r['shotId']:r['reason'] for r in issues if r.get('shotId')}
    lines=[f"# {data.get('title','本期口播')} package 总结",'', '本期按“语义分析 → 原生模板直接应用 → 外部动画提示词”处理。计划保留全文表达需求；本地模板与后续外部素材并列保留，由控制台删除和调整决定采用。' if templates_enabled(request) else '本期围绕全文分析、素材匹配、AI 视频提示词与 Claude 动画提示词制作；自动模板匹配已关闭，完成情况见实际回执。','',f"工程：{request['projectId']}",f"控制台：http://localhost:4358/editor?document={request['projectId']}",'', '## 全文分析与模板匹配' if templates_enabled(request) else '## 全文分析与画面需求','']
    for index,row in enumerate(data['sections'],1):
        match=template_match(row, request);result=planned.get(row['id'])
        lines.extend([f"### {index:02d} {row['title']}",'',f"口播：{row['narration']}",'',f"动画必要性：{row['animationNeed']}；{row['reason']}",f"表达目标：{row['goal']}",'信息与关系：'+'；'.join(row['information']+row['relations']),*([f"模板：{match.get('presetId') or '无直接适配模板'}；{match['reason']}"] if templates_enabled(request) else [])])
        if match.get('gaps'):lines.append('表达缺口：'+'；'.join(match['gaps']))
        if result:lines.append(f"应用目标：{result['target']['startFrame']} 帧起，持续 {result['target']['durationFrames']} 帧；原生参数已准备，实际入轨以工程回读为准。")
        elif row['id'] in errors:lines.append('技术或输入缺口：'+errors[row['id']])
        lines.append('')
    if templates_enabled(request) and data.get('templateReview'):
        lines.extend(['## 全文模板表现力复审', ''])
        for row in data['templateReview']['sections']:
            lines.extend([f"- {row['sectionId']}：{row['decision']}；{row['reason']}"])
            for candidate in row['candidates']:
                lines.append(f"  - {candidate['presetId']}：{candidate['decision']}；{candidate['reason']}；画面收益：{candidate['visualBenefit']}")
        lines.append('')
    if production:
        try:
            from .package_production import render_report
        except ImportError:
            from package_production import render_report
        lines.append(render_report(production))
    if any('aiVideoCandidates' in row for row in data['sections']):
        lines.append(render_ai_video_report(data['sections']))
    lines.extend(['## 当前交付与边界','',f'适配且技术可用的模板：{len(templates)} 项。模板结果由同一次任务交给工程服务自动保存，不等待动画批准。' if templates_enabled(request) else '自动模板匹配与应用已关闭；既有模板及用户手调保留。',
                  '本轮镜头、字幕、封面、声音和素材实际动作见上方回执；源视频、原始SRT、用户手调及显隐状态保留。' if production else '本期源视频、字幕、口播镜头参数与已有素材保留。新增模板不替换旧素材；原有手调及显隐状态保持。',
                  '尚未制作 Claude 动画；提示词就绪不代表动画完成。模板技术检查不代表动态观看或整片验收。',
                  '非动画职责以本轮完整制作回执为准；技术检查、观看、听审分别记录。' if production else '声音按现有独立轨道处理；本次未新增未经试听的模板默认音效。','',render_claude_prompt(data,request)])
    return '\n'.join(lines).rstrip()+'\n'


def finalize(request, analysis_path):
    orchestration_version(request)
    analysis_path=Path(analysis_path).resolve(strict=True)
    output=Path(request['outputRoot']).resolve();package=Path(request['packageRoot']).resolve()
    if not analysis_path.is_relative_to(output) or not package.is_relative_to(output):
        raise ValueError('新产物必须位于 outputRoot')
    for source in request.get('sources',[]):
        if digest(source['path']) != source['sha256']:
            raise ValueError('package 来源 SHA 已改变: '+source['path'])
    data=validate_analysis(read_json(analysis_path),request)
    snap=read_json(request['projectSnapshotPath']);doc=snap['document']
    try:
        from .package_production import validate_full_package, production_document
    except ImportError:
        from package_production import validate_full_package, production_document
    production=validate_full_package(data,request,doc)
    doc,_=production_document(data,request,doc)
    plan,templates,issues=build_plan(data,request,doc)
    if production:issues.extend(production['issues'])
    branch_run=None;branch_files=[];bgm_plan_ready=False
    if 'packageOrchestrationVersion' in request or (request.get('fullPackageVersion') == 1 and request.get('phase',request.get('kind','package')) == 'package'):
        try:
            from .package_branches import validate_branch_run
        except ImportError:
            from package_branches import validate_branch_run
        try:from .package_branch_publication import refresh_application_state
        except ImportError:from package_branch_publication import refresh_application_state
        refresh_application_state(request)
        branch_path=output/'package-branches.json'
        branch_sha=digest(branch_path)
        # Validate successful siblings even if an AI/template-only proposal
        # failed outside the seven production receipts; retain that real gap.
        branch_run=validate_branch_run(request,branch_path,allow_partial=True)
        # BGM is a plan-only result. Validate and bind its proposal before
        # deciding whether this branch needs a streaming application receipt.
        if request.get('bgmPlanVersion') == 1:
            bgm=branch_run['branches'].get('bgm',{})
            if bgm.get('status') == 'complete':
                try:from .bgm_package import apply_to_plan
                except ImportError:from bgm_package import apply_to_plan
                frozen=read_json(branch_run['sharedInputPath'])['semantic']
                apply_to_plan(plan,read_json(bgm['manifestPath']),frozen)
                bgm_plan_ready=True
                if request.get('bgmExecutionVersion') == 1:
                    try:from .bgm_package import execution_applied
                    except ImportError:from bgm_package import execution_applied
                    if not execution_applied(doc,request['runId']):
                        issues.append({'reason':'BGM 尚未完成本轮实际剪辑入轨，或已有音乐受到保护/已被编辑；计划不代表应用'})
        incomplete=[name for name,branch in branch_run['branches'].items() if branch['status'] not in {'complete','skipped'}]
        if branch_run['status']!='complete' or incomplete:
            issues.append({'reason':'package 专项分支尚未完整完成: '+branch_run['status']+('；'+','.join(incomplete) if incomplete else '')})

        def branch_file(path,sha,role):
            if digest(path)!=sha:raise ValueError('package 专项文件 SHA 已改变: '+str(path))
            branch_files.append({'path':str(path),'sha256':sha,'role':role})

        branch_file(branch_path,branch_sha,'package-branches')
        try:from .package_branches_v2 import evidence_records
        except ImportError:from package_branches_v2 import evidence_records
        for record in evidence_records(branch_run):branch_file(record['path'],record['sha256'],'package-v2-evidence')
        if branch_run.get('earlyHandoff',{}).get('status')=='blocked':issues.append({'reason':'提前动画交接有缺口'})
        for name,row in {**branch_run['branches'],**branch_run.get('postStages',{})}.items():
            gate_path=row.get('validation',{}).get('receiptPath')
            if gate_path:
                issues.extend(dict(item,branch=name) for item in read_json(gate_path).get('issues',[]))
            if name=='bgm' and bgm_plan_ready and request.get('bgmExecutionVersion') != 1:continue
            if row.get('status')=='complete' and row.get('application',{}).get('status') not in {'applied','preserved_manual','not_required'}:issues.append({'reason':'专项尚未真实应用: '+name})
        if request.get('scope',{}).get('sound') is not False and branch_run.get('postStages',{}).get('sound',{}).get('status')!='complete':issues.append({'reason':'独立声音专项尚未完成'})
    report=package/'plan.md';report.parent.mkdir(parents=True,exist_ok=True)
    report.write_text(summary(data,request,templates,issues,production),encoding='utf-8')
    root=visualization_root(request)
    cap=package/'template-capabilities.json' if templates_enabled(request) else None
    if cap: write_json(cap,capability_index(catalog(root), root))
    if production:
        plan['upstream']=dict(plan.get('upstream',{}),completePackage={'fullPackageVersion':1,'runId':production['runId'],'productionReceiptPaths':production['productionReceiptPaths'],'productionReadbackPath':production['productionReadbackPath'],'designPath':str(analysis_path),'reportPath':str(report),'state':production['state'],'branches':{name:row['status'] for name,row in production['receipts'].items()}})
    plan['upstream']=dict(plan.get('upstream',{}),animationPackage={'mode':MODE,'summaryPath':str(report),'analysisPath':str(analysis_path)})
    actual_plan=package/'production-plan.json';write_json(actual_plan,plan)
    files=[{'path':str(p),'sha256':digest(p),'role':role} for p,role in [(analysis_path,'semantic-analysis'),(report,'package-summary'),(cap,'template-capabilities'),(actual_plan,'production-plan')] if p is not None]
    files.extend(branch_files)
    seen_references=set()
    for shot in plan['shots']:
        for candidate in shot.get('aiVideoCandidates',[]):
            for reference in candidate['references']:
                path=reference['path']
                if digest(path)!=reference['sha256']:
                    raise ValueError('AI 视频参考图 SHA 已改变: '+path)
                if path not in seen_references:
                    files.append({'path':path,'sha256':reference['sha256'],'role':'ai-video-reference'})
                    seen_references.add(path)
    if production:
        files.extend(production['files'])
    plan['packages'].append({'id':request['jobId'],'files':files,'markdown':report.read_text(),'approval':'not-required'})
    result={'kind':'plan','shotId':'','plan':plan,'reason':'全文语义需求、素材与动画提示词','package':plan['packages'][-1]}
    manifest={'version':1,'workflowMode':MODE,'jobId':request['jobId'],'state':'partial' if issues else ('complete' if data.get('sourceSrtPath') else 'plan_only'),'stage':'semantic_template_ready','files':files,'results':[result,*templates],'issues':issues,'outputs':{'semanticPackagePath':str(analysis_path),'planPath':str(report),'productionPlanPath':str(actual_plan),**({'templateCapabilitiesPath':str(cap)} if cap else {})}}
    if branch_run:
        manifest['packageOrchestrationVersion']=orchestration_version(request)
        manifest['outputs']['packageBranchesPath']=str(output/'package-branches.json')
    if production:
        manifest.update(fullPackageVersion=1,runId=production['runId'],stage='full_package_ready')
        manifest['outputs']['productionReceiptPaths']=production['productionReceiptPaths']
        if production['productionReadbackPath']:
            manifest['outputs']['productionReadbackPath']=production['productionReadbackPath']
    write_json(request['resultManifestPath'],manifest)
    return manifest


def main():
    p=argparse.ArgumentParser(description=__doc__);sub=p.add_subparsers(dest='command',required=True)
    f=sub.add_parser('finalize');f.add_argument('--request',required=True);f.add_argument('--analysis',required=True)
    c=sub.add_parser('catalog');c.add_argument('--out',required=True)
    args=p.parse_args()
    if args.command=='catalog':write_json(args.out,capability_index(catalog()));print(args.out)
    else:
        r=finalize(read_json(args.request),args.analysis)
        print(json.dumps({'state':r['state'],'templates':len(r['results'])-1,'summary':r['outputs']['planPath'],'issues':r['issues']},ensure_ascii=False))


if __name__=='__main__':main()
