export function safeMusicUrl(value: unknown): string|null;
export function validateBgmPlan(plan: any): void;
export function bgmDetail(document: any, shot: any): any;
export function getBgmRows(document: any): {id:string;shotId:string;title:string;musicType:string;startFrame:number;durationFrames:number}[];

export function prepareBgmMerge(current: any, incoming: any): any;
