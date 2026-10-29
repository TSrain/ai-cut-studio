#!/usr/bin/env python3
"""Persisted, isolated package proposal workers. Never writes an active project."""
from __future__ import annotations
import argparse
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
BRANCHES = ('templates', 'footage', 'aiVideo', 'camera', 'captions', 'cover')
def orchestration_version(request):
    """Resolve the default without mutating SHA-bound requests or snapshots."""
    version = request.get('packageOrchestrationVersion', 2)
    if type(version) is int and version == 1:
        raise ValueError('packageOrchestrationVersion=1 已下线（见 git tag v1-final），请新建 v2 package 任务')
    if type(version) is not int or version != 2:
        raise ValueError('unknown package orchestration version: ' + repr(version))
    return version


def branches_for(request):
    orchestration_version(request)
    version = request.get('bgmPlanVersion')
    if version is not None and (type(version) is not int or version != 1):
        raise ValueError('unknown BGM plan version')
    execution = request.get('bgmExecutionVersion')
    if execution is not None and (type(execution) is not int or execution != 1 or version != 1):
        raise ValueError('BGM execution requires version 1 and v2 orchestration with BGM plan')
    return (*BRANCHES, 'bgm') if version == 1 else BRANCHES


IDENTITY = ('projectId', 'runId', 'branchId', 'attemptId', 'inputFingerprint', 'dependencies')
INPUT_KEYS = ('projectSnapshotPath', 'projectPlanPath', 'finalScriptPath', 'sourceSrtPath', 'videoPath', 'audioPath')
INSTRUCTIONS = {
    'bgm': (
        '读取 docs/bgm-plan-contract.md 和 tools/bgm_package.py，完整执行合同中“加分任务→情境→音乐特征/变化→成本与理解代价”的方法，不得只做简单段配乐/复杂段静音二分。通读全文，判断持续观看连续感与适度刺激、过程/时间感、结构想象、故事推进与期待、转折/余味、主观氛围六类机会；不要求全部使用。先定预计收益，再选音乐，禁止用思考型/情绪型标签代替逻辑。区分低成本静态铺底与必须定向编排的过程/结构'
        '映射，不假称循环同一首歌即可得到后者。reason写本段情境和加分原因；texture写特征为何匹配、必要变化与编排成本；transition写衔接与收束：按内容关系、音乐乐句结构和注意力选择一个首选处理、具体收益及必要低成本备选。相邻同作用优先同曲延续，不因计划分段重起；自然收尾、乐句直切、尾音搭桥、提前铺入、同曲换层、停乐让人声接棒、反向尾音按合同选择，不默认2秒双淡化，明显效果少用。短段容不下自然乐句则留白；不得侵占确定留白或延长'
        '片尾。未试听不臆造BPM、调性、分轨或可剪音符；推荐reason写曲目匹配依据和入口/休止/结尾/分轨的已知信息与待听验项。这些判断必须进入proposal字段并在控制台可见，不仅放report。低收益/高理解负担可留白，不强行全铺、不机械情绪配器。跨国内外多类独立来源广泛搜索实际曲目、比较并保存来源，不以固定少数作者或三首旧歌为默认池，不能编造曲目/授权或据未试听内容声称精确适配，未试听标not_listened。是否下载以branc'
        'h-input.input.bgmExecutionVersion为准：标记1时必须读取docs/bgm-auto-execution.md，实际调用tools/bgm_acquire.py acquire下载排序首选、交execution与实际文件/SHA，失败依次尝试下一候选；未标记旧任务只规划。永不直接写工程或调用入轨API；冻结requirementVersion不变，位置用shot.timing.ranges；初次工程bgmP'
        'lan.shots为空时，按绑定SRT的sourceCueIds和source.clips确定性映射真实区间，使用canvas.fps转换帧，不按文字估时；宿主业务门会用同一build_plan映射再次核验。不要仅因初始shots为空就停止。不造秒点。proposal.json使用{schemaVersion:1,branchId:"bgm",items:[],reason,sections:[{id,requirementVersio'
        'n,bgmDesign:{decision:"music|silence",reason,purpose:"continuity|narrative|atmosphere",musicType,texture,transition,recommendationIds:[]}}],recommendations:[{id,title,artist,url,reason,licenseStatus:"unknown|verify_befor'
        'e_use|verified",licenseUrl?,audition:"not_listened|listened"}],recommendationGaps:[]}。music须含具体方向及推荐或搜索缺口；silence写具体理由且不引用曲目。'
    ),
    'templates': '读取 docs/visual-design-contract.md、docs/template-expression-review.md，并现读 visualization 的 MENU/preset 定义及说明。独立覆盖全文语义段，给具体原生 preset/props 与真实 SRT/source.clips 区间。只提出既有模板参数，不改组件、不定制定制动画。proposal.json 使用 {schemaVersion:1,branchId:"templates",items:[{shotId,requirementVersion,preset,props,startSeconds,durationSeconds,reason}],reason}；另存 templateReview 审计，记录能力定义路径及 SHA。不匹配写具体缺口。',
    'footage': '情境素材可以承担场景和节奏收益，不要求普通阅读或电脑操作画面证明产品实际能力；仅明确实际演示需求才要求产品实录。读取 docs/real-footage-contract.md 和 tools/footage_package.py 的 real-footage-v1 格式。独立逐段审完整口播，真实素材与模板并列；搜索、免费获取、probe/全帧解码/代表帧目检，原始短边至少720。完整候选与线索带口播原句、cue/段ID、理由、来源网页、下载及验收状态。proposal.json 使用 {schemaVersion:1,branchId:"footage",items:[],reason,footageAnalysisPath}，footageAnalysisPath 指向本目录原生 real-footage-v1 分析 JSON，复用其 sections/candidates 格式。提出推荐导入/placement，不调用 finalize/发布/入轨。不能将AI图当真实证据。',
    'aiVideo': '独立全文审查AI视频收益，包括视觉隐喻、情境、氛围与动作带来的创意价值；不能仅以真人已讲清、可用动画或无法证明产品能力否掉示意候选。宣传概念不机械套用产品实证要求。先提供有价值的可选简短brief，不逐秒规定动作；按必要性写可单独复制的简短提示词和有序实际参考文件。读取 tools/ai_video_package.py 校验格式。proposal.json 使用 {schemaVersion:1,branchId:"aiVideo",items:[],reason,sections:[{id,aiVideoCandidates:[]}]}。候选 id/title/prompt/promptVersion/requirementVersion/sourceCueIds/reason/aspectRatio/durationSeconds/references，evidenceRole固定illustration，references 为按上传顺序的 {path,label,purpose,sha256}。requirementVersion 必须沿用主控语义基线的最终版本，不换绑旧提示词。提示词就绪仅表示等待用户生成，不调用付费API、不生成视频、不伪造URL，不把情境画面作为真实事件证据。',
    'camera': '读取 docs/complete-package-contract.md，现读 visualization 的 source.cameraPlan 类型及应用工具。对全文镜头与留白设计，尊重保护记录、手调与 source.clips。proposal.json 使用 {schemaVersion:1,branchId:"camera",items:[],reason,cameraPlan:原生source.cameraPlan值,readSet:["/source/clips","/source/cameraPlan"],writeSet:["/source/cameraPlan"]}。仅输出字段提案和每个改变的理由；不写实际工程，不伪报工程回执。',
    'captions': '读取 docs/caption-quality-contract.md、tools/caption_quality.py 以及 visualization captions 原生类型。复用共享SRT和可信词级时间，逐cue做全文语义断句/强调审阅，保留原始SRT；不能按字数均分伪造时点，不重转写。缺词级时间时主动使用已绑定tools/roughcut_audio.py的本地forced alignment（不是ASR）：环境ROUGHCUT_ALIGN_PYTHON/ROUGHCUT_ALIGN_MODEL若存在，用--align-input/--align-out在本支目录执行，输入audio/cues/model，输出groups为真实声学对齐；所有临时文件仅在本支目录，保存源SHA、输入、输出与模型身份。禁止因未预先提供alignmentEvidence就直接停止，先检查并尝试可用本地对齐；不可用再记录具体失败。疑似错词仍须核听，不用强制对齐反证词语正确。proposal.json 使用 {schemaVersion:1,branchId:"captions",items:[],reason,captions:原生captions值,segmentationReviewPath:本目录审阅JSON绝对路径,readSet:["/captions"],writeSet:["/captions"]}。不在工程应用，缺对齐依据写gap。',
    'cover': 'coverContract.requirePerson=true时所有组必须含可辨识的本人，并与内容发生动作关系；使用已绑定coverReferences，抄录到本支references.json，不得以隔离上下文为由改成无人物。缺肖像必须blocked。读取 .devin/skills/content-cover/SKILL.md、docs/artifact-layout.md、tools/cover.py 格式，按其创作和核验合同制作本期封面及标题；本任务输出位置覆盖技能的归档位置，只写本支目录。默认三组3:4/4:3共六PNG，用户明确组数优先；真实图片生成不可用则 blocked，不用文字占位宣称完成。proposal.json 使用 {schemaVersion:1,branchId:"cover",items:[],reason,coverCandidateManifestPath:本目录schema2原生manifest绝对路径}。完整source.md/source.json/references.json与图片纳入files/SHA，技术验收和逐张目检分开。',
}


