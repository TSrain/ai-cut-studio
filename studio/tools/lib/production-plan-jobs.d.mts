import type {
  EditorDocument,
  PlanJob,
  PlanResult,
  PlanOperation,
  PlanConflict,
} from "../../templates/remotion-base/src/editor/types";
export type PlanServiceOptions = {
  candidateDownloadTools?: {download:(url:string,target:string)=>Promise<void>;inspect:(path:string)=>Promise<{width:number;height:number;durationSeconds:number;kind:string}>};
  root?: string;
  rootDir?: string;
  artifactRoot?: string;
  assetSourceRoot?: string;
  assetSourcePaths?: string[];
  contentRoot?: string;
  autoStart?: boolean;
  concurrency?: number;
  python?: string;
  workerPath?: string;
  workerEnv?: Record<string, string>;
  pollMs?: number;
  apiBase?: string;
};
export type PlanAction = {
  projectId: string;
  revision: number;
  operation: PlanOperation;
  operationId?: string;
};
export type PlanJobRequest = {
  projectId: string;
  revision: number;
  kind: PlanJob["kind"];
  shotId?: string;
  slotId?: string;
  instanceId?: string;
  rangeId?: string;
  mediaPaths?: string[];
  deliveryManifestPath?: string;
  candidateId?: string;
  aiVideoCandidateId?: string;
  aiVideoPromptVersion?: number;
  aiVideoCandidateIdentity?: string;
  script?: string;
  instructions?: string;
  /** footage:true with shotId explicitly requests bounded selected-shot execution. */
  scope?: { camera?: boolean; sound?: boolean; footage?: boolean };
  parentJobId?: string;
  resumeJobId?: string;
  sourceSrtPath?: string;
  audioPath?: string;
};
export type CandidateDownloadRequest = {projectId:string;shotId:string;candidateId:string;revision?:number;rangeId?:string;addToTimeline?:boolean};
export type CandidateDownloadDescriptor = {candidateId:string;path:string;kind:string;url:string;downloadUrl:string;mediaId?:string;added?:boolean;alreadyPresent?:boolean;instanceId?:string;document?:EditorDocument;jobs?:PlanJob[]};
export function createProductionPlanService(options?: PlanServiceOptions): {
  read(projectId: string): {
    document: EditorDocument;
    jobs: PlanJob[];
    history: Array<{ id: string; createdAt: string; path: string }>;
    pendingResults: PlanResult[];
  };
  action(request: PlanAction): {
    document: EditorDocument;
    jobs: PlanJob[];
    conflicts: PlanConflict[];
  };
  createJob(
    request: PlanJobRequest,
  ): Promise<{ job: PlanJob; document: EditorDocument }>;
  ingest(request: {
    projectId: string;
    jobId: string;
    results: PlanResult[];
    status?: PlanJob["status"];
    stage?: string;
    processed?: number;
    total?: number;
  }): Promise<{ job: PlanJob; document: EditorDocument }>;
  applyResults(
    request: PlanAction,
  ): Promise<{ document: EditorDocument; jobs: PlanJob[] }>;
  cancel(id: string): PlanJob;
  retry(id: string): Promise<{ job: PlanJob; document: EditorDocument }>;
  recover(): Promise<void>;
  pump(): Promise<void>;
  getJob(id: string): PlanJob;
  jobs(projectId: string): PlanJob[];
  history(projectId: string, version: string): unknown;
  currentMarkdown(projectId: string): { markdown: string };
  candidateMedia(request:{projectId:string;shotId:string;candidateId:string}):Promise<{candidateId:string;available?:false;path?:string;kind?:string;url?:string;downloadUrl?:string;mediaId?:string}>;
  candidateDownload(request:CandidateDownloadRequest):Promise<CandidateDownloadDescriptor>;
  resolveFile(projectId: string, path: string): string;
  close(): void;
};
