import type {
  EditorDocument,
  ProductionPlan,
  PlanShot,
  PlanOperation,
} from "../../templates/remotion-base/src/editor/types";
export function validatePlanJson(value: unknown): void;
export function normalizePlan(
  plan?: Partial<ProductionPlan> | unknown,
): ProductionPlan;
export function planRanges(
  doc: EditorDocument,
): Array<{
  shotId: string;
  rangeId: string;
  id: string;
  startFrame: number;
  durationFrames: number;
  shot: PlanShot;
}>;
export function planSummary(doc: EditorDocument): {
  shots: number;
  missing: number;
  unread: number;
  pending: number;
};
export function currentPlanMarkdown(doc: EditorDocument): string;
export function reconcilePlan(doc: EditorDocument): EditorDocument;
export function changePlan(
  doc: EditorDocument,
  operation: PlanOperation | Record<string, unknown>,
): EditorDocument;
export function mergePlans(
  base: unknown,
  current: unknown,
  incoming: unknown,
): ProductionPlan;
export function dependencyFingerprint(
  doc: EditorDocument,
  shotId: string,
  target?: { instanceId?: string; rangeId?: string },
): string;

export function invalidateRequirements(plan: any, shot: any, previous: any): void;