def load(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''): h.update(chunk)
    return h.hexdigest()


def json_digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def atomic_json(path, value):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        temp.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def file_record(path):
    path = Path(path).resolve()
    if not path.is_file(): raise ValueError('missing input/file: ' + str(path))
    return {'path': str(path), 'sha256': digest(path)}


def input_identity(request, semantic_path):
    paths = [request[k] for k in INPUT_KEYS if request.get(k)]
    paths += [str(Path(semantic_path).resolve())]
    for value in request.get('sourceRecords', []) + request.get('sources', []):
        if value.get('path'):
            if value.get('sha256') and digest(value['path']) != value['sha256']: raise ValueError('declared source SHA changed')
            paths.append(value['path'])
    files = [file_record(p) for p in dict.fromkeys(paths)]
    return {'requestSha256': json_digest(request), 'files': files}


def verify_files(records, root=None):
    if not isinstance(records, list) or not records: raise ValueError('files/SHA required')
    seen = set()
    for rec in records:
        path = Path(rec.get('path', ''))
        if not path.is_absolute() or not path.is_file(): raise ValueError('absolute existing file required')
        if root and not path.resolve().is_relative_to(Path(root).resolve()): raise ValueError('file outside branch outputRoot')
        if str(path.resolve()) in seen: raise ValueError('duplicate file record')
        seen.add(str(path.resolve()))
        if digest(path) != rec.get('sha256'): raise ValueError('file SHA changed: ' + str(path))
    return seen


