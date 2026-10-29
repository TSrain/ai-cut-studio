export type ProjectSummary={id:string;name:string;revision:number;updatedAt?:string};
export function groupProjects(documents:ProjectSummary[],query?:string,now?:Date):{key:string;label:string;projects:ProjectSummary[]}[];
