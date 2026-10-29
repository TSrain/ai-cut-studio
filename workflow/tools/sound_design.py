"""Semantic sound spotting contract; real timing belongs to broll, never ASR here."""
import re

ROLES = {'hook', 'emphasis', 'turn', 'action', 'transition', 'texture'}

def validate_sound_design(document):
    if 'soundDesignVersion' not in document:
        if any('soundDesign' in s for s in document.get('shots', [])):
            raise ValueError('soundDesign 需要 soundDesignVersion: 1')
        return
    if type(document['soundDesignVersion']) is not int or document['soundDesignVersion'] != 1:
        raise ValueError('soundDesignVersion 必须为 1')
    ids = set()
    for shot in document['shots']:
        design = shot.get('soundDesign', {})
        if not isinstance(design, dict) or design.get('decision') not in {'silence','cues'}:
            raise ValueError('每镜声音设计必须明确 silence 或 cues')
        if not isinstance(design.get('reason'), str) or not design['reason'].strip():
            raise ValueError('声音设计缺少 reason')
        cues = design.get('cues')
        if not isinstance(cues, list) or bool(cues) != (design['decision'] == 'cues'):
            raise ValueError('silence 不含音效；cues 至少含一条')
        for cue in cues:
            if not isinstance(cue, dict):raise ValueError('音效必须为对象')
            cid = cue.get('id')
            if not isinstance(cid, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,60}', cid) or cid in ids:
                raise ValueError('音效 id 必须全片唯一且为安全标识符')
            ids.add(cid)
            for field in ('intent','anchor','event','texture'):
                if not isinstance(cue.get(field),str) or not cue[field].strip():raise ValueError('音效缺少 '+field)
            if cue.get('role') not in ROLES:raise ValueError('未知声音 role')
            if type(cue.get('priority')) is not int or cue['priority'] not in (1,2,3):raise ValueError('priority 必须为 1/2/3')
            if any(k in cue for k in ('startSeconds','startFrame','time','durationFrames')):
                raise ValueError('package 声音意图不写真实或估算秒点；broll 另存 resolved cues')
