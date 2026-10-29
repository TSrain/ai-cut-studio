import type {EditorDocument} from '../../templates/remotion-base/src/editor/types';
export function organizeTracks<T extends EditorDocument>(document:T): {document:T;changed:boolean;removedTracks:number;movedClips:number};
