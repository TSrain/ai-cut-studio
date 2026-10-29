export function clipDensity(width:number):'compact'|'label'|'detail';
export function clampTimelineHeight(height:number,viewportHeight:number):number;
export function cameraDisplayClips(doc:any):any[];
export function timelineSelection(doc:any,selection?:{keys?:string[];captionId?:string;captionIds?:string[];cameraId?:string;cameraRange?:{startFrame:number;endFrame:number}|null}):{start:number;end:number;count:number;kind:string}|null;
export function visibleTimelineRange(args:{scrollLeft:number;viewport:number;labelWidth:number;px:number;duration:number}):{start:number;end:number};
