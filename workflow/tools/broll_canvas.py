#!/usr/bin/env python3
"""Derive B-roll canvas from the explicitly selected master video, never audio.

probe --video MASTER prints source/display metadata and square-pixel even dimensions.
check --video MASTER --contract CONTRACT [--files OUTPUT ...] checks every shot.
An explicitly requested delivery ratio takes precedence via --aspect-ratio 16:9;
this option never guesses which of several videos is the master. Rotation and SAR
are applied before comparison. Ratio tolerance is 0.2% for even-pixel rounding.
This checks geometry, not composition: stretching/pillarboxing requires visual QA.
"""
import argparse
from fractions import Fraction
import json
import math
from pathlib import Path
import subprocess
import sys


def _ratio(value):
    result = Fraction(str(value).replace(':', '/'))
    if result <= 0:
        raise ValueError('aspect ratio must be positive')
    return result


def _even(value):
    return max(2, int(math.floor(float(value) / 2 + 0.5)) * 2)


def canvas_from_probe(data, source):
    streams = [s for s in data.get('streams', []) if s.get('codec_type') == 'video'
               and not s.get('disposition', {}).get('attached_pic')]
    if not streams:
        raise ValueError('No real video stream; audio/cover art cannot determine canvas')
    stream = streams[0]
    width, height = int(stream.get('width', 0)), int(stream.get('height', 0))
    if width <= 0 or height <= 0:
        raise ValueError('Video has invalid pixel dimensions')
    sar_text = stream.get('sample_aspect_ratio', '1:1')
    sar = Fraction(1) if sar_text in (None, '', 'N/A', '0:1') else _ratio(sar_text)
    rotation = stream.get('tags', {}).get('rotate', 0)
    for side in stream.get('side_data_list', []):
        if 'rotation' in side:
            rotation = side['rotation']
            break
    rotation = float(rotation)
    if not math.isfinite(rotation) or abs(rotation / 90 - round(rotation / 90)) > 0.0001:
        raise ValueError('Non-right-angle rotation requires an explicit normalized master video')
    rotation = int(round(rotation)) % 360
    display_width, display_height = width * sar, Fraction(height)
    if rotation in (90, 270):
        display_width, display_height = display_height, display_width
    ratio = display_width / display_height
    return {'source': str(source), 'codedWidth': width, 'codedHeight': height,
            'sampleAspectRatio': f'{sar.numerator}:{sar.denominator}', 'rotation': rotation,
            'displayWidth': float(display_width), 'displayHeight': float(display_height),
            'aspectRatio': f'{ratio.numerator}:{ratio.denominator}',
            'width': _even(display_width), 'height': _even(display_height)}


def probe_video(path):
    source = Path(path).expanduser().resolve()
    if not source.is_file():
        raise ValueError(f'Master/output video not found: {source}')
    completed = subprocess.run(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json',
                                str(source)], capture_output=True, text=True, timeout=60)
    if completed.returncode:
        raise ValueError(f'ffprobe failed for {source}: {completed.stderr.strip()}')
    return canvas_from_probe(json.loads(completed.stdout), source)


def apply_aspect_override(canvas, requested):
    ratio = _ratio(requested)
    result = dict(canvas)
    result['sourceAspectRatio'] = canvas['aspectRatio']
    result['aspectRatio'] = f'{ratio.numerator}:{ratio.denominator}'
    result['aspectRatioAuthority'] = 'explicit-user-override'
    result['width'] = _even(result['height'] * ratio)
    return result


def _matches(width, height, expected):
    return abs(float(Fraction(width, height) / expected) - 1) <= 0.002


def check_contract(contract, canvas):
    expected = _ratio(canvas['aspectRatio'])
    errors = []

    def check_dimensions(label, output):
        if not isinstance(output, dict):
            errors.append(f'{label}: explicit width/height required')
            return
        width, height = output.get('width'), output.get('height')
        if any(type(v) is not int or v <= 0 for v in (width, height)):
            errors.append(f'{label}: positive integer width/height required')
        elif not _matches(width, height, expected):
            errors.append(f'{label}: {width}x{height} conflicts with {canvas["aspectRatio"]}')

    check_dimensions('canvas', contract.get('canvas'))
    shots = contract.get('shots')
    if not isinstance(shots, list) or not shots:
        errors.append('shots: non-empty list required')
    else:
        for index, shot in enumerate(shots):
            if not isinstance(shot, dict):
                errors.append(f'shots[{index}]: object required')
                continue
            check_dimensions(f'shot {shot.get("id", index)} ({shot.get("presentationMode", "unspecified")})',
                             shot.get('output'))
    return errors


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    for name in ('probe', 'check'):
        command = commands.add_parser(name)
        command.add_argument('--video', required=True, help='Explicit master video, never audio')
        command.add_argument('--aspect-ratio', help='Explicit user-requested delivery ratio, e.g. 16:9')
        if name == 'check':
            command.add_argument('--contract', required=True)
            command.add_argument('--files', nargs='+', default=[])
    args = parser.parse_args(argv)
    try:
        canvas = probe_video(args.video)
        if args.aspect_ratio:
            canvas = apply_aspect_override(canvas, args.aspect_ratio)
        if args.command == 'probe':
            print(json.dumps(canvas, ensure_ascii=False, indent=2))
            return 0
        contract = json.loads(Path(args.contract).read_text(encoding='utf-8'))
        if not isinstance(contract, dict):
            raise ValueError('Contract must be an object')
        errors = check_contract(contract, canvas)
        files = []
        for path in args.files:
            try:
                info = probe_video(path)
                files.append(info)
                if abs(float(_ratio(info['aspectRatio']) / _ratio(canvas['aspectRatio'])) - 1) > 0.002:
                    errors.append(f'file {path}: {info["aspectRatio"]} conflicts with {canvas["aspectRatio"]}')
            except (ValueError, OSError, subprocess.TimeoutExpired) as exc:
                errors.append(f'file {path}: {exc}')
        print(json.dumps({'passed': not errors, 'canvas': canvas, 'errors': errors,
                          'files': files}, ensure_ascii=False, indent=2))
        return int(bool(errors))
    except (ValueError, OSError, subprocess.TimeoutExpired, ZeroDivisionError) as exc:
        print(json.dumps({'passed': False, 'error': str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
