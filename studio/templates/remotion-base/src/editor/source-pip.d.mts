import type {EditorDocument,EditorInstance} from './types';
export type CropRect={x:number;y:number;width:number;height:number;sourceAspect:number};
export const PIP_DEFAULTS: {size:number;x:number;y:number;cropX:number;cropY:number;radius:number;borderWidth:number;borderColor:string;shadow:number;entrance:string;exit:string;transitionSeconds:number;editorBackground:string};
export const PIP_MOTIONS: string[];
export function pipTrimBefore(source:EditorDocument['source'],instance:EditorInstance):number;
export function activePip(source:EditorDocument['source'],instances:EditorInstance[],frame:number):EditorInstance|null;
export function cropRect(props:Record<string,any>,sourceAspect:number):CropRect;
export function editCropRect(rect:CropRect,handle:string,dx:number,dy:number):CropRect;
export function pipDimensions(width:number,height:number,props:Record<string,any>):{width:number;height:number};
export function pipGeometry(width:number,height:number,duration:number,frame:number,fps:number,props:Record<string,any>):{left:number;top:number;width:number;height:number;radius:number;borderWidth:number;shadow:number;opacity:number;cropX:number;cropY:number;scale:number;rotateY:number;crop:CropRect};

export function pipMediaTiming(media:{durationSeconds?:number;startSeconds?:number},frame:number,fps:number):{trim:number;available:number;sourceFrame:number};

export function pipFitSize(width:number,height:number,props:Record<string,any>):number;
export function pipPositionPercent(position:number,span:number,fallback?:number):number;
export function pipPosition(width:number,height:number,props:Record<string,any>):{x:number;y:number};
export function positionPip(width:number,height:number,props:Record<string,any>,position:{x:number;y:number}):{offsetX:number;offsetY:number};
