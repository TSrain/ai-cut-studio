import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {stageEditorSource} from '../lib/editor-media.mjs';
test('export staging preserves already-public source identity used by person matte',()=>{const root=mkdtempSync(join(tmpdir(),'behind-stage-'));try{mkdirSync(join(root,'templates/remotion-base/public'),{recursive:true});writeFileSync(join(root,'templates/remotion-base/public/a.mov'),'local source');const d={source:{path:'templates/remotion-base/public/a.mov',publicPath:'a.mov',startFrame:0},instances:[]};assert.equal(stageEditorSource(d,{root}).source.publicPath,'a.mov');}finally{rmSync(root,{recursive:true,force:true});}});
