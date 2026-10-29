#!/usr/bin/env python3
"""Crop already-rendered PNG caption plates to their shared alpha bounds."""
import json
import sys
from pathlib import Path
from PIL import Image
paths=json.loads(Path(sys.argv[1]).read_text())
root=Path(sys.argv[2]); bounds=[]
for path in paths:
 with Image.open(path) as im:
  box=im.convert('RGBA').getchannel('A').getbbox()
  if box: bounds.append(box)
  width,height=im.size
left=0;top=min((b[1] for b in bounds),default=0);bottom=max((b[3] for b in bounds),default=2)
top=max(0,top-2);bottom=min(height,bottom+2)
files=[]
for index,path in enumerate(paths):
 target=root/f'caption-{index:03}.png'
 with Image.open(path) as im: im.crop((0,top,width,bottom)).save(target)
 files.append({'original':path,'cropped':str(target)})
print(json.dumps({'top':top,'height':bottom-top,'files':files}))
