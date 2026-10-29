import type {EditorDocument} from '../../templates/remotion-base/src/editor/types';

export type RoughcutUnit = {
  id:string; text:string; startSeconds:number; endSeconds:number;
  timing?:'word'|'segment'; groupId?:string;
  completeSentence?:boolean; safeBoundaries?:boolean; protectionReasons?:string[];
};
export type RoughcutDecision = {
  id:string; unitIds:string[]; action:'keep'|'review'|'delete'; kind?:string;
  reason:string; keepUnitIds?:string[]; confidence?:number;
};
export type RoughcutAnalysis = {
  version:1; sourceKey:string; sourceDurationSeconds:number; timing:'word'|'segment';
  units:RoughcutUnit[]; silences:{startSeconds:number;endSeconds:number}[];
  captionOverrides?:Record<string,string>;
  editPlan?:{version:1;mode:'complete-takes';selections:{id:string;startUnitId:string;endUnitId:string;reason:string}[];omissions:{startUnitId:string;endUnitId:string;reason:string;kind:'retake'|'false_start'|'aside';coveredBySelectionIds:string[]}[];reviewNotes:string[]};
  decisions:RoughcutDecision[]; warnings?:string[]; protectedRanges?:{startSeconds:number;endSeconds:number;reason?:string}[];
};
export type RoughcutOptions = {minPauseSeconds?:number;keepPauseSeconds?:number};
export type RoughcutCut = {
  id:string; decisionId?:string; silenceIndex?:number; gapIndex?:number; gapStartSeconds?:number; gapEndSeconds?:number; kind:string; unitIds:string[];
  startFrame:number; endFrame:number; enabled:boolean; reason:string;
  /** Explicit editing provenance, not listening or user-approval evidence. */
  manual?:boolean;
  /** A model score; never a calibrated probability. */
  confidence:number|null; review:boolean; reviewReason:string; safeToEnable:boolean;
};
export type RoughcutState = {
  version:1; sourceKey:string;
  manualTimeline?:{version:1;clips:NonNullable<EditorDocument['source']>['clips'];durationFrames:number;fps:{num:number;den:number};fingerprint:string};
  original:{source:NonNullable<EditorDocument['source']>;fps:{num:number;den:number};canvasDurationFrames:number;timingToleranceSeconds:number;hadCaptions:boolean;captions?:EditorDocument['captions']};
  analysis:RoughcutAnalysis; options:Required<RoughcutOptions>;
  policy:{autoDeleteScore:number;confidenceMeaning:'uncalibrated-model-score';boundaryGuardSeconds:number;captionLayoutVersion?:1|2};
  cuts:RoughcutCut[]; warnings:string[]; baselineFingerprint:string; resultFingerprint:string;
};
export type RoughcutRow = RoughcutCut & {text:string;startSeconds:number;endSeconds:number;durationFrames:number;projectFrame:number};
export function roughcutSourceKey(document:EditorDocument):string;
export function createRoughcut(document:EditorDocument,analysis:RoughcutAnalysis,options?:RoughcutOptions):EditorDocument & {roughcut:RoughcutState};
export function setRoughcutCut(document:EditorDocument,cutId:string,patch:Partial<Pick<RoughcutCut,'enabled'|'startFrame'|'endFrame'>>):EditorDocument & {roughcut:RoughcutState};
export function adoptRoughcutCutManually(document:EditorDocument,cutId:string):EditorDocument & {roughcut:RoughcutState};
export function resetRoughcut(document:EditorDocument):EditorDocument;
export function roughcutSrt(document:EditorDocument):string;
export function roughcutRows(document:EditorDocument):RoughcutRow[];
export function validateRoughcut(state:unknown):true;
export function retimeRoughcutDocument(document:EditorDocument,retimed:EditorDocument):EditorDocument;

export function recordRoughcutTimeline(document:EditorDocument):EditorDocument;
export function restoreRoughcutCaptions(document:EditorDocument,revealed:null|{sourceInFrame:number;startFrame:number;durationFrames:number}):EditorDocument;
