"""Structural checks for authored shot design, never an aesthetic score."""


def _text(value, path):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f'{path} 必须是非空文字')


def _object(value, path):
    if not isinstance(value, dict):
        raise ValueError(f'{path} 必须是对象')
    return value


def _strings(value, path, required=False):
    if not isinstance(value, list) or (required and not value):
        raise ValueError(f'{path} 必须是{"非空" if required else ""}文字数组')
    for item in value:
        _text(item, path)


def _speech(value):
    return ''.join(c for c in value if c.isalnum())


def validate_design_intents(document, requires_motion, preset_ids=None):
    """Old documents remain readable; v1 designs must be complete and bound to speech.

    ``preset_ids`` is supplied by the dispatcher from the live downstream catalog.
    Local design validation can run before that repository is available.
    """
    shots = document['shots']
    if 'designIntentVersion' not in document and not any('designIntent' in s for s in shots):
        return
    if type(document.get('designIntentVersion')) is not int or document['designIntentVersion'] != 1:
        raise ValueError('designIntentVersion 必须为整数 1')
    for shot in shots:
        if not requires_motion(shot) and 'designIntent' not in shot:
            continue
        prefix = f"镜号 {shot.get('镜号', shot.get('id'))}.designIntent"
        intent = _object(shot.get('designIntent'), prefix)
        for key in ('goal', 'concept', 'focus', 'presenterRelation'):
            _text(intent.get(key), f'{prefix}.{key}')
        states = _object(intent.get('states'), f'{prefix}.states')
        for key in ('start', 'change', 'end'):
            _text(states.get(key), f'{prefix}.states.{key}')
        beats = intent.get('beats')
        if not isinstance(beats, list) or not beats:
            raise ValueError(f'{prefix}.beats 必须是非空数组')
        spoken = _speech(shot.get('锚点口播', shot.get('anchor', '')))
        cursor, ids = 0, set()
        for index, beat in enumerate(beats):
            path = f'{prefix}.beats[{index}]'
            _object(beat, path)
            for key in ('id', 'anchor', 'action'):
                _text(beat.get(key), f'{path}.{key}')
            if beat['id'] in ids:
                raise ValueError(f'{path}.id 重复')
            ids.add(beat['id'])
            anchor = _speech(beat['anchor'])
            start = spoken.find(anchor, cursor) if anchor else -1
            if start < 0:
                raise ValueError(f'{path}.anchor 必须按顺序来自锚点口播')
            cursor = start + len(anchor)
        options = intent.get('templateOptions')
        if not isinstance(options, list):
            raise ValueError(f'{prefix}.templateOptions 必须是数组，无合适候选写 []')
        candidates = []
        for index, option in enumerate(options):
            path = f'{prefix}.templateOptions[{index}]'
            _object(option, path)
            _text(option.get('presetId'), f'{path}.presetId')
            _text(option.get('fit'), f'{path}.fit')
            _strings(option.get('gaps'), f'{path}.gaps')
            candidate = option['presetId']
            if candidate in candidates:
                raise ValueError(f'{path}.presetId 重复')
            if preset_ids is not None and candidate not in preset_ids:
                raise ValueError(f'{path}.presetId 不在当前模板目录: {candidate}')
            candidates.append(candidate)
        if shot.get('presetCandidates') != candidates:
            raise ValueError(f'{prefix} 与 presetCandidates 的顺序及内容必须一致')
        custom = _object(intent.get('customOption'), f'{prefix}.customOption')
        for key in ('approach', 'benefit', 'cost'):
            _text(custom.get(key), f'{prefix}.customOption.{key}')
        recommendation = _object(intent.get('recommendation'), f'{prefix}.recommendation')
        _text(recommendation.get('reason'), f'{prefix}.recommendation.reason')
        route = recommendation.get('route')
        if route not in ('preset', 'component-custom', 'custom'):
            raise ValueError(f'{prefix}.recommendation.route 无效')
        selected = shot.get('selectedPreset')
        if route == 'preset':
            if selected not in candidates:
                raise ValueError(f'{prefix} preset 路线必须选择一个候选 selectedPreset')
            option = options[candidates.index(selected)]
            if option['gaps']:
                raise ValueError(f'{prefix} 选中的模板仍有 gaps，不能当作完整匹配')
        elif 'selectedPreset' not in shot or selected is not None:
            raise ValueError(f'{prefix} 定制路线 selectedPreset 必须为 null')
        _strings(intent.get('acceptance'), f'{prefix}.acceptance', required=True)
        _strings(intent.get('risks'), f'{prefix}.risks')
