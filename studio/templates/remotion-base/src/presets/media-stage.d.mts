export function stageGeometry(width:number,height:number,ratio:number,scale?:number):{x:number;y:number;width:number;height:number};
export function stageVideoTiming(seconds?:number,startSeconds?:number,fps?:number):{trim:number;available:number};
export function stageImportSlots(kind:string,meta:any):Record<string,string|number>;
export function titleCharacterState(frame:number,fps:number,index:number,count:number,mode?:string):{opacity:number;x:number;y:number};
