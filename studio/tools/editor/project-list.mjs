const dayKey=(date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export function groupProjects(documents,query='',now=new Date()) {
  const yesterday=new Date(now);yesterday.setDate(yesterday.getDate()-1);
  const todayKey=dayKey(now), yesterdayKey=dayKey(yesterday), groups=new Map();
  const time=d=>Number.isFinite(Date.parse(d.updatedAt))?Date.parse(d.updatedAt):0;
  for(const project of documents.filter(d=>d.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).slice().sort((a,b)=>time(b)-time(a)||a.id.localeCompare(b.id))) {
    const date=new Date(project.updatedAt), valid=Number.isFinite(date.getTime()), key=valid?dayKey(date):'unknown';
    if(!groups.has(key))groups.set(key,{key,label:key===todayKey?'今天':key===yesterdayKey?'昨天':valid?`${date.getFullYear()}年${date.getMonth()+1}月${date.getDate()}日`:'日期未知',projects:[]});
    groups.get(key).projects.push(project);
  }
  return [...groups.values()];
}
