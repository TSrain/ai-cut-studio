#!/usr/bin/env python3
"""Prepare a reviewed B-roll manifest, retain alternatives, and compose editable shots.

Codex supplies semantic choices and authored prompts. This command validates them,
acquires explicitly specified assets, measures files, and invokes Visualization.
"""
import argparse
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import re
import socket
import subprocess
import time
import urllib.parse
import urllib.request

VISUALIZATION = Path(os.environ.get('VISUALIZATION_ROOT', Path(__file__).resolve().parents[2] / 'studio')).resolve()
MEDIA_ASSETS = {'media-stack', 'media-split', 'source-pip'}

def number(value, label, low=0, high=1e9):
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f'{label} 无效')
    return value

def text(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f'{label} 不能为空')
    return value

def safe_id(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,80}', value):
        raise ValueError('ID 必须使用字母、数字、横线或下划线')
    return value

def media_items(option):
    props = option.get('props', {})
    if option.get('assetId') == 'source-pip':
        return [props] if props.get('sourceMode') == 'media' else []
    return props.get('items', [])

def validate_manifest(data, require_approved=False):
    if data.get('version') != 1: raise ValueError('需要 version=1')
    safe_id(data.get('id')); text(data.get('name'), '作品名')
    if require_approved and data.get('approval', {}).get('status') != 'approved':
        raise ValueError('本期分镜尚未批准')
    c = data.get('canvas', {})
    for key in ('width', 'height', 'durationFrames'):
        v = number(c.get(key), key, 1)
        if int(v) != v: raise ValueError(f'{key} 必须为整数')
    if c['width'] % 2 or c['height'] % 2: raise ValueError('画幅必须为偶数')
    fps = c.get('fps', {})
    for k in ('num', 'den'):
        v=number(fps.get(k), 'fps.'+k, 1)
        if int(v)!=v:raise ValueError('fps 必须为整数比')
    duration = c['durationFrames'] * fps['den'] / fps['num']
    shots = data.get('shots')
    if not isinstance(shots, list) or not shots: raise ValueError('shots 不能为空')
    seen=set(); spans=[]
    for shot in shots:
        sid=safe_id(shot.get('id'))
        if sid in seen: raise ValueError('镜号重复')
        seen.add(sid)
        start=number(shot.get('startSeconds'),sid+'开始',0,duration)
        end=number(shot.get('endSeconds'),sid+'结束',0,duration)
        if end<=start:raise ValueError('镜头时长必须为正')
        spans.append((start,end))
        text(shot.get('text'), '口播');text(shot.get('reason'),'推荐理由')
        options=shot.get('options')
        if not isinstance(options,list) or not options:raise ValueError('缺少候选方案')
        ids=set()
        for option in options:
            oid=safe_id(option.get('id'))
            if oid in ids:raise ValueError('方案 ID 重复')
            ids.add(oid)
            route=option.get('route');asset=option.get('assetId')
            if route not in ('animation','media'):raise ValueError('route 必须为 animation 或 media')
            safe_id(asset);text(option.get('description'),'方案画面说明')
            if not isinstance(option.get('props'),dict):raise ValueError('需要可编辑 props')
            if option.get('status') not in ('planned','pending','ready','rendered'):raise ValueError('方案状态无效')
            if route=='media' and asset not in MEDIA_ASSETS:raise ValueError('素材需使用支持的素材呈现模板')
            if route=='animation' and asset in MEDIA_ASSETS:raise ValueError('素材模板应归素材路线')
            if route=='media':
                items=media_items(option)
                if not items:raise ValueError('素材方案缺少素材槽')
                item_ids=set()
                for item in items:
                    iid=safe_id(item.get('id','source'))
                    if iid in item_ids:raise ValueError('素材 ID 重复')
                    item_ids.add(iid)
                    origin=item.get('origin')
                    if origin not in ('network','ai','user'):raise ValueError('素材来源必须为 network/ai/user')
                    media=item.get('media')
                    if media is not None:
                        if not isinstance(media,dict) or media.get('kind') not in ('image','video'):raise ValueError('素材类型无效')
                        if not media.get('path') and not media.get('publicPath'):raise ValueError('就绪素材需要文件路径')
                    if origin=='ai':
                        if item.get('role')=='evidence':raise ValueError('AI 视频不能替代真实事件证据')
                        gen=item.get('generation',{})
                        for key in ('brief','prompt','aspectRatio'):text(gen.get(key),'生成 '+key)
                        number(gen.get('durationSeconds'),'生成时长',.1,300)
                    if origin=='network':text(item.get('sourceUrl'),'来源页面')
                    if option['status'] in ('ready','rendered') and not media:
                        raise ValueError('缺素材的方案不能标为已就绪')
        if shot.get('recommended') not in ids:raise ValueError('推荐方案不存在')
    spans.sort()
    if any(b[0]<a[1]-1e-6 for a,b in zip(spans,spans[1:])):raise ValueError('推荐镜头不能重叠；组内多素材使用同一镜号')
    return data

