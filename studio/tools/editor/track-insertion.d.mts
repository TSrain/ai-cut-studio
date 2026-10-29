export function insertEmptyTrack(document:any,kind:'audio'|'visual',index:number):{document:any;trackId:string};
export function moveToNewTrack(document:any,ids:string[],delta:number,index:number):any;
export function trackInsertionAt(rows:{top:number;bottom:number;index:number}[],y:number,kind:'audio'|'visual'):{top:number;index:number}|null;
