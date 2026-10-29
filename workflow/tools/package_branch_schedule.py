"""Ready-queue ordering only; global model slots remain the runner's responsibility."""
from statistics import median

# Start the three acquisition/production lanes first. Keep templates only for
# legacy persisted queues; the active v2 producer does not create that lane.
COLD_ORDER=('footage','cover','bgm','templates','captions','camera','aiVideo')


def order_ready_branches(branches, estimates):
    ready=[row for row in branches if row.get('status','queued') in {'queued','ready'}]
    def key(row):
        branch=row.get('branchId',row.get('id'))
        history=estimates.get(branch,[])
        if isinstance(history,dict):history=history.get('samples',[])
        samples=[]
        for sample in history[-10:]:
            if isinstance(sample,dict):
                if sample.get('status')!='complete':continue
                if row.get('policyVersion') is not None and sample.get('policyVersion')!=row['policyVersion']:continue
                sample=sample.get('durationSeconds')
            if isinstance(sample,(int,float)) and sample>=0:samples.append(sample)
        duration=median(samples) if len(samples)>=3 else None
        return (0 if branch=='templates' and row.get('animationDeliveryRelevant') else 1,0 if duration is not None else 1,-duration if duration is not None else 0,COLD_ORDER.index(branch) if branch in COLD_ORDER else len(COLD_ORDER),branch)
    return [row.get('branchId',row.get('id')) for row in sorted(ready,key=key)]
