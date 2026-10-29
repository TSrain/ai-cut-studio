export function parseTimecode(value,fps=30){
 const s=value.trim();if(/^\d+(\.\d+)?$/.test(s))return Math.round(Number(s)*fps);
 const m=/^(\d+):([0-5]?\d)(?::(\d+))?$/.exec(s);if(!m||Number(m[3]??0)>=fps)return null;
 return Math.round((Number(m[1])*60+Number(m[2]))*fps+Number(m[3]??0));
}
