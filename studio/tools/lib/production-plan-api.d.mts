import type { IncomingMessage, ServerResponse } from "node:http";
import type { PlanServiceOptions } from "./production-plan-jobs.mjs";
import { createProductionPlanService } from "./production-plan-jobs.mjs";
export function productionPlanService(
  options: PlanServiceOptions,
): ReturnType<typeof createProductionPlanService>;
export function productionPlanApi(
  action: string,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  body: Record<string, any>,
  options: PlanServiceOptions,
): Promise<boolean>;
