import type {Stats} from 'node:fs';
export function cachedAudioDuration(root:string,absolute:string,stat:Stats):{duration:number|undefined;pending:boolean};
export function waitForAudioDurations(root:string):Promise<void>;
