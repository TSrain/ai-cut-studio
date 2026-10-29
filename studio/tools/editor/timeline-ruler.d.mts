export type RulerTick={frame:number;x:number;label:string|null};
export function timelineRuler(options:{fps:number;durationFrames:number;pxPerFrame:number;viewportWidth:number;scrollLeft?:number}):{mode:string;majorStepFrames:number;minLabelSpacing:number;ticks:RulerTick[]};