def quality_metadata(meta, kind):
    stream=next((s for s in meta.get('streams',[]) if s.get('codec_type')=='video' and not s.get('disposition',{}).get('attached_pic')),None)
    if not stream:raise ValueError('文件没有可用图像轨')
    w=int(stream.get('width',0));h=int(stream.get('height',0))
    if min(w,h)<720:raise ValueError(f'原始素材 {w}x{h} 低于短边 720px')
    sar=str(stream.get('sample_aspect_ratio','1:1')).split(':')
    try: ratio=float(sar[0])/float(sar[1])
    except (ValueError,ZeroDivisionError,IndexError):ratio=1
    width=round(w*ratio) if ratio>0 else w; height=h
    rotation=float(next((s['rotation'] for s in stream.get('side_data_list',[]) if 'rotation' in s),stream.get('tags',{}).get('rotate',0)))
    if round(rotation/90)%2:width,height=height,width
    result={'width':width,'height':height,'encodedWidth':w,'encodedHeight':h,'quality':'verified'}
    if kind=='video':result['durationSeconds']=number(float(stream.get('duration') or meta.get('format',{}).get('duration') or 0),'素材时长',.001)
    return result

def probe(path, kind):
    p=Path(path).resolve(strict=True)
    raw=subprocess.run(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(p)],capture_output=True,text=True,check=True,timeout=30)
    result=quality_metadata(json.loads(raw.stdout),kind)
    result['sha256']=hashlib.sha256(p.read_bytes()).hexdigest()
    return result

def resolve_media_path(media, base, visualization):
    if media.get('path'):
        p=Path(media['path']);return (p if p.is_absolute() else base/p).resolve(strict=True)
    root=(visualization/'templates/remotion-base/public').resolve()
    p=(root/text(media.get('publicPath'),'publicPath')).resolve(strict=True)
    if not p.is_relative_to(root):raise ValueError('publicPath 超出素材目录')
    return p

def download(url, dest):
    parsed=urllib.parse.urlparse(url)
    if parsed.scheme not in ('http','https') or not parsed.netloc:raise ValueError('下载必须为 HTTP(S) 素材直链')
    tmp=dest.with_suffix(dest.suffix+'.part')
    try:
        req=urllib.request.Request(url,headers={'User-Agent':'BrollComposition/1.0'})
        with urllib.request.urlopen(req,timeout=30) as response,tmp.open('wb') as out:
            total=0
            while chunk:=response.read(1024*1024):
                total+=len(chunk)
                if total>1024*1024*1024:raise ValueError('素材超过 1 GB，请单独下载')
                out.write(chunk)
        tmp.replace(dest)
    finally:
        tmp.unlink(missing_ok=True)

def prepare(data, base, outdir, visualization=VISUALIZATION, collect=False):
    result=copy.deepcopy(validate_manifest(data)); issues=[]
    cache=outdir/'media';cache.mkdir(parents=True,exist_ok=True)
    for shot in result['shots']:
        for opt in shot['options']:
            pending=False
            for item in media_items(opt):
                media=item.get('media')
                try:
                    if not media and collect and item.get('downloadUrl'):
                        kind=item.get('kind','video')
                        extension=Path(urllib.parse.urlparse(item['downloadUrl']).path).suffix.lower()
                        if extension not in ('.mp4','.mov','.webm','.m4v','.png','.jpg','.jpeg','.webp'):extension='.mp4' if kind=='video' else '.png'
                        key=hashlib.sha256(item['downloadUrl'].encode()).hexdigest()[:24]
                        target=cache/(key+extension)
                        if not target.exists():download(item['downloadUrl'],target)
                        media={'kind':kind,'path':str(target),'startSeconds':0}
                    if media:
                        path=resolve_media_path(media,base,visualization)
                        meta=probe(path,media['kind'])
                        if media['kind']=='video':number(media.get('startSeconds',0),'素材起点',0,meta['durationSeconds']-.001)
                        item['media']={**media,**meta,'path':str(path)}
                        item.pop('issue',None)
                    else:pending=True
                except (ValueError,OSError,subprocess.SubprocessError) as exc:
                    item['media']=None;item['issue']=str(exc);pending=True
                    issues.append({'shotId':shot['id'],'optionId':opt['id'],'itemId':item.get('id'),'error':str(exc)})
            if media_items(opt):opt['status']='pending' if pending else ('rendered' if opt['status']=='rendered' else 'ready')
    result['preparationIssues']=issues
    validate_manifest(result)
    return result

def link(label,path):
    return f'[{label}](<{path}>)'

