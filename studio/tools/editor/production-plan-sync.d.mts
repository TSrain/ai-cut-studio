export function mergeServerDelta(base: any, local: any, remote: any): any;
export function syncPlanHistory(
  history: any,
  base: any,
  remote: any,
  undoable?: boolean,
): any;
export function adjustPlanRange(
  range: any,
  mode: string,
  delta: number,
  total: number,
): any;
export function planMediaUrl(
  path?: string,
  projectId?: string,
  browserPreview?: boolean,
): string | undefined;
export function observeCandidateReads(options: {
  root: Element;
  elements: Iterable<Element>;
  isActive: () => boolean;
  onRead: (rows: Array<{ shotId: string; candidateIds: string[] }>) => void;
  Observer?: any;
}): () => void;
export function contentConfirmationFor(
  result: any,
  shot: any,
  slotId: string,
):
  | {
      confirmed: true;
      mediaSha256: string;
      requirementVersion: number;
      shotId: string;
      slotId: string;
    }
  | undefined;
export function mediaResultEligible(
  result: any,
  document: any,
  override?: any,
): boolean;
export function jsonEqual(a: any, b: any): boolean;
