export function timelineSnapPoints(document:any):number[];
export function createTimelineSnap():{
 reset():void;
 resolve(raw:number,options:{points:number[];px:number;duration:number;enabled?:boolean}):{frame:number;snapped:boolean};
};
