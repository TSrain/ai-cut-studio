import type {PlanSection} from './production-plan-view-model.mjs';
export type PlanPreviewLayout={mode:'sides'|'aside'|'stack';leftWidth:number;rightWidth:number;leftSections:PlanSection[];rightSections:PlanSection[];mediaWidth:number;mediaHeight:number;textHeight:number;gap:number;overflow:boolean};
export function calculatePlanPreviewLayout(input:{width:number;height:number;ratio:number;sections?:PlanSection[]}):PlanPreviewLayout;
