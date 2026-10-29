import {readSync} from 'node:fs';
export function createVerifiedFileDigest(options?:{maxEntries?:number;read?:typeof readSync}):(path:string)=>string;
export const verifiedFileDigest:(path:string)=>string;