def validate_result(req, value):
    for key in IDENTITY:
        if value.get(key) != req[key]: raise ValueError('branch identity mismatch: ' + key)
    if value.get('status') not in ('complete', 'blocked'): raise ValueError('result status must be complete or blocked')
    paths = verify_files(value.get('files'), req['outputRoot'])
    for key in ('manifestPath', 'reportPath'):
        if str(Path(value.get(key, '')).resolve()) not in paths: raise ValueError(key + ' must have files/SHA')
    proposal = load(value['manifestPath'])
    if proposal.get('schemaVersion') != 1 or proposal.get('branchId') != req['branchId'] or not isinstance(proposal.get('items'), list):
        raise ValueError('invalid branch proposal schema')
    if not isinstance(proposal.get('reason'), str) or not proposal['reason'].strip(): raise ValueError('proposal reason required')
    if not isinstance(value.get('proposedChanges'), list) or not isinstance(value.get('gaps'), list): raise ValueError('changes/gaps must be lists')
    acceptance = value.get('acceptance', {})
    if acceptance.get('applied') is not False: raise ValueError('branch must not claim project applied')
    if not all(k in acceptance for k in ('technical', 'viewed', 'listened')): raise ValueError('acceptance dimensions required')
    if value['status'] == 'blocked' and not value['gaps']: raise ValueError('blocked result requires gaps')
    if req['branchId'] == 'bgm' and value['status'] == 'complete':
        try: from .bgm_package import validate_proposal, semantic_for_request
        except ImportError: from bgm_package import validate_proposal, semantic_for_request
        validate_proposal(proposal, semantic_for_request(req))
    return value


class Cancelled(RuntimeError): pass


def run_process(command, request, cancel_event):
    """Run isolated process group; cancellation terminates descendants before returning."""
    root = Path(request['outputRoot']); root.mkdir(parents=True, exist_ok=True)
    if cancel_event.is_set(): raise Cancelled('parent cancelled')
    with (root/'worker.log').open('ab') as log:
        proc = subprocess.Popen(command, cwd=root, stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
                                pass_fds=((request['_slotFd'],) if '_slotFd' in request else ()))
        atomic_json(root/'process.json', {'pid': proc.pid, 'processGroup': proc.pid, 'startedAt': time.time()})
        try:
            while proc.poll() is None:
                if cancel_event.wait(.05): raise Cancelled('parent cancelled')
            if cancel_event.is_set(): raise Cancelled('parent cancelled')
            if proc.returncode: raise RuntimeError('worker exited ' + str(proc.returncode))
        finally:
            # Also stop descendants left behind after their immediate parent exited.
            with contextlib.suppress(ProcessLookupError): os.killpg(proc.pid, signal.SIGTERM)
            try: proc.wait(timeout=1)
            except subprocess.TimeoutExpired: pass
            with contextlib.suppress(ProcessLookupError): os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()


