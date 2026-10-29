export const PRESENTER_ATLAS_VERSION:string;
export function presenterAtlasLayout(matte:any):{width:number;height:number;columns:number;rows:number;capacity:number};
export function presenterAtlasTile(matte:any,index:number):ReturnType<typeof presenterAtlasLayout>&{page:number;x:number;y:number;path:string};
