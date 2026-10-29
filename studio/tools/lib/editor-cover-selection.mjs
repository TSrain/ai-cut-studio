import {readFileSync,mkdirSync,writeFileSync,existsSync,realpathSync} from 'node:fs';
import {join,relative,isAbsolute,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {listProjectCovers,resolveCoverImage} from './editor-covers.mjs';
export function stageProjectCover(document,selection,{publicRoot,...options}){
 const path=resolveCoverImage(document,selection,options);
 const run=listProjectCovers(document,options).runs.find(x=>x.id===selection.runId),group=run.groups.find(x=>x.id===selection.groupId);
 const bytes=readFileSync(path),hash=createHash('sha256').update(bytes).digest('hex');
 const publicPath=`editor-covers/${hash}.png`,target=join(publicRoot,publicPath);
 mkdirSync(join(publicRoot,'editor-covers'),{recursive:true});
 if(!existsSync(target))writeFileSync(target,bytes,{flag:'wx'});
 const cover={publicPath,runId:run.id,groupId:group.id,ratio:selection.ratio,title:group.title};
 validateCoverAsset(cover,publicRoot);return cover;
}
export function validateCoverAsset(cover,publicRoot){
 if(!cover)return;
 if(!/^editor-covers\/[a-f0-9]{64}\.png$/.test(cover.publicPath))throw Error('封面素材路径无效');
 const root=realpathSync(publicRoot),file=realpathSync(join(root,cover.publicPath)),rel=relative(root,file);
 if(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw Error('封面素材超出 public 目录');
 const hash=createHash('sha256').update(readFileSync(file)).digest('hex');
 if(!cover.publicPath.endsWith(hash+'.png'))throw Error('封面素材已被修改，请重新选择封面');
}
