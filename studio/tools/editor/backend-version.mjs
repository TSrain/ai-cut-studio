// Pure helpers for the "backend is outdated" banner (tested in node).
export const BACKEND_STALE_TEXT='后台版本已过期，请重启';
export function backendBanner(status){
 if(!status||status.stale!==true)return null;
 return {text:BACKEND_STALE_TEXT,detail:(status.reasons??[]).map(r=>r.message).join('；')};
}
