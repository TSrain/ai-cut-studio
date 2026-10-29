export function sourceDigest(path:string):string;
export function validatePresenterAssets(document:any,options:{publicRoot:string;renderMode?:string}):true;
export function validatePresenterSourceClock(data:any,fps:number,options?:{sourceStartFrame?:number;frameCount?:number}):{frameCount:number;tolerance:number};