def worker_prompt(req):
    return ('你是独立package专项worker，只写outputRoot，不写活动工程，不再派专项，不运行Claude/ASR/付费API。'
            '只读本请求branchInputPath和其中绑定的专项输入、规则和实际文件，不加载父聊天或原整个工程。'
            'branch-input是宿主可信的职责投影：protection={}表示未发现受保护标记，未给cameraPlan/captions表示初始未设置，不要求用户补不存在的字段。'
            '依赖中的kind=json哈希计算前会把path/file/*Path文件定位符替换为<file>，不是原始input对象的直接哈希；文件字节身份另由kind=file绑定，不将两种哈希混比。'
            'templates必须对比实际canvas宽高比与preset.canvas支持列表，不能把竖屏专用模板提给横屏工程，也不能擅自改画布或模板组件；无匹配可全文复审后leave_blank。preset使用字符串ID，templateReview可内嵌或另存绑定SHA的templateReview.json。'
            '字幕保留原词且已有可信声学时点时，可以交付完整断句提案；未核听的疑似错词保留原文并列gaps/acceptance，不把提案complete声称为最终听审完成，也不据强制对齐改词。'
            +INSTRUCTIONS[req['branchId']]+'。无收益必须给完整reviewedSections和具体理由；仅当本专项为templates/footage/captions时，即使不改也交该专项原生完整审阅。不要要求其他专项的输入或回执，不因无法完成其他专项而将本专项标blocked。'
            '结果result.json复制请求projectId/runId/branchId/attemptId/inputFingerprint/dependencies；status complete或blocked；'
            'manifestPath为proposal.json，reportPath为report.md，全部真实交付文件列files[{path,sha256}]；不要列仍由执行器写入的worker.log/process.json/execution.json，也不要列result.json自身；proposedChanges/gaps数组；'
            'acceptance={applied:false,technical:"not_run",viewed:false,listened:false}，按真实验收修改。缺工具/输入写blocked不造占位。'
            '请求文件：'+req['requestPath'])


def default_runner(req, cancel_event):
    try:
        from .editor_plan_runtime import codex_binary, codex_exec_command
    except ImportError:
        from editor_plan_runtime import codex_binary, codex_exec_command
    # cwd is the only writable workspace. No --add-dir for repo/active project.
    command = codex_exec_command('--sandbox', 'workspace-write', '--skip-git-repo-check', '--ephemeral', '--json',
               '-c', 'sandbox_workspace_write.writable_roots=[]', binary=codex_binary())
    # These branches retrieve references/assets; filesystem scope remains the
    # isolated attempt directory. Network permission is not API purchase consent.
    if req['branchId'] in {'footage', 'aiVideo', 'cover', 'bgm'}:
        command += ['-c', 'sandbox_workspace_write.network_access=true']
    command += ['-C', req['outputRoot'], worker_prompt(req)]
    run_process(command, req, cancel_event)
    return load(Path(req['outputRoot'])/'result.json')


@contextlib.contextmanager
def global_slot(root, stop):
    root = Path(root); root.mkdir(parents=True, exist_ok=True)
    while not stop.is_set():
        for i in range(3):
            stream = (root/f'{i}.lock').open('a+')
            try: fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError: stream.close(); continue
            try: yield stream.fileno()
            finally: fcntl.flock(stream, fcntl.LOCK_UN); stream.close()
            return
        stop.wait(.05)
    raise Cancelled('parent cancelled while queued')


def validate_branch_run(request, path, allow_partial=False):
    orchestration_version(request)
    try:from .package_branches_v2 import validate_run
    except ImportError:from package_branches_v2 import validate_run
    return validate_run(request,path,allow_partial)


def run_branches(request_path, semantic_path, *, runner=None, max_workers=3, retry_failed=False, cancel_event=None, slot_root=None):
    orchestration_version(load(request_path))
    try:from .package_branches_v2 import run
    except ImportError:from package_branches_v2 import run
    return run(request_path,semantic_path,runner=runner,max_workers=max_workers,retry_failed=retry_failed,cancel_event=cancel_event,slot_root=slot_root)


def main():
    parser = argparse.ArgumentParser(description=__doc__); sub = parser.add_subparsers(dest='command', required=True)
    run = sub.add_parser('run'); run.add_argument('--request', required=True); run.add_argument('--semantic', required=True)
    run.add_argument('--retry-failed', action='store_true'); run.add_argument('--max-workers', type=int, default=3)
    args = parser.parse_args()
    state = run_branches(args.request, args.semantic, retry_failed=args.retry_failed, max_workers=args.max_workers)
    print(json.dumps(state, ensure_ascii=False)); return 0 if state['status']=='complete' else 2


if __name__ == '__main__': raise SystemExit(main())
