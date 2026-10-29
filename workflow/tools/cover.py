#!/usr/bin/env python3
"""Local cover source snapshots and deterministic candidate checks; never publishes."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import unicodedata
import uuid

ROOT = Path(__file__).resolve().parents[1]
CONFIG = json.loads((ROOT / '.devin/cover.json').read_text(encoding='utf-8'))
if (ROOT / '.devin/cover.local.json').is_file():
    CONFIG.update(json.loads((ROOT / '.devin/cover.local.json').read_text(encoding='utf-8')))


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def component(value):
    if not isinstance(value, str) or not value or value in ('.', '..') or '/' in value or '\\' in value or any(ord(c) < 32 for c in value):
        raise ValueError('slug/run-id must be a single safe path component')
    return value


def bind_package_cover(data):
    """Freeze authorized identity inputs in the parent before branch isolation."""
    if data.get('scope', {}).get('cover') is False:
        return
    data['coverContract'] = {'requirePerson': False, **data.get('coverContract', {})}
    if 'coverReferences' not in data:
        directory = Path(CONFIG['portrait_directory']).expanduser().resolve()
        data['coverReferences'] = [
            {'path': str(path.resolve()), 'sha256': sha256(path)}
            for path in sorted(directory.rglob('*'))
            if path.is_file() and path.suffix.lower() in CONFIG['portrait_extensions']
        ] if CONFIG['portrait_directory'] and directory.is_dir() else []


def validate_person_contract(manifest, contract, references):
    if not contract.get('requirePerson'):
        return
    approved = {str(Path(row['path']).resolve()) for row in references}
    groups = manifest.get('groups', [])
    if not approved or not groups:
        raise ValueError('本人封面缺少绑定肖像或完整候选')
    for group in groups:
        refs = group.get('references', [])
        if group.get('subject_mode') != 'person' or not refs or any(str(Path(p).resolve()) not in approved for p in refs):
            raise ValueError('本人封面必须使用绑定肖像，不得改为无人物概念组')


def prepare(source, slug, groups=3, run_id=None, *, output_root=None, portrait_dir=None, source_id=None):
    component(slug)
    component(run_id or 'auto')
    if type(groups) is not int or groups not in (3, 4, 5):
        raise ValueError('groups must be 3, 4 or 5')
    source = Path(source).resolve(strict=True)
    payload = source.read_bytes()
    run_id = run_id or datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ-') + uuid.uuid4().hex[:8]
    output_root = Path(output_root or ROOT / 'workspace/covers').resolve()
    run = output_root / slug / run_id
    if not run.resolve().is_relative_to(output_root):
        raise ValueError('run path resolves outside output root')
    run.mkdir(parents=True, exist_ok=False)
    (run / 'source.md').write_bytes(payload)
    write_json(run / 'source.json', {'schema_version': 1, 'original_path': str(source), 'sha256': hashlib.sha256(payload).hexdigest(), 'snapshot': 'source.md', 'source_type': 'script' if source_id else 'file', 'source_id': source_id, 'expected_groups': groups})
    directory = Path(portrait_dir or CONFIG['portrait_directory']).expanduser().resolve()
    refs, warnings = [], []
    if (portrait_dir or CONFIG['portrait_directory']) and directory.is_dir():
        for path in sorted(directory.rglob('*')):
            if path.is_file() and path.suffix.lower() in CONFIG['portrait_extensions']:
                try:
                    refs.append({'path': str(path.resolve()), 'sha256': sha256(path)})
                except OSError as exc:
                    warnings.append(f'Cannot read portrait {path}: {exc}')
    if not refs:
        warnings.append(f'No usable-format portrait files found in {directory}; concept work can continue.')
    write_json(run / 'references.json', {'directory': str(directory), 'references': refs, 'warnings': warnings})
    for warning in warnings:
        print(warning, file=sys.stderr)
    return run


def probe_png(path):
    result = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height', '-of', 'json', str(path)], capture_output=True, text=True, timeout=30, check=True)
    streams = json.loads(result.stdout).get('streams', [])
    if len(streams) != 1 or streams[0].get('codec_name') != 'png':
        raise ValueError('file is not a PNG image')
    subprocess.run(['ffmpeg', '-v', 'error', '-xerror', '-i', str(path), '-frames:v', '1', '-f', 'null', '-'], capture_output=True, text=True, timeout=30, check=True)
    return streams[0]['width'], streams[0]['height']


def validate(manifest_path, *, write_report=True):
    manifest_path = Path(manifest_path).resolve(strict=True)
    run = manifest_path.parent
    errors, warnings, images = [], [], []
    report = {'machine_passed': False, 'agent_visual_attestation_passed': False, 'agent_semantic_attestation_passed': False, 'candidate_ready': False, 'user_approved': False, 'errors': errors, 'warnings': warnings, 'images': images}
    data = json.loads(manifest_path.read_text(encoding='utf-8'))
    if not isinstance(data, dict):
        data = {}
        errors.append('manifest must be an object')
    if type(data.get('schema_version')) is not int or data['schema_version'] != 2:
        errors.append('unsupported schema_version; expected 2')
    if data.get('status') != 'awaiting_selection':
        errors.append('status must be awaiting_selection; validation cannot grant approval')
    source_meta, source_text, inventory = {}, '', {}
    try:
        metadata_path = run / 'source.json'
        snapshot_path = run / 'source.md'
        if metadata_path.is_symlink() or snapshot_path.is_symlink():
            raise ValueError('source files must be local snapshots, not symlinks')
        source_meta = json.loads(metadata_path.read_text(encoding='utf-8'))
        if not isinstance(source_meta, dict) or source_meta.get('snapshot') != 'source.md':
            raise ValueError('invalid source metadata or snapshot name')
        if sha256(snapshot_path) != source_meta.get('sha256'):
            raise ValueError('source.md SHA256 does not match prepared source')
        source_text = snapshot_path.read_text(encoding='utf-8')
    except (OSError, ValueError) as exc:
        errors.append(f'source contract: {exc}')
        source_meta = {}
    try:
        references_path = run / 'references.json'
        if references_path.is_symlink():
            raise ValueError('reference inventory must be local, not a symlink')
        reference_meta = json.loads(references_path.read_text(encoding='utf-8'))
        entries = reference_meta.get('references') if isinstance(reference_meta, dict) else None
        if not isinstance(entries, list):
            raise ValueError('invalid reference inventory')
        for entry in entries:
            if not isinstance(entry, dict) or not isinstance(entry.get('path'), str) or not Path(entry['path']).is_absolute() or not isinstance(entry.get('sha256'), str):
                raise ValueError('invalid reference inventory entry')
            inventory[str(Path(entry['path']).resolve())] = entry['sha256']
    except (OSError, ValueError) as exc:
        errors.append(f'reference contract: {exc}')
    brief = data.get('content_brief')
    if not isinstance(brief, dict):
        errors.append('content_brief must be an object')
        brief = {}
    for field in ('content_type', 'audience', 'use_case', 'viewer_outcome', 'primary_promise'):
        if not isinstance(brief.get(field), str) or not brief[field].strip():
            errors.append(f'content_brief.{field} must be a nonempty string')
    evidence = brief.get('source_evidence')
    if not isinstance(evidence, list) or not evidence:
        errors.append('content_brief.source_evidence must be a nonempty list')
    else:
        for excerpt in evidence:
            if not isinstance(excerpt, str) or not excerpt.strip() or excerpt not in source_text:
                errors.append('content_brief.source_evidence must contain exact nonempty source.md substrings')
    count = data.get('expected_groups')
    prepared_count = source_meta.get('expected_groups')
    if type(prepared_count) is not int or prepared_count not in (3, 4, 5) or count != prepared_count:
        errors.append('expected_groups must match prepared source.json contract')
    if type(count) is not int or count not in (3, 4, 5):
        errors.append('expected_groups must be 3, 4 or 5')
    groups = data.get('groups')
    if not isinstance(groups, list):
        groups = []
    if len(groups) != count:
        errors.append('groups must contain expected_groups complete groups')
    seen_ids, seen_paths, attestations, semantic_attestations = set(), set(), [], []
    for index, group in enumerate(groups):
        label = f'group[{index}]'
        if not isinstance(group, dict):
            errors.append(f'{label}: must be an object')
            attestations.append(False)
            semantic_attestations.append(False)
            continue
        gid = group.get('id')
        if not isinstance(gid, str) or not gid.strip() or gid in seen_ids:
            errors.append(f'{label}: id missing or duplicated')
        else:
            seen_ids.add(gid)
            label = gid
        title = group.get('title')
        length = sum(not c.isspace() and unicodedata.category(c) not in ('Cf', 'Mn', 'Me') for c in title) if isinstance(title, str) else 0
        if not length or length > CONFIG['max_title_length']:
            errors.append(f'{label}: title must contain 1–15 visible characters')
        elif length > CONFIG['preferred_title_length']:
            warnings.append(f'{label}: title has {length} visible characters; preferably at most 10')
        mode, refs = group.get('subject_mode'), group.get('references')
        if mode not in ('person', 'concept') or not isinstance(refs, list):
            errors.append(f'{label}: invalid subject_mode or references')
        elif mode == 'concept' and refs:
            errors.append(f'{label}: concept references must be empty')
        elif mode == 'person':
            if not refs:
                errors.append(f'{label}: person requires references')
            for ref in refs:
                if not isinstance(ref, str) or not Path(ref).is_absolute() or not Path(ref).is_file():
                    errors.append(f'{label}: reference must be an existing absolute file path')
                    continue
                canonical_ref = str(Path(ref).resolve())
                if canonical_ref not in inventory:
                    errors.append(f'{label}: reference is outside prepared inventory')
                    continue
                try:
                    if sha256(Path(ref)) != inventory[canonical_ref]:
                        errors.append(f'{label}: reference SHA256 changed since preparation')
                except OSError as exc:
                    errors.append(f'{label}: cannot read reference: {exc}')
        text_mode, cover_text = group.get('text_mode'), group.get('cover_text')
        if text_mode not in ('none', 'short', 'display') or not isinstance(cover_text, str):
            errors.append(f'{label}: invalid text_mode or cover_text')
        elif text_mode == 'none' and cover_text != '':
            errors.append(f'{label}: none text_mode requires empty cover_text')
        elif text_mode != 'none' and not cover_text.strip():
            errors.append(f'{label}: text cover requires cover_text')
        for field in ('source_excerpt', 'hook'):
            if not isinstance(group.get(field), str) or not group[field].strip():
                errors.append(f'{label}: {field} is required')
        excerpt = group.get('source_excerpt')
        if isinstance(excerpt, str) and excerpt.strip() and excerpt not in source_text:
            errors.append(f'{label}: source_excerpt is not present in source.md')
        review = group.get('visual_review', {})
        attested = isinstance(review, dict) and review.get('passed') is True and isinstance(review.get('notes'), str) and bool(review['notes'].strip())
        attestations.append(attested)
        if not attested:
            warnings.append(f'{label}: agent visual review has not been attested with notes')
        semantic = group.get('semantic_review', {})
        if not isinstance(semantic, dict):
            errors.append(f'{label}: semantic_review must be an object')
            semantic = {}
        if 'passed' in semantic and type(semantic['passed']) is not bool:
            errors.append(f'{label}: semantic_review.passed must be a boolean')
        semantic_fields = ('cover_readback', 'title_cover_readback', 'notes')
        for field in semantic_fields:
            if field in semantic and not isinstance(semantic[field], str):
                errors.append(f'{label}: semantic_review.{field} must be a string')
        semantic_attested = semantic.get('passed') is True and all(isinstance(semantic.get(field), str) and semantic[field].strip() for field in semantic_fields)
        semantic_attestations.append(bool(semantic_attested))
        if not semantic_attested:
            warnings.append(f'{label}: agent semantic review has not passed with complete readbacks and notes')
        assets = group.get('images', {})
        if not isinstance(assets, dict) or set(assets) != {'3:4', '4:3'}:
            errors.append(f'{label}: images must provide exactly 3:4 and 4:3')
        if not isinstance(assets, dict):
            continue
        for ratio in ('3:4', '4:3'):
            relative = assets.get(ratio)
            if not isinstance(relative, str) or not relative:
                errors.append(f'{label} {ratio}: missing image path')
                continue
            path = (run / relative).resolve()
            if Path(relative).is_absolute() or not path.is_relative_to(run):
                errors.append(f'{label} {ratio}: asset resolves outside run or uses absolute path')
                continue
            if path in seen_paths:
                errors.append(f'{label} {ratio}: reused image path')
                continue
            seen_paths.add(path)
            if path.suffix.lower() != '.png':
                errors.append(f'{label} {ratio}: PNG extension required')
                continue
            try:
                width, height = probe_png(path)
                images.append({'group': gid, 'ratio': ratio, 'path': str(path), 'width': width, 'height': height, 'decoded': True})
                a, b = map(int, ratio.split(':'))
                if width * b != height * a:
                    errors.append(f'{label} {ratio}: ratio mismatch ({width}x{height})')
                if min(width, height) < CONFIG['min_short_side']:
                    errors.append(f'{label} {ratio}: short side must be at least 1080')
            except (OSError, ValueError, KeyError, subprocess.SubprocessError) as exc:
                errors.append(f'{label} {ratio}: unreadable PNG: {exc}')
    report['machine_passed'] = not errors
    report['agent_visual_attestation_passed'] = bool(attestations) and all(attestations)
    report['agent_semantic_attestation_passed'] = bool(semantic_attestations) and all(semantic_attestations)
    report['candidate_ready'] = report['machine_passed'] and report['agent_visual_attestation_passed'] and report['agent_semantic_attestation_passed']
    warnings.append('Visual review is an agent attestation, not machine proof of aesthetics, fidelity or absence of upscaling; user selection remains pending.')
    warnings.append('Semantic review records an agent judgment, not machine proof that the cover communicates the main promise; exact source evidence alone does not establish relevance.')
    output = run / 'validation.json'
    if output.is_symlink() or output.resolve() == manifest_path:
        raise ValueError('refusing unsafe validation report output')
    if write_report:
        write_json(output, report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    prep = commands.add_parser('prepare')
    source = prep.add_mutually_exclusive_group(required=True)
    source.add_argument('--file', type=Path)
    source.add_argument('--id')
    prep.add_argument('--slug', required=True)
    prep.add_argument('--groups', type=int, choices=(3, 4, 5), default=CONFIG['default_groups'])
    prep.add_argument('--run-id')
    check = commands.add_parser('validate')
    check.add_argument('--manifest', required=True, type=Path)
    args = parser.parse_args()
    try:
        if args.command == 'validate':
            result = validate(args.manifest)
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 0 if result['machine_passed'] else 1
        source_path = args.file
        if args.id:
            if not re.fullmatch(r'SC-\d+', args.id):
                raise ValueError('id must match SC-XXXX')
            fetched = subprocess.run([sys.executable, str(ROOT / 'tools/package_io.py'), 'fetch', '--id', args.id], cwd=ROOT, capture_output=True, text=True, check=True)
            print(fetched.stdout, file=sys.stderr, end='')
            print(fetched.stderr, file=sys.stderr, end='')
            source_path = ROOT / 'workspace/package' / f'{args.id}-final.md'
        print(prepare(source_path, args.slug, args.groups, args.run_id, source_id=args.id))
        return 0
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        print(f'cover: {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
