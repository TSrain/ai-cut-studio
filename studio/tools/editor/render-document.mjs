/** Renderer input only. Workflow progress and review receipts never reset Player. */
export function renderDocument(document){
 const d=structuredClone(document);
 for(const key of ['roughcut','productionPlan','projectBinding','markers','review','reviewState','reviewAppliedIds','assetSourceHash'])delete d[key];
 d.revision=0;d.name='';
 for(const track of [...(d.tracks??[]),...(d.audioTracks??[])]){delete track.name;delete track.locked;}
 return d;
}
export const renderDocumentKey=document=>JSON.stringify(renderDocument(document));
