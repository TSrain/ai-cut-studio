export type MediaMotion='slide'|'fade'|'none'|'zoom'|'pop'|'flip'|'drop'|'wipe';
export const STACK_LAYOUT_OPTIONS:string[];
export type MediaItem={id:string;label:string;media:null|{kind:'image'|'video';publicPath:string;width:number;height:number;durationSeconds?:number;startSeconds?:number};crop:any;enterSeconds:number;exitSeconds:number|null;transitionSeconds:number;motion?:MediaMotion;exitMotion?:MediaMotion;entrance?:'left'|'right'|'up'|'down';x:number;y:number;scale:number;rotation:number;radius?:number;borderWidth?:number;borderColor?:string};
export function isMediaAsset(id:string):boolean;
export function defaultMediaItem(id:string,index?:number):MediaItem;
export function defaultMediaProps(id:string):any;
export function validateMediaProps(id:string,props:any,options?:{durationSeconds?:number;requireAssets?:boolean;fps?:number}):any;
export function mediaItemTiming(item:MediaItem,frame:number,fps:number,durationSeconds:number,playback?:string):any;
export function fitMediaCrop(crop:any,width:number,height:number):any;
export function mediaGeometry(id:string,props:any,width:number,height:number):any[];
export function replaceMediaItem(item:MediaItem,media:any):MediaItem;

export function mediaEntrance(item:MediaItem,progress:number,width:number,height:number):{x:number;y:number};

export const MOTION_OPTIONS:string[];
export function mediaSequenceState(props:any,frame:number,fps:number,durationSeconds:number,width:number,height:number):any[];
export function mediaMotionStyle(item:MediaItem,motion:string,progress:number,width:number,height:number):{opacity:number;transform:string;clipPath?:string};

export function resolveMediaMotion(item:MediaItem,props:Record<string,any>,edge?:'enter'|'exit'):string;
