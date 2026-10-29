"""Short-lived post-application sound proposal worker; never writes the editor."""
import copy
import os
from pathlib import Path
import tempfile
import uuid
from . import package_branches as pb
from .sound_design import validate_sound_design


def prepare_sound_input(request, applied_events, current_document):
    if request.get('scope',{}).get('sound') is False:return {'status':'skipped','reason':'sound scope disabled'}
    issues=[];files=[]
    if not isinstance(applied_events,dict) or applied_events.get('status')!='applied':
        return {'status':'blocked','issues':['actual applied event evidence required']}
    for key in ('projectId','runId'):
        if applied_events.get(key)!=request.get(key):issues.append('applied event '+key+' mismatch')
    events=applied_events.get('events')
    if not isinstance(events,list):issues.append('actual events list required');events=[]
    common=applied_events.get('receiptPath')
    receipts=([common] if common else [])
    if not events and not common:issues.append('empty event set requires actual application receipt')
    for event in events:
        if event.get('applicationStatus',event.get('status'))!='applied':issues.append('event not applied')
        path=event.get('receiptPath') or common
        if not path:issues.append('event application receipt missing')
        else:receipts.append(path)
    for path in dict.fromkeys(receipts):
        if not Path(path).is_absolute() or not Path(path).is_file():issues.append('application receipt missing: '+str(path));continue
        ack=pb.load(path)
        if ack.get('status',ack.get('applicationStatus')) not in {'applied','complete'}:issues.append('application acknowledgement not applied: '+str(path))
        files.append(pb.file_record(path))
    semantic=request.get('semantic')
    if request.get('semanticPath'):
        path=Path(request['semanticPath'])
        if path.is_file():semantic=pb.load(path);files.append(pb.file_record(path))
        else:issues.append('immutable semanticPath missing')
    if not isinstance(semantic,dict) or not semantic.get('sections'):issues.append('complete semantic sound intentions required');sections=[]
    else:
        sections=copy.deepcopy(semantic['sections'])
        # Sound design may be completed after the immutable animation baseline.
        # Only consume intentions already saved on the same current requirement.
        current_shots={s.get('id'):s for s in current_document.get('productionPlan',{}).get('shots',[])}
        for section in sections:
            current=current_shots.get(section.get('id'),{})
            if 'soundDesign' not in section and current.get('narration')==section.get('narration') and current.get('requirementVersion')==section.get('requirementVersion') and 'soundDesign' in current:
                section['soundDesign']=copy.deepcopy(current['soundDesign'])
    try:validate_sound_design({'soundDesignVersion':1,'shots':sections})
    except (ValueError,KeyError,TypeError) as exc:issues.append(str(exc))
    ids=[row.get('id') for row in sections]
    if any(not sid for sid in ids) or len(ids)!=len(set(ids)):issues.append('unique complete semantic section IDs required')
    for key in ('finalScriptPath','sourceSrtPath','videoPath','audioPath'):
        if request.get(key):
            if Path(request[key]).is_file():files.append(pb.file_record(request[key]))
            else:issues.append(key+' missing')
    for source in request.get('sources',[]):
        path=source.get('path')
        if not path or not Path(path).is_file():issues.append('bound source missing: '+str(path))
        elif pb.digest(path)!=source.get('sha256'):issues.append('bound source changed: '+path)
        else:files.append(pb.file_record(path))
    if current_document.get('id',current_document.get('projectId',request['projectId']))!=request['projectId']:issues.append('current project identity mismatch')
    if issues:return {'status':'blocked','issues':issues}
    projection={key:copy.deepcopy(current_document.get(key)) for key in ('id','projectId','revision','fps','durationFrames','source','canvas','instances','captions','audioClips','audioTracks','tracks','productionPlan')}
    if isinstance(projection.get('source'),dict):
        projection['source']={key:copy.deepcopy(projection['source'][key]) for key in ('path','videoPath','sha256','sourceVideoSha256','audioPath','audioSha256','clips','cameraPlan','fps','width','height','durationFrames') if key in projection['source']}
    # No worker logs or sibling search history enter this isolated input.
    intentions=[{key:copy.deepcopy(row[key]) for key in ('id','narration','soundDesign') if key in row} for row in sections]
    content={'projectId':request['projectId'],'soundDesignVersion':1,'sections':intentions,'currentDocument':projection,'appliedEvents':copy.deepcopy(applied_events),'dependencies':files}
    fingerprint=pb.json_digest(content)
    sound_root=Path(request['outputRoot']).resolve()/'sound-branch'
    frozen=sound_root/fingerprint
    frozen.mkdir(parents=True,exist_ok=True)
    event_path=frozen/'applied-events.json';event_value={'projectId':request['projectId'],'runId':request['runId'],'events':applied_events,'currentDocument':projection}
    if event_path.exists() and pb.load(event_path)!=event_value:raise ValueError('immutable applied events changed')
    pb.atomic_json(event_path,event_value)
    attempt=uuid.uuid4().hex
    return {**content,'status':'ready','runId':request['runId'],'branchId':'sound','attemptId':attempt,'inputFingerprint':fingerprint,'dependencyFingerprint':fingerprint,'outputRoot':str(sound_root/'attempts'/attempt),'appliedEventsPath':str(event_path),'appliedEventsSha256':pb.digest(event_path)}


