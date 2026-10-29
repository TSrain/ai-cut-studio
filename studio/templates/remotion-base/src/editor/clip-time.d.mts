import type {EditorDocument,EditorInstance} from './types';
type Source=EditorDocument['source'];
type Clip={id:string;startFrame:number;durationFrames:number;sourceInFrame:number;name?:string};
export function instanceTiming(instance:Pick<EditorInstance,'durationFrames'|'sourceOffsetFrames'|'sourceDurationFrames'>):{offset:number;duration:number};
export function sourceClipAt(source:Source,frame:number,total:number):Clip|null;
export function sourceFrameAt(source:Source,frame:number,total:number):number|null;
export function sourceSegments(source:Source,total:number):Clip[];
export function projectSourceRange(source:Source,start:number,end:number,total:number):{sourceClipId:string;startFrame:number;endFrame:number}[];
export function semanticFrame(document:EditorDocument,instance:Pick<EditorInstance,'assetId'|'props'>,globalFrame:number):number|null;
