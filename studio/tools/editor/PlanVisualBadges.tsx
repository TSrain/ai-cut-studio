import React from 'react';
import {Tooltip} from './Tooltip';
export type PlanVisualKind='animation'|'footage'|'aiVideo';
const types:Record<PlanVisualKind,{label:string;name:string}>={
 animation:{label:'动',name:'动画'},
 footage:{label:'网',name:'网络素材候选'},
 aiVideo:{label:'AI',name:'AI 视频提示词'},
};
const order:PlanVisualKind[]=['animation','footage','aiVideo'];
export function PlanVisualBadge({kind}:{kind:string}){
 const item=types[kind as PlanVisualKind];
 return item?<Tooltip text={item.name}><span className={'plan-visual-badge kind-'+kind} role="img" aria-label={item.name}>{item.label}</span></Tooltip>:null;
}
export function PlanVisualBadges({kinds,compact=false}:{kinds:readonly string[];compact?:boolean}){
 const active=order.filter(kind=>kinds.includes(kind));
 return active.length?<span className={'plan-visual-badges'+(compact?' is-compact':'')} aria-label="画面类型">{active.map(kind=><PlanVisualBadge key={kind} kind={kind}/>)}</span>:null;
}
