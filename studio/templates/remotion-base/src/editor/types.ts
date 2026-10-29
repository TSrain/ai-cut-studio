import type {CaptionTrack} from './captions.mjs';
import type {GENERATED_PRESET_CATALOG} from './preset-catalog.generated';
export type PresetEditorAssetId = typeof GENERATED_PRESET_CATALOG[number]['id'];
export type EditorAssetId = PresetEditorAssetId | 'chapter-progress' | 'source-pip' | 'media-stack' | 'media-split';
export type SlotDescriptor = {label?: string; type?: string; required?: boolean; hint?: string; description?: string; assetDir?: string; derivedFrom?: string; [key: string]: unknown};
export type VariantDescriptor = {label?: string; type?: string; values?: readonly (string | number)[]; default?: string | number; hint?: string; description?: string; [key: string]: unknown};
export type EditorAsset = {id: EditorAssetId; name: string; compositionId: string; version: string | number; status: string; description: string; thumbnail: string | null; preview?: string; canvas: readonly string[]; duration: {min: number; max: number; default: number}; slots: Record<string, SlotDescriptor>; variants: Record<string, VariantDescriptor>; slotDescriptors: Record<string, SlotDescriptor>; variantDescriptors: Record<string, VariantDescriptor>; defaultProps: Record<string, any>; parts: readonly {id: string; label: string}[]; fields: readonly string[]; exportBackground: {mode: 'opaque' | 'transparent'} | {mode: 'conditional'; variantKey: string; value: string}};
export type ElementStyle = {fontFamily?: string; fontSize?: number; fontWeight?: number; lineHeight?: number; letterSpacing?: number; textAlign?: 'left' | 'center' | 'right'; width?: number; x?: number; y?: number; color?: string; opacity?: number; backgroundColor?: string; borderRadius?: number; padding?: number};
export type EditorInstance = {autoPlacement?:{kind:'automatic-visual-v1';instanceId:string;trackId:string};assetReferences?:Record<string,string>;id: string; groupId?:string; disabled?:boolean; assetId: EditorAssetId; assetVersion: string | number; startFrame: number; durationFrames: number; zIndex: number; trackId?: string; name?: string; sourceOffsetFrames?: number; sourceDurationFrames?: number; props: Record<string, any>};
export type EditorCover={publicPath:string;runId:string;groupId:string;ratio:'3:4'|'4:3';title:string};
export type EditorDocument = {roughcut?: import('../../../../tools/editor/roughcut-model.mjs').RoughcutState;projectBinding?:ProjectBinding; productionPlan?:ProductionPlan; schemaVersion: 1; cover?:EditorCover; markers?:{id:string;name:string;frame:number}[]; audioClips?:AudioClip[]; audioTracks?:{id:string;name:string;locked?:boolean;disabled?:boolean}[]; captions?: CaptionTrack; timelineVersion?: 2; tracks?: {id: string; name: string; locked?: boolean; disabled?:boolean;autoPlacement?:{kind:'automatic-visual-v1';createdIndex:number;originalName:string}}[]; id: string; name: string; revision: number; canvas: {width: number; height: number; fps: {num: number; den: number}; durationFrames: number}; source: null | {path: string; displaySize?:{width:number;height:number}; volume?:number; muted?:boolean; locked?: boolean; startFrame: number; publicPath?: string; durationFrames?: number; clips?: {id: string; startFrame: number; durationFrames: number; sourceInFrame: number; name?: string}[]; cameraPlan?: any}; styleReference: {contractPath: string | null; styleframePath: string | null; allowedOverrides: Record<string, unknown>}; assetSourceHash?: string; instances: EditorInstance[]};
export type EditorCompositionProps = {previewSource?:{path:string;url:string}; document: EditorDocument; renderMode: 'full' | 'layer' | 'instances'; instanceId?: string; rangeStartFrame?: number; renderDurationFrames?: number; onSelect?: (instanceId: string, partId?: string) => void};

