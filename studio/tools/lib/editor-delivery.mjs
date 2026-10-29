import {join,isAbsolute} from 'node:path';
// Use explicit episode references only. An editor UUID is never a delivery folder.
export function editorDeliveryDirectory(document,mode,artifactRoot){
 if(document.projectBinding?.projectId===document.id&&typeof document.projectBinding.projectRoot==='string'&&isAbsolute(document.projectBinding.projectRoot)){const category=mode==='full'?'成片':['clip','single-layer'].includes(mode)?'效果预览':'动画素材';return join(document.projectBinding.projectRoot,category);}
 const references=[document.id,document.name,document.styleReference?.contractPath,document.source?.path];
 const episodes=new Set(references.flatMap(value=>typeof value==='string'?[...value.matchAll(/\bSC-\d+\b/g)].map(m=>m[0]):[]));
 if(episodes.size!==1)return artifactRoot;
 const category=mode==='full'?'成片':['clip','single-layer'].includes(mode)?'片段':'动画素材';
 return join(artifactRoot,[...episodes][0],category);
}