def _default_runner(req,stop):
    try:from .editor_plan_runtime import codex_binary,codex_exec_command
    except ImportError:from editor_plan_runtime import codex_binary,codex_exec_command
    binary=codex_binary()
    prompt=('你是本轮独立声音专项，只读 request.json 中完整口播声音意图及真实已应用事件，不读取其他专项日志。'
            '只写 outputRoot，不调用工程API、不提交、不重转写、不启动Claude、不购买API、不再派专项。'
            '读取 '+str(pb.ROOT/'docs/sound-design-contract.md')+' 和 '+str(pb.ROOT/'config/sound-design.md')+'；'
            '不机械给所有动画配声；保护现有手调、锁定和已删除音轨。无必要音效可留白，但必须全文审阅。'
            'soundDesign.silence仅表示不加SFX，不清空BGM；读取currentDocument.productionPlan的bgmDesign协调密度，复杂推理段减少重复强调。'
            'BGM计划不等于已有音频，实际音乐以audioClips为准，不声称未执行的自动ducking或混音。'
            '制作原生sound-cues.json(version=1、projectId、expectedRevision、fps、durationFrames、planPath、planSha256、cues)，实际事件决定时点。'
            '音效文件必须真实且有证据，audition按实际试听填写；未试听不得写已听。'
            'proposal.json={schemaVersion:1,branchId:"sound",items:[],reason,decision:"execute或leave_blank",soundManifestPath,reviewedSectionIds:全部段ID}。'
            'report.md给本轮理由与试听/技术缺口。result.json复制请求身份 projectId/runId/branchId/attemptId/inputFingerprint/dependencies，'
            '含status complete或blocked；manifestPath必须指向proposal.json，不能指向sound-cues.json；reportPath指向report.md；files列真实绝对path/sha256、proposedChanges、gaps、acceptance={applied:false,technical:"passed|not_run|failed",viewed:false,listened:真实布尔}。'
            '请求：'+req['requestPath'])
    command=codex_exec_command('--sandbox','workspace-write','--skip-git-repo-check','--ephemeral','--json','-c','sandbox_workspace_write.writable_roots=[]','-C',req['outputRoot'],prompt,binary=binary)
    pb.run_process(command,req,stop)
    return pb.load(Path(req['outputRoot'])/'result.json')


def run_sound_branch(sound_request_path,cancel_event,slot_root=None,runner=None):
    req=pb.load(sound_request_path)
    if req.get('status') in {'skipped','blocked'}:return req
    def verify():
        if pb.digest(req['appliedEventsPath'])!=req['appliedEventsSha256']:raise ValueError('applied events changed')
        for file in req['dependencies']:
            if not Path(file['path']).is_file() or pb.digest(file['path'])!=file['sha256']:raise ValueError('sound dependency changed: '+file['path'])
    verify()
    root=Path(req['outputRoot']);root.mkdir(parents=True,exist_ok=True)
    req['requestPath']=str(root/'request.json');pb.atomic_json(req['requestPath'],req)
    slot_root=slot_root or Path(tempfile.gettempdir())/f'codex-package-branch-slots-{os.getuid()}'
    with pb.global_slot(slot_root,cancel_event) as fd:
        verify();req['_slotFd']=fd
        result=(runner or _default_runner)(req,cancel_event)
    if cancel_event.is_set():raise pb.Cancelled('sound cancelled')
    verify();pb.validate_result(req,result)
    if result['status']=='complete':
        proposal=pb.load(result['manifestPath']);manifest=pb.load(proposal['soundManifestPath'])
        if proposal.get('reviewedSectionIds')!=[row['id'] for row in req['sections']]:raise ValueError('complete reviewed sound sections required')
        pb.verify_files(result['files'],req['outputRoot'])
        paths={r['path'] for r in result['files']}
        if proposal['soundManifestPath'] not in paths:raise ValueError('native sound manifest SHA required')
        if manifest.get('version')!=1 or manifest.get('projectId')!=req['projectId'] or not isinstance(manifest.get('cues'),list):raise ValueError('invalid native sound manifest')
        if not manifest['cues'] and (proposal.get('decision')!='leave_blank' or not proposal.get('reason','').strip()):raise ValueError('empty sound manifest requires reviewed leave_blank')
        cue_ids=set()
        for cue in manifest['cues']:
            if not cue.get('id') or cue['id'] in cue_ids:raise ValueError('unique native sound cue IDs required')
            cue_ids.add(cue['id'])
            if cue.get('file') not in paths:raise ValueError('actual sound media file/SHA required')
            if not isinstance(cue.get('startSeconds'),(int,float)) or cue['startSeconds']<0 or not isinstance(cue.get('durationSeconds'),(int,float)) or cue['durationSeconds']<=0:raise ValueError('actual sound timing required')
            if not isinstance(cue.get('timingEvidence'),str) or not cue['timingEvidence'].strip():raise ValueError('actual event timing evidence required')
        if manifest['cues'] and manifest.get('expectedRevision')!=req['currentDocument'].get('revision'):raise ValueError('sound manifest revision differs from applied events')
    pb.atomic_json(root/'result.json',result)
    return result
