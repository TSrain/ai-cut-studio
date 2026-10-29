import type { PlanResult } from "../../templates/remotion-base/src/editor/types";
export function validateDeliveryManifest(
  value: unknown,
  projectId: string,
): {
  schemaVersion: 1;
  timeBase: "project";
  projectId?: string;
  sourceVideoSha256?: string;
  files: Array<{
    file: string;
    startSeconds: number;
    durationSeconds: number;
    transparent: boolean;
  }>;
};
export function verifyDeliveryResult(
  result: PlanResult,
  snapshot: any,
): {
  file: string;
  startSeconds: number;
  durationSeconds: number;
  transparent: boolean;
};
export function deliveryApplicationKey(result: PlanResult): string;
