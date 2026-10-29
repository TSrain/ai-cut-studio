export function isPublicAddress(ip:string):boolean;
export function assertReusableCandidate(candidate:{downloadUrl?:string;license?:string|{name?:string}}):string;
export function downloadPublicMedia(url:string,target:string):Promise<void>;
export function inspectDownloadedMedia(path:string):Promise<{width:number;height:number;durationSeconds:number;kind:string}>;

export function resolvePublicAddresses(hostname:string,dependencies?:{lookupFn?:(hostname:string,options:{all:true})=>Promise<Array<{address:string;family:number}>>;dohFn?:(hostname:string)=>Promise<Array<{address:string;family:number}>>}):Promise<Array<{address:string;family:number}>>;
