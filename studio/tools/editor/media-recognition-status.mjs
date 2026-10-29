// Read-only presentation state. Completion alone never means a timeline placement.
const publicRoot = 'templates/remotion-base/public/';
function pathKey(value) {
  if (typeof value !== 'string' || !value) return '';
  const marker = value.indexOf(publicRoot);
  return marker >= 0 ? value.slice(marker + publicRoot.length) : value;
}
function paths(item) {
  return [item.path, item.stagedPath, item.publicPath].map(pathKey).filter(Boolean);
}
function instancePaths(instance) {
  return Object.values(instance.assetReferences ?? {}).filter(v => typeof v === 'string').map(pathKey);
}
export function mediaRecognitionStatus(item, {document, jobs = [], submitting = []}) {
  if (item.scope !== 'project' || !document?.id) return null;
  const keys = paths(item), instances = document.instances ?? [];
  if (instances.some(instance => instancePaths(instance).some(key => keys.includes(key)))) return 'filled';
  const relevant = jobs.filter(job => job.projectId === document.id && job.kind === 'recognize');
  const inputIndexes = job => (job.mediaPaths ?? []).flatMap((path, index) =>
    job.mediaIds?.[index] === item.id || keys.includes(pathKey(path)) ? [index] : []);
  for (const job of relevant) {
    const inputPaths = inputIndexes(job).map(index => pathKey(job.mediaPaths[index]));
    for (const result of job.results ?? []) {
      if (![...keys, ...inputPaths].includes(pathKey(result.media?.path))) continue;
      const bound = (document.productionPlan?.shots ?? []).flatMap(shot => shot.bindings ?? []).some(binding =>
        binding.resultId === result.id && binding.status !== 'removed' && instances.some(instance =>
          instance.id === binding.instanceId && instancePaths(instance).includes(pathKey(binding.path))));
      const delivered = instances.some(instance => [instance.props?.deliveryIdentity, instance.props?.footageIdentity]
        .some(identity => identity?.resultId === result.id));
      if (bound || delivered) return 'filled';
    }
  }
  if (submitting.some(batch => batch.projectId === document.id && batch.mediaIds.includes(item.id))) return 'recognizing';
  for (const job of relevant) {
    if (!['queued', 'running'].includes(job.status)) continue;
    const indexes = inputIndexes(job);
    if (indexes.some(index => index >= (job.processed ?? 0))) return 'recognizing';
  }
  for(const job of relevant){
    if(!inputIndexes(job).length)continue;
    if(['failed','interrupted'].includes(job.status))return 'failed';
    if(job.status==='cancelled')return 'cancelled';
    const matched=(job.results??[]).filter(result=>[...keys,...inputIndexes(job).map(i=>pathKey(job.mediaPaths[i]))].includes(pathKey(result.media?.path)));
    if(matched.some(r=>['stale','conflict'].includes(r.state)))return 'stale';
    if(matched.some(r=>r.state==='ignored'))return 'ignored';
    if(['complete','partial','plan_only'].includes(job.status)||(inputIndexes(job).some(i=>i<(job.processed??0))))return 'unmatched';
  }
  return null;
}
