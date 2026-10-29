import type {AudioClip} from './types';
export function audioVolumeAt(clip:AudioClip,frame:number):number;

export function audioVolumeExpression(clip:AudioClip,fps:number,rangeOffsetFrames?:number):string;
export function editAudioFades(clip:AudioClip,patch:Partial<AudioClip>):Partial<AudioClip>;
