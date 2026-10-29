export function assessProductionPlanExport(document: any): {
  missing: { shotId: string; title: string; slotId: string; reason: string }[];
  emptyRanges: { shotId: string; startFrame: number; durationFrames: number }[];
  requiresAcknowledgement: boolean;
};