def write_delivery(data, outdir, receipt=None):
    validate_manifest(data);outdir=Path(outdir);outdir.mkdir(parents=True,exist_ok=True)
    options=outdir/'options';options.mkdir(exist_ok=True)
    lines=[f"# {data['name']} — B-roll 推荐版与备选",'', '主时间轴仅放推荐版；以下保留全部方案。提示词不等于已生成视频。','']
    if receipt:
        lines.extend([f"控制台：{link('打开可编辑工程',receipt['url'])}",'',f"组装状态：{receipt.get('status','unknown')}",''])
        for conflict in receipt.get('protectedEdits',[]):lines.append(f'- 保留手动修改：{conflict}')
    for shot in data['shots']:
        lines.extend([f"## {shot['id']} · {shot['startSeconds']:.3f}–{shot['endSeconds']:.3f} 秒",'',shot['text'],'',f"推荐：**{shot['recommended']}**。{shot['reason']}",''])
        for opt in shot['options']:
            op=options/f"{shot['id']}--{opt['id']}.json"
            op.write_text(json.dumps(opt,ensure_ascii=False,indent=2)+'\n')
            lines.extend([f"### {opt['id']} · {'纯动画' if opt['route']=='animation' else '素材'} · {opt['status']}",'',opt['description'],'',f"模板：`{opt['assetId']}`；{link('替换所需参数',op.resolve())}",''])
            for file in opt.get('files',[]):
                path=file if isinstance(file,str) else file.get('path','')
                if path:lines.append('- '+link(Path(path).name,path))
            for item in media_items(opt):
                lines.extend([f"- {item.get('label',item.get('id','素材'))} · 来源：{item.get('origin')}"])
                if item.get('sourceUrl'):lines.append('  - '+link('来源页面',item['sourceUrl']))
                media=item.get('media')
                if media:
                    path=media.get('path') or media.get('publicPath')
                    lines.append('  - '+link('原始文件',path)+f" · {media.get('width','?')}×{media.get('height','?')}")
                else:lines.append('  - 待生成 / 待取得文件'+('：'+item['issue'] if item.get('issue') else ''))
                if gen:=item.get('generation'):
                    lines.extend(['',f"画面简述：{gen['brief']}",f"生成要求：{gen['durationSeconds']} 秒，{gen['aspectRatio']}；放入 {shot['id']} / {item.get('id','source')}。",'', '详细提示词：','',gen['prompt'],''])
                    if gen.get('avoid'):lines.extend(['避免：'+str(gen['avoid']),''])
    dest=outdir/'交付与备选.md';dest.write_text('\n'.join(lines)+'\n');return dest

def ensure_console(root,port,outdir):
    # Only reuse a server that identifies itself as this editor; never terminate another server.
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/editor/documents',timeout=2) as response:
            json.load(response)
        return
    except Exception:
        with socket.socket() as s:
            if s.connect_ex(('127.0.0.1',port))==0:raise ValueError(f'端口 {port} 已被其他服务占用')
    log=(outdir/'console.log').open('ab')
    subprocess.Popen(['node','tools/build-asset-browser.mjs','--serve'],cwd=root,env={**os.environ,'PANEL_SKIP_REAP':'1','PANEL_NO_OPEN':'1','PANEL_PORT':str(port)},stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
    log.close()
    for _ in range(40):
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/editor/documents',timeout=1) as response:json.load(response)
            return
        except Exception:time.sleep(.25)
    raise RuntimeError('控制台启动超时，见 console.log；已保留工程')

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('command',choices=['validate','prepare','compose'])
    p.add_argument('--manifest',type=Path,required=True);p.add_argument('--output',type=Path)
    p.add_argument('--visualization',type=Path,default=VISUALIZATION);p.add_argument('--collect',action='store_true')
    p.add_argument('--serve',action='store_true');p.add_argument('--port',type=int,default=4325)
    args=p.parse_args();manifest_path=args.manifest.resolve(strict=True)
    data=json.loads(manifest_path.read_text());validate_manifest(data,require_approved=args.command=='compose')
    if args.command=='validate':print('有效');return
    out=(args.output or manifest_path.parent/'composition-delivery').resolve();out.mkdir(parents=True,exist_ok=True)
    ready=prepare(data,manifest_path.parent,out,args.visualization,collect=args.collect)
    prepared=out/'composition.prepared.json';prepared.write_text(json.dumps(ready,ensure_ascii=False,indent=2)+'\n')
    receipt=None
    if args.command=='compose':
        command=['node','tools/editor-compose.mjs','--manifest',str(prepared),'--receipt',str(out/'editor-receipt.json'),'--port',str(args.port)]
        subprocess.run(command,cwd=args.visualization,check=True)
        receipt=json.loads((out/'editor-receipt.json').read_text())
    doc=write_delivery(ready,out,receipt)
    if args.serve and args.command=='compose':ensure_console(args.visualization,args.port,out)
    print(json.dumps({'manifest':str(prepared),'document':str(doc),'editor':receipt,'issues':ready.get('preparationIssues',[])},ensure_ascii=False,indent=2))

if __name__=='__main__':
    try:main()
    except (ValueError,OSError,subprocess.SubprocessError) as exc:raise SystemExit(str(exc))
