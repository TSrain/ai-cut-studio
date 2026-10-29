import type {EditorDocument} from './types';
export type CaptionStyle = {fontFamily:string;fontSize:number;color:string;backgroundColor:string;backgroundOpacity:number;positionXPercent?:number;bottomPercent:number;maxWidthPercent:number;paddingX:number;paddingY:number;borderRadius:number};
export type CaptionCue = {id:string;startFrame:number;endFrame:number;text:string;originalText:string;initialText?:string;style?:Partial<CaptionStyle>};
export type CaptionTrack = {version:1;enabled:boolean;style:CaptionStyle;cues:CaptionCue[]};
export const DEFAULT_CAPTION_STYLE:Readonly<Required<CaptionStyle>>;
export const CAPTION_FONTS:ReadonlyArray<{value:string;label:string}>;
export function validateCaptionTrack(track:unknown,options?:number|{durationFrames?:number}):true;
export function captionSourceKey(document:EditorDocument):string;
export function hasVisibleCaptions(document:Pick<EditorDocument,'captions'>,renderMode?:string):boolean;
export function captionAtFrame(track:CaptionTrack|undefined,frame:number):CaptionCue|null;
export function captionLineCapacity(canvas:{width:number;height:number},style?:CaptionStyle):number;
export function cuesToCaptionTrack(cues:{start:number;end:number;text:string;originalText?:string}[],document:EditorDocument,style?:Partial<CaptionStyle>):CaptionTrack;

export function cleanCaptionText(text:string):string;

export function resolveCaptionStyle(track:CaptionTrack|undefined,cue?:CaptionCue):Required<CaptionStyle>;
export function patchCaptionStyles(track:CaptionTrack,ids:Iterable<string>,patch:Partial<CaptionStyle>,scope?:'selected'|'all'):CaptionTrack;
export function resetCaptionStyles(track:CaptionTrack,ids:Iterable<string>):CaptionTrack;
export function captionStyleValues(track:CaptionTrack,ids:Iterable<string>):{style:Required<CaptionStyle>;mixed:(keyof CaptionStyle)[]};