export type AudioClip = {originalPath?:string;id:string; name:string; path:string; publicPath?:string; startFrame:number; durationFrames:number; sourceInFrame:number; sourceDurationFrames:number; volume:number; muted?:boolean; fadeInFrames:number; fadeOutFrames:number; fadeInCurve?:'linear'|'smooth'|'equalPower'; fadeOutCurve?:'linear'|'smooth'|'equalPower'; trackId:string; groupId?:string; envelopeOffsetFrames?:number; envelopeDurationFrames?:number};

export type PlanApproval =
  | "draft"
  | "waiting_approval"
  | "waiting_selection"
  | "approved"
  | "needs_design";
export type ProjectBinding = {
  recovery?: { missingReferences: string[]; snapshotCount: number };
  projectId: string;
  projectRoot: string;
  scriptId?: string;
  version: 1;
};
export type PlanRange = {
  id: string;
  startFrame: number;
  durationFrames: number;
};
export type PlanSlot = {
  aiVideoOwner?:{kind:'ai-video-slot-v1';candidateId:string};
  id: string;
  type: "animation" | "video" | "image" | "screen" | "other";
  description: string;
  requirementVersion: number;
  evidence?: string;
  presentationMode?: "overlay" | "immersive";
  status?: string;
};
export type Candidate = {
  id: string;
  slotId: string;
  title: string;
  url: string;
  platform?: string;
  previewPath?: string;
  reason: string;
  sourceInSeconds?: number;
  sourceOutSeconds?: number;
  downloadUrl?: string;
  downloadVerified?: boolean;
  quality?: {
    basis: "page" | "file" | "unknown";
    width?: number;
    height?: number;
  };
  readAt?: string;
  ignored?: boolean;
  availability?: string;
  author?: string;
  license?: string;
};
export type AiVideoCandidate = {
  id:string;title:string;prompt:string;promptVersion:number;requirementVersion:number;
  sourceCueIds:number[];reason:string;aspectRatio:string;durationSeconds:number;
  references:Array<{path:string;label:string;purpose:string;sha256?:string}>;
  evidenceRole?:'illustration';usage?:'illustration';ignored?:boolean;
};
export type MediaBinding = {
  id: string;
  slotId: string;
  instanceId: string;
  mediaId?: string;
  path: string;
  candidateId?: string;
  aiVideoCandidateId?: string;
  aiVideoPromptVersion?: number;
  aiVideoCandidateSha256?: string;
  sourceInSeconds: number;
  sourceOutSeconds?: number;
  requirementVersion: number;
  confirmed: boolean;
  resultId?: string;
  status?: "current" | "requirements_changed" | "removed";
  startFrame?: number;
  durationFrames?: number;
};
export type PlanEffectTiming = {
  status: 'draft' | 'confirmed'; sourcePath: string;
  startSeconds: number; changeSeconds: number; holdSeconds: number; endSeconds: number;
  evidence: {sourceSha256: string; transcriptHash: string; sourceCueIds: number[]; reason: string};
};
export type BgmRecommendation = {id:string;title:string;artist:string;url:string;reason:string;licenseStatus:'unknown'|'verify_before_use'|'verified';licenseUrl?:string;audition:'not_listened'|'listened'};
export type BgmDesign = {decision:'music'|'silence';reason:string;requirementVersion:number;purpose?:'continuity'|'narrative'|'atmosphere';musicType?:string;texture?:string;entry?:string;exit?:string;recommendationIds?:string[];manual?:boolean;locked?:boolean};
export type PlanShot = {
  bgmDesign?: BgmDesign;
  effectTiming?: PlanEffectTiming;
  cameraIntent?: Record<string, unknown>;
  presenterLayerIntent?: Record<string, unknown>;
  id: string;
  order: number;
  title: string;
  narration: string;
  visualRequirement: string;
  mediaDescription: string;
  requirementVersion: number;
  approval: PlanApproval;
  cancelled?: boolean;
  keyframes: Array<{ path: string; label?: string }>;
  anchor?: {
    sourcePath: string;
    startSeconds: number;
    endSeconds: number;
    confidence: number;
    transcriptHash?: string;
  };
  timing: {
    status: "unaligned" | "estimated" | "aligned" | "review" | "manual";
    ranges: PlanRange[];
    manual: boolean;
    estimatedSeconds?: number;
  };
  slots: PlanSlot[];
  bindings: MediaBinding[];
  candidates: Candidate[];
  aiVideoCandidates?: AiVideoCandidate[];
  alternatives?: unknown[];
  details?: Record<string, unknown>;
  upstream?: Record<string, unknown>;
  approvedRequirementVersion?: number;
};
export type PlanConflict = {
  id: string;
  shotId?: string;
  field: string;
  base: unknown;
  current: unknown;
  incoming: unknown;
};
export type PackageVersion = {
  id: string;
  createdAt?: string;
  path?: string;
  files?: unknown[];
  markdown?: string;
  approval?: unknown;
};
export type ChangeRecord = {
  id: string;
  type: string;
  shotId?: string | null;
  baseRevision: number;
  createdAt: string;
  source: string;
};
export type ProductionPlan = {
  bgmPlanVersion?:1;
  bgmExecution?:{version:1;runId:string;status:'applied'|'partial'|'protected';gaps:string[];clipIds:string[];audition:'not_listened'};
  bgmRecommendations?:BgmRecommendation[];
  bgmRecommendationGaps?:string[];
  schemaVersion: 1;
  revision: number;
  script: string;
  sourceVersion?: string;
  animationWorkflow?: "semantic-template-v1";
  upstream?: {
    animationPackage?: Record<string, unknown>;
    footagePackage?: {
      summaryPath?: string;
      reviewPath?: string;
      allCandidateManifestPath?: string;
      jobId?: string;
      state?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  sourceSrtPath?: string;
  transcriptBinding?: { sourceSha256: string; transcriptSha256: string };
  approval: PlanApproval;
  hoverEnabled: boolean;
  shots: PlanShot[];
  conflicts: PlanConflict[];
  packages: PackageVersion[];
  appliedResultIds: string[];
  dismissedResultIds: string[];
  changes: ChangeRecord[];
  approvalRecord?: {
    status: PlanApproval;
    timing?: {
      status: "approved";
      files: Array<{ path: string; sha256: string }>;
    };
    shotIds?: string[];
    requirementVersions?: Record<string, number>;
    selection?: Record<string, unknown>;
  };
};
export type PlanResult = {
  aiVideoCandidateId?:string;aiVideoPromptVersion?:number;aiVideoCandidateSha256?:string;
  id: string;
  jobId: string;
  projectId: string;
  shotId?: string;
  slotId?: string;
  kind: "candidate" | "media" | "plan" | "match" | "alignment" | "template" | "delivery" | "footage" | "shot-revision" | "packageOperation";
  operation?:{schemaVersion:1;packageOrchestrationVersion:2;operationId:string;projectId:string;runId:string;branchId:string;attemptId:string;kind:'semanticPlan'|'template'|'footage'|'camera'|'captions'|'cover'|'aiVideo'|'sound'|'bgm';dependencyFingerprint:string;payload:unknown;payloadSha256:string;validationReceiptPath:string;validationReceiptSha256:string;readSet:Array<{path:string[];beforeHash:string}>;writeSet:Array<{path:string[];beforeHash:string}>;files:Array<{path:string;sha256:string}>;dependsOn:string[]};
  execution?: {kind:"footage";instructions:string};
  patches?: Array<{entity:string;id:string;field:string;before:unknown;after:unknown}>;
  gaps?: string[];
  footage?: {
    reviewPath: string;
    reviewSha256: string;
    candidateId: string;
    placementId: string | null;
  };
  delivery?: {
    manifestPath: string;
    manifestSha256: string;
    entryIndex: number;
    startSeconds: number;
    durationSeconds: number;
    transparent: boolean;
    timeBase: "project";
  };
  relatedShotIds?: string[];
  narration?: string;
  placementReview?: {passed:boolean;sourceCueIds?:number[];evidence?:string};
  template?: { id: EditorAssetId; props: Record<string, unknown> };
  requirementVersion?: number;
  target?: {
    instanceId?: string;
    rangeId?: string;
    startFrame: number;
    durationFrames: number;
  };
  candidate?: Candidate;
  media?: {
    sourceKind?: string;
    path: string;
    sourceInSeconds?: number;
    sourceOutSeconds?: number;
    editable?: boolean;
    preset?: { assetId: EditorAssetId; props: Record<string, unknown> };
  };
  plan?: ProductionPlan;
  technical?: { passed: boolean; details?: unknown };
  contentReview?: { passed: boolean; evidence?: unknown; frames?: unknown[] };
  reason?: string;
  state?: "pending" | "ready" | "stale" | "applied" | "ignored" | "conflict";
};
export type PackageBranchState={
  id:string;status:string;startedAt?:number;finishedAt?:number;error?:string;
  validation?:{status:'pending'|'passed'|'failed';validatorVersion?:number;receiptPath?:string|null};
  application?:{status:'not_required'|'waiting_dependencies'|'queued'|'applying'|'applied'|'preserved_manual'|'blocked'|'stale'|'cancelled';operationId?:string|null;receiptPath?:string|null;error?:string};
  reuse?:{status:string;originRunId?:string|null;originAttemptId?:string|null};
  metrics?:{bundleBytes:number;promptBytes:number;inputTokens:number|null;outputTokens:number|null};
};
export type PlanJob = {
  fullPackageVersion?:1;packageOrchestrationVersion?:2;bgmPlanVersion?:1;bgmExecutionVersion?:1;runId?:string;
  packageExecution?:{streamingApply:boolean;reusePolicy:'none'|'same-run'|'validated-project-artifacts'};
  earlyHandoff?:{status:'pending'|'ready'|'blocked';planPath?:string;promptPath?:string;receiptPath?:string;receiptSha256?:string;projectId?:string;runId?:string;planSha256?:string;currentPlanSha256?:string;publishedAt?:number;reason?:string};
  aiVideoCandidateId?:string;aiVideoPromptVersion?:number;
  packageBranches?:{version:number;runId:string;state:string;branches:PackageBranchState[];postStages?:{sound?:PackageBranchState}};
  deliveryManifestPath?: string;
  approvalRequests?: Array<{
    type: string;
    files?: Array<{ path: string; sha256: string }>;
    reason?: string;
  }>;
  choices?: Array<{ id: string; label?: string; previewPath?: string }>;
  shotId?: string;
  slotId?: string;
  instanceId?: string;
  rangeId?: string;
  id: string;
  projectId: string;
  kind: "package" | "broll" | "recognize" | "align" | "footage" | "revise";
  parentJobId?: string;
  executionJobId?: string;
  executionStatus?: PlanJob["status"];
  executionError?: string;
  outputs?: {
    footageReviewPath?: string;
    footageSummaryPath?: string;
    allCandidateManifestPath?: string;
    [key: string]: unknown;
  };
  status:
    | "queued"
    | "running"
    | "waiting_approval"
    | "waiting_selection"
    | "plan_only"
    | "partial"
    | "complete"
    | "failed"
    | "cancelling"
    | "cancelled"
    | "interrupted";
  stage: string;
  processed: number;
  total: number;
  snapshotPath: string;
  results: PlanResult[];
  error?: string;
  pid?: number;
  createdAt: string;
  updatedAt: string;
};
export type PlanOperation = { type: string; [key: string]: unknown };
