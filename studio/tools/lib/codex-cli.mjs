// Codex CLI settings shared with 自媒体工作流: the single source is
// <workflow>/config/codex.json (see tools/codex_cli.py there). Env overrides:
// CODEX_BIN (legacy EDITOR_CODEX_BIN / EDITOR_CODEX_BINARY), CODEX_MODEL, CODEX_REASONING_EFFORT.
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
const DEFAULTS={binary:'codex',fallbackBinaries:[],model:null,reasoningEffort:null};
export const EFFORTS=new Set(['minimal','low','medium','high','xhigh','ultra']);
const env=names=>names.map(n=>process.env[n]).find(Boolean);
export const workflowRoot=()=>process.env.CONTENT_WORKFLOW_ROOT||process.env.EDITOR_WORKFLOW_ROOT||fileURLToPath(new URL('../../../workflow/',import.meta.url));
export function codexConfig(path=join(workflowRoot(),'.devin/codex.local.json')){
 try{return {...DEFAULTS,...JSON.parse(readFileSync(path,'utf8'))};}catch{return {...DEFAULTS};}
}
export function codexBinary(config=codexConfig()){
 const override=env(['CODEX_BIN','EDITOR_CODEX_BIN','EDITOR_CODEX_BINARY']);if(override)return override;
 return [config.binary,...(config.fallbackBinaries??[])].find(p=>p&&existsSync(p))??'codex';
}
export function codexModelArgs(config=codexConfig()){
 const model=env(['CODEX_MODEL'])||config.model,effort=env(['CODEX_REASONING_EFFORT'])||config.reasoningEffort;
 if(effort&&!EFFORTS.has(effort))throw Error(`unknown codex reasoning effort: ${effort}`);
 return [...(model?['--model',model]:[]),...(effort?['-c',`model_reasoning_effort="${effort}"`]:[])];
}
// approval 'never' = top-level --ask-for-approval never (exec no longer accepts -a); 'auto' = exec --approve-for-me.
export function codexExecArgs(args,{approval='never',config=codexConfig()}={}){
 if(!['never','auto'].includes(approval))throw Error(`unknown approval mode: ${approval}`);
 return [...(approval==='never'?['--ask-for-approval','never']:[]),'exec',...(approval==='auto'?['--approve-for-me']:[]),...codexModelArgs(config),...args];
}
