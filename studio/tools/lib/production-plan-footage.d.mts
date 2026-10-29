import type {
  EditorDocument,
  PlanResult,
} from "../../templates/remotion-base/src/editor/types";
export function verifyFootageResult(
  result: PlanResult,
  snapshot: Record<string, any>,
  outputDir: string,
): {
  review: Record<string, any>;
  candidate: Record<string, any>;
  placement: Record<string, any> | null;
};
export function footageApplicationKey(result: PlanResult): string;
export function footageMediaProps(
  canvas: EditorDocument["canvas"],
  meta: Record<string, any>,
  placement: Record<string, any>,
): Record<string, any>;
