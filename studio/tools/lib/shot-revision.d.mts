export type ShotRevisionExecution = {kind:'footage';instructions:string};
export function validateShotRevision(result: any, snapshot: any): any;
export function applyShotRevision(result: any, snapshot: any, current: any): any;
export function revisionContext(snapshot: any): {document:any;target:any;shotId:string;editable:any[]};
