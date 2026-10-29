export type PlanItem={text:string;detail?:string;time?:string;status?:string;instanceId?:string};
export type PlanSection={kind:string;title:string;items:PlanItem[]};
export type PlanShotView={shotId:string;title:string;narration:string;ranges:any[];time:string;sections:PlanSection[];candidates:any[];kinds:string[]};
export const productionKindNames:Record<string,string>;
export function getPlanShotView(document:any,shot:any,jobs?:any[],resources?:any):PlanShotView;
export type PlanPreviewView=PlanShotView & {visible:boolean;tryAnimation:boolean;category:'animation'|'footage'|'mixed';visualKinds:('animation'|'footage'|'aiVideo')[];animationSection?:PlanSection;networkItems:PlanItem[]};
export function getPlanPreviewView(document:any,shot:any,jobs?:any[],resources?:any):PlanPreviewView;
