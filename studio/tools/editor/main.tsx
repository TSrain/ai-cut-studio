import {ReviewPanel,ReviewScrubber} from './ReviewPanel';
import {renderDocument,renderDocumentKey} from './render-document.mjs';
import {usePreviewProxy} from './usePreviewProxy';
import {usePlanResources} from './usePlanResources';
import {getPlanPreviewView} from './production-plan-view-model.mjs';
import {calculatePlanPreviewLayout} from './plan-preview-layout.mjs';
import {PlanAnnotationHeading,PlanAnnotationRail} from './ProductionPlanAnnotations';
import {soundRecipes,templateSoundClip} from './sound-recipes.mjs';
import {assessProductionPlanExport} from '../lib/production-plan-export-model.mjs';
import {RoughcutPanel} from './RoughcutPanel';
import {ProductionPlanPanel,ProductionPlanEntry} from './ProductionPlanPanel';
import {useProductionPlan} from './useProductionPlan';
import {mergeServerDelta,syncPlanHistory,jsonEqual} from './production-plan-sync.mjs';
import {useBackdropDismiss} from './useBackdropDismiss';
import {ProjectMediaContext} from './ProjectMediaContext';
import {configureMediaClip} from './media-clip.mjs';
import {placeImportedMedia} from './timeline-media-import.mjs';
import {insertEmptyTrack} from './track-insertion.mjs';
import {defaultCoverRatio} from '../../templates/remotion-base/src/editor/cover-frame.mjs';
import {CoverPanel,coverApi,type CoverListing} from './CoverPanel';
import './cover-panel.css';
import {ProjectList} from './ProjectList';
import {ProjectMenu} from './ProjectMenu';
import {PanelResize} from './PanelResize';
import {AssetUsage} from './AssetUsage';
import {cameraTimelineCommand} from './caption-camera-model.mjs';
import {AudioControls} from './AudioControls';
import {reorderTrack,expandGroups,groupClips,ungroupClips,copyProperties,pasteProperties,adjacentEdit} from './p1-model.mjs';
import {createProjectAutosave,documentContentKey} from './autosave.mjs';
import {BackendVersionBanner} from './BackendVersionBanner';
import {ShortcutHelp,TransportRateBadge} from './ShortcutHelp';
import {reviewHotkeyCommand,transportReducer,initialTransport,isEditingTarget} from './review-hotkeys.mjs';
import {shouldGroupTranscriptEdit,editSpan} from './transcript-model.mjs';
import {revertRevision} from './revision-diff.mjs';
import {presenterBindingCurrent} from '../../templates/remotion-base/src/editor/behind-title.mjs';
import {sourceSegments} from '../../templates/remotion-base/src/editor/clip-time.mjs';
import {CaptionPanel} from './CaptionPanel';
import {captionSelectionForClick,captionSelectionCommand} from './caption-selection.mjs';
import {createCaptionPositionDrag} from './caption-canvas.mjs';
import {CaptionInspector} from './CaptionInspector';
import {captionSourceKey,validateCaptionTrack} from '../../templates/remotion-base/src/editor/captions.mjs';
import {draftKey,findDraft,removeRecoveredDraft} from './drafts.mjs';
import {ensureTimeline,timelineItems,selectionBounds,copySelection,pasteSelection,deleteSelection,splitSelection,placeInstance,placeAudio,trimClip,moveSelection} from './timeline-model.mjs';
import {ExportProgress} from './ExportProgress';
import {CameraControls} from './CameraControls';
import {cameraClips} from '../../templates/remotion-base/src/editor/camera-clips.mjs';
import {resolveMediaTarget} from './media-presets.mjs';
import {isMediaAsset,replaceMediaItem} from '../../templates/remotion-base/src/editor/media-layout.mjs';
import {assignPipMedia} from './pip-media.mjs';
import {pipPosition,positionPip} from '../../templates/remotion-base/src/editor/source-pip.mjs';
import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import { createRoot } from "react-dom/client";
import { Player, PlayerRef } from "@remotion/player";
import { EditorComposition } from "../../templates/remotion-base/src/editor/EditorComposition";
import {
  EDITOR_ASSETS,
  makeEditorInstance,
} from "../../templates/remotion-base/src/editor/assets";
import {
  editHistory,
  amendHistory,
  undoHistory,
  redoHistory,
  commitHistory,
  pushPastHistory,
  resizeTimeline,
  normalizeEditorSelection,
} from "./history.mjs";
import "./editor.css";
import "./studio.css";
import "./timeline-layout.css";
import "./workspace-chrome.css";
import { StudioLibrary, type StudioItem } from "./StudioLibrary";
import { StudioPreview } from "./StudioPreview";
import { DRAFT_KEY, encodeDraft, decodeDraft } from "./studio-state.mjs";
import { resolveEditableParts } from "../../templates/remotion-base/src/editor/preset-parts";
import { readPartText, writePartText } from "./parts.mjs";
const partsFor = (i: any): any[] =>
  !i
    ? []
    : i.assetId === "chapter-progress"
      ? [
          { id: "bar", label: "进度条" },
          ...(i.props.chapters || []).map((c) => ({
            id: c.id,
            label: c.title,
          })),
        ]
      : i.assetId === "chapter-navigation"
        ? [
            { id: "title", label: "总标题", slotKey: "title" },
            {
              id: "currentTitle",
              label: "当前章节标题",
              slotKey: "items",
              index: i.props.slots.activeIndex,
            },
            ...(i.props.slots.items || []).map((v, n) => ({
              id: "item-" + n,
              label: "章节 " + (n + 1),
              slotKey: "items",
              index: n,
            })),
            { id: "panel", label: "导航底板" },
          ]
        : resolveEditableParts(i.assetId, i.props);

import { createPlaybackClock } from "./playback-clock.mjs";
import { createTimelineHover } from "./timeline-hover.mjs";
import { PlaybackOverlay } from "./Playback";
import { Timeline } from "./Timeline";
import { Icon, IconButton } from "./Icon";
import { keyboardCommand, duplicateInstance, canvasDragPosition } from "./interaction.mjs";
import { ControlGestures } from "./Controls";
import { retimeEditorDocument } from "../lib/editor-framerate.mjs";
import { TemplatePreview, AspectControl } from "./TemplatePreview";
import { FilePicker } from "./FilePicker";
import { applyImportedSource } from "./import-document.mjs";
import { Inspector } from "./Inspector";
import { TemplateLibrary, ContentFields } from "./TemplateLibrary";
type Doc = any;
type Inst = any;
const uid = () => crypto.randomUUID();
const blank = (): Doc => ({
  schemaVersion: 1,
  id: uid(),
  name: "未命名作品",
  revision: 0,
  canvas: {
    width: 1920,
    height: 1080,
    fps: { num: 30, den: 1 },
    durationFrames: 300,
  },
  source: null,
  styleReference: {
    contractPath: null,
    styleframePath: null,
    allowedOverrides: {},
  },
  instances: [],
});
async function api(path: string, body?: unknown) {
  const res = await fetch("/api/editor/" + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) {const error:any=new Error(data.error || "请求失败");error.document=data.document;error.status=res.status;throw error;}
  return data;
}
const asset = (id: string) =>
  EDITOR_ASSETS.find((a: any) => a.id === id) as any;
const download = (name: string, value: string) => {
  const url = URL.createObjectURL(
    new Blob([value], { type: "text/plain;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
};
function Field({
  label,
  value,
  onChange,
  type = "number",
  min,
  max,
  step = 1,
}: any) {
  return (
    <div className="field">
      <label>{label}</label>
      <input
        aria-label={label}
        type={type}
        min={min}
        max={max}
        step={step}
        value={value ?? ""}
        placeholder="跟随模板"
        onChange={(e) => {
          const v = type === "number" ? Number(e.target.value) : e.target.value;
          if (type !== "number" || Number.isFinite(v)) onChange(v);
        }}
      />
    </div>
  );
}
class PreviewBoundary extends React.Component<
  { children: React.ReactNode; revisionKey: string },
  { error: string | null }
> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  componentDidUpdate(prev: any) {
    if (prev.revisionKey !== this.props.revisionKey && this.state.error)
      this.setState({ error: null });
  }
  render() {
    return this.state.error ? (
      <div className="empty">
        预览参数有误：{this.state.error}。可撤销刚才的修改或恢复默认。
      </div>
    ) : (
      this.props.children
    );
  }
}
function App() {
  const [history, setHistory] = useState(() => ({
    past: [],
    present: blank(),
    future: [],
  }));
  const doc: Doc = useMemo(()=>ensureTimeline(history.present),[history.present]);
  const [reviewMode,setReviewMode]=useState(false);
  const [reviewPreview,setReviewPreview]=useState<any>(null);
  const reviewVideo=useRef<HTMLVideoElement>(null);
  const reviewContentKey=renderDocumentKey(doc);
  const reviewCached=reviewMode&&reviewPreview?.contentKey===reviewContentKey;
  useEffect(()=>{if(!reviewCached)player.current?.seekTo(playback.getSnapshot());},[reviewCached]);
  const current = useRef(doc);
  current.current = doc;
  const [planSelected,setPlanSelected]=useState('');
  const [planAcknowledged,setPlanAcknowledged]=useState(false);
  const planExportReport=useMemo(()=>assessProductionPlanExport(doc),[doc]);
  const planExportKey=JSON.stringify([doc.id,planExportReport.missing,planExportReport.emptyRanges]);
  useEffect(()=>setPlanAcknowledged(false),[planExportKey]);
  const [libraryTab, setLibraryTab] = useState("templates");
  const [showSourceWaveform,setShowSourceWaveform]=useState(false);
  const [captionSelected,rawSetCaptionSelected]=useState('');
  const [captionIds,setCaptionIds]=useState<string[]>([]);
  const captionAnchor=useRef('');
  const captionDragCancel=useRef<null|(()=>void)>(null);
  useEffect(()=>()=>captionDragCancel.current?.(),[doc.id]);
  const setCaptionSelected=(id:string)=>{rawSetCaptionSelected(id);setCaptionIds(id?[id]:[]);captionAnchor.current=id;};
  useEffect(()=>{setCaptionSelected('');},[doc.id]);
  useEffect(()=>{const valid=new Set(doc.captions?.cues.map(c=>c.id)??[]);setCaptionIds(ids=>{const next=ids.filter(id=>valid.has(id));return next.length===ids.length?ids:next;});if(captionSelected&&!valid.has(captionSelected))rawSetCaptionSelected(captionIds.filter(id=>valid.has(id)).at(-1)??'');if(!valid.has(captionAnchor.current))captionAnchor.current='';},[doc.captions?.cues]);
  const [captionJob,setCaptionJob]=useState<any>(null);
  const [pendingCaptions,setPendingCaptions]=useState<any>(null);
  const captionRequest=useRef<any>(null);
  const appliedCaptionJob=useRef('');
  const [mediaPreview, setMediaPreview] = useState<StudioItem | null>(null);
  const [libraryRefresh, setLibraryRefresh] = useState(0);
  const [cameraSelected,setCameraSelected]=useState('');
  const [cameraOccurrence,setCameraOccurrence]=useState<any>(null);
  const [batchDelta,setBatchDelta]=useState(0);
  const isLocked=(id:string,d:any=current.current)=>!!timelineItems(d).find(i=>i.key===id)?.locked;
  const sourceParts=sourceSegments(doc.source,doc.canvas.durationFrames);
  const sourceMapped=!!doc.source&&(sourceParts.length!==1||sourceParts[0]?.startFrame!==0||sourceParts[0]?.sourceInFrame!==doc.source.startFrame);
  const cameraPreviewStop=useRef<null|(()=>void)>(null);
  useEffect(()=>()=>cameraPreviewStop.current?.(),[]);
  const [projectPanel,setProjectPanel]=useState<'captions'|'camera'|'plan'|'roughcut'|null>(null);
  const roughcutPreviewStop=useRef<null|(()=>void)>(null);
  useEffect(()=>()=>roughcutPreviewStop.current?.(),[doc.id]);
  const cameraCount=useMemo(()=>{try{return cameraClips(doc.source?.cameraPlan).length;}catch{return null;}},[doc.source?.cameraPlan]);
  const [manager, setManager] = useState("");
  const [draftStatus, setDraftStatus] = useState("");
  const [saveStatus,setSaveStatus]=useState<any>({state:'idle'});
  const saveBridge=useRef<any>({});
  const [autosave]=useState(()=>createProjectAutosave({read:()=>current.current,write:document=>api('save',{document}),accept:(result,snapshot)=>saveBridge.current.accept(result,snapshot),onStatus:status=>setSaveStatus(status)}));
  const pointerEditing=useRef(false),dirtyRef=useRef(false);
  const [draftTab] = useState(()=>crypto.randomUUID());
  const recoveredDraft=useRef<any>(null);
  const [recovery, setRecovery] = useState(() => {
    try {
      return findDraft(localStorage,new URLSearchParams(location.search).get("document"));
    } catch {
      return null;
    }
  });
  const [modal, setModal] = useState("");
  const [covers,setCovers]=useState<CoverListing|null>(null);
  const [coverError,setCoverError]=useState('');
  const coverRequest=useRef(0);
  const refreshCovers=useCallback(async()=>{
    const id=current.current.id,request=++coverRequest.current;
    if(!current.current.revision)return;
    try{const result=await coverApi('covers?id='+encodeURIComponent(id));if(current.current.id===id&&request===coverRequest.current){setCovers(result);setCoverError('');}}
    catch(e){if(current.current.id===id&&request===coverRequest.current)setCoverError(e.message);throw e;}
  },[]);
  useEffect(()=>{
    setCovers(null);setCoverError('');
    const refresh=()=>{if(document.visibilityState==='visible')void refreshCovers().catch(()=>{});};
    refresh();const timer=window.setInterval(refresh,10000);window.addEventListener('focus',refresh);
    return ()=>{window.clearInterval(timer);window.removeEventListener('focus',refresh);};
  },[doc.id,!!doc.revision,refreshCovers]);
  const coverRatio=defaultCoverRatio(doc);
  const coverCandidateCount=covers?.runs[0]?.groups.length??0;
  const hasCover=!!doc.cover||coverCandidateCount>0;
  const coverThumbnail=doc.cover?'/'+doc.cover.publicPath:covers?.runs[0]?.groups[0]?.images[coverRatio];
  const openCovers=()=>run(async()=>{player.current?.pause();await save();await refreshCovers().catch(()=>{});setModal('cover');});
  useEffect(() => {
    if (!recovery && !manager && !modal) return;
    const dialog = document.querySelector<HTMLElement>(
      recovery ? ".recovery-backdrop" : manager ? ".studio-manager-backdrop" : ".modal-bg",
    );
    if (!dialog) return;
    const siblings = Array.from(dialog.parentElement!.children).filter(
      (node) => node !== dialog && node instanceof HTMLElement,
    ) as HTMLElement[];
    const previousFocus=document.activeElement as HTMLElement;
    const previous = siblings.map((node) => node.inert);
    siblings.forEach((node) => {
      node.inert = true;
    });
    const focusable = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), iframe, [href], input:not(:disabled), [tabindex="0"]',
        ),
      ).filter((node) => node.offsetParent !== null);
    focusable()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusable(),
        first = items[0],
        last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    dialog.addEventListener("keydown", trap);
    return () => {
      siblings.forEach((node, index) => {
        node.inert = previous[index];
      });
      dialog.removeEventListener("keydown", trap);
      previousFocus?.focus?.({preventScroll:true});
    };
  }, [recovery, manager,modal]);
  const closePreview = () => {
    setPreviewAsset("");
    setMediaPreview(null);
  };
  const closeManager = () => {setManager("");setLibraryRefresh(v=>v+1);};
  const modalBackdrop = useBackdropDismiss(() => setModal(""));
  const managerBackdrop = useBackdropDismiss(closeManager);
  const previewBackdrop = useBackdropDismiss(closePreview);
  const openManager = (section: string) => {
    player.current?.pause();
    setManager(section);
  };
  const previewMedia = (item: StudioItem) => {
    player.current?.pause();
    setPreviewAsset("");
    setMediaPreview(item);
  };
  const previewTemplate = (id: string) => {
    player.current?.pause();
    setMediaPreview(null);
    setPreviewAsset(id);
  };

  const [selected, rawSetSelected] = useState("");
  const [selection,setSelection]=useState<string[]>([]);
  const clipboard=useRef<any>(null),propertyClipboard=useRef<any>(null);
  const [looping,setLooping]=useState(false);
  const rangePlayback=useRef<any>(null);
  const [follow,setFollow]=useState(false);
  const setSelected=(id:string)=>{setProjectPanel(null);setCaptionSelected('');setCameraSelected('');rawSetSelected(id);setSelection(id?expandGroups(current.current,[id]):[]);};
  const selectMany=(ids:string[])=>{setProjectPanel(null);ids=expandGroups(current.current,ids);setSelection(ids);rawSetSelected(ids.at(-1)||'');setCameraSelected('');setCaptionSelected('');setPart('group');closePreview();};
  const [mediaSelection,setMediaSelection]=useState({documentId:'',instanceId:'',itemId:''});
  const mediaSelectionRef=useRef(mediaSelection);mediaSelectionRef.current=mediaSelection;
  const selectedInstanceRef=useRef(selected);selectedInstanceRef.current=selected;
  const [previewAsset, setPreviewAsset] = useState("");
  const [exportFps, setExportFps] = useState(30);
  const [exportSubmitting, setExportSubmitting] = useState("");
  const clearSelection = () => {
    setSelected("");
    setPart("group");
    setPreviewAsset("");
    setMediaPreview(null);
  };
  useEffect(() => {
    if (selected) {
      setPreviewAsset("");
      setMediaPreview(null);
    }
  }, [selected]);
  const [part, setPart] = useState("group");
  const [playback] = useState(createPlaybackClock);
  const [playing, setPlaying] = useState(false);
  // J/K/L transport: signed Remotion playbackRate (negative = reverse) and its state machine.
  const [playRate, setPlayRate] = useState(1);
  const transport = useRef(initialTransport());
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [snap, setSnap] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(false);
  const [savedList, setSavedList] = useState<any[]>([]);
  const [srt, setSrt] = useState("");
  const [cues, setCues] = useState<any[]>([]);
  const [prompt, setPrompt] = useState("");
  const [summary, setSummary] = useState("");
  const [chapterJob, setChapterJob] = useState<any>(null);
  const chapterContext = useRef("");
  const [job, setJob] = useState<any>(null);
  const [clipTarget,setClipTarget]=useState<any>(null);
  const [exportMode, setExportMode] = useState("instances");
  const [busy, setBusy] = useState(false);
  const recoveryBackdrop = useBackdropDismiss(() => setRecovery(null), busy);
  const [dirty, setDirty] = useState(false);
  const [globalEdit, setGlobalEdit] = useState(false);
  const player = useRef<PlayerRef>(null);
  const [hoverPreview] = useState(()=>createTimelineHover({
    clock:playback,
    seekTo:frame=>player.current?.seekTo(frame),
    getDuration:()=>current.current.canvas.durationFrames,
    isPlaying:()=>player.current?.isPlaying()??false,
  }));
  useEffect(()=>{hoverPreview.reset();},[doc.id,hoverPreview]);
  useEffect(()=>{if(modal||manager||mediaPreview||previewAsset||recovery)hoverPreview.cancel();},[modal,manager,mediaPreview,previewAsset,recovery,hoverPreview]);
  const playerCleanup = useRef<() => void>();
  const [buffering, setBuffering] = useState(false);
  const [previewRecovery, setPreviewRecovery] = useState(0);
  const bindPlayer = useCallback(
    (p: PlayerRef | null) => {
      playerCleanup.current?.();
      player.current = p;
      if (!p) return;
      const handlers: any = {
        frameupdate: (e: any) => hoverPreview.receiveFrame(e.detail.frame),
        play: () => {hoverPreview.startPlayback();setPlaying(true);},
        pause: () => {
          hoverPreview.receiveFrame(p.getCurrentFrame());
          setPlaying(false);
          // Any stop (K, Space, end of media, preview loops) resets the shuttle to 1×.
          transport.current = transportReducer(transport.current, { type: "stopped" }).state;
          setPlayRate(1);
        },
        waiting: () => setBuffering(true),
        resume: () => setBuffering(false),
        error: (e: any) => {
          setPlaying(false);
          setBuffering(false);
          setNotice("预览失败：" + e.detail.error.message);
          setError(true);
        },
      };
      for (const [event, fn] of Object.entries(handlers))
        p.addEventListener(event as any, fn as any);
      playerCleanup.current = () => {
        for (const [event, fn] of Object.entries(handlers))
          p.removeEventListener(event as any, fn as any);
      };
    },
    [playback,hoverPreview],
  );

  const stage = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ width: 640, height: 400 });
  const fps = doc.canvas.fps.num / doc.canvas.fps.den;
  const instance: Inst = doc.instances.find((i: Inst) => i.id === selected);
  const audioClip=doc.audioClips?.find(c=>`audio/${c.id}`===selected);
  const notify = (text: string, isError = false) => {
    setNotice(text);
    setError(isError);
  };
  useEffect(() => {
    if (!notice || error || busy) return;
    const timer = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [notice, error, busy]);
  const controlBase = useRef<Doc | null>(null);
  const controlGestures = {
    start: () => {
      controlBase.current ||= structuredClone(current.current);
    },
    end: () => {
      const base = controlBase.current;
      controlBase.current = null;
      if (base && !jsonEqual(base, current.current))
        setHistory((h) => pushPastHistory(h, base));
    },
  };
  const apply = (next: Doc) => {
    next=ensureTimeline(next);
    current.current = next;
    setHistory((h) =>
      controlBase.current ? { ...h, present: next } : editHistory(h, next),
    );
    setDirty(true);
  };
  // Transcript edits: one undo step per operation; rapid same-kind edits on adjacent text merge.
  const transcriptLast = useRef<any>(null);
  const applyTranscriptEdit = (result: any) => {
    const now = Date.now(), span = editSpan(result.ranges), previous = transcriptLast.current;
    const fps = current.current.canvas.fps.num / current.current.canvas.fps.den;
    const group = shouldGroupTranscriptEdit(previous, { kind: result.kind, span }, { now, present: current.current, fps,
      same: (a: any, b: any) => a === b || jsonEqual({ ...a, revision: 0, assetSourceHash: 0 }, { ...b, revision: 0, assetSourceHash: 0 }) });
    const next = ensureTimeline(result.document);
    current.current = next;
    setHistory((h) => (group ? amendHistory(h, next) : editHistory(h, next)));
    setDirty(true);
    transcriptLast.current = { kind: result.kind, at: now, document: next,
      span: group ? { startFrame: Math.min(previous.span.startFrame, span.startFrame), endFrame: Math.max(previous.span.endFrame, span.endFrame) } : span };
  };
  const mutate = (fn: (next: Doc) => void) => {
    const next = structuredClone(current.current);
    fn(next);
    apply(next);
  };
  const selectCaption=(id:string|string[],options:any={})=>{
    const cues=current.current.captions?.cues??[];
    const next=Array.isArray(id)?{ids:id,anchor:id[0]??'',active:id.at(-1)??''}:id&&!cues.some(c=>c.id===id)?{ids:[id],anchor:id,active:id}:captionSelectionForClick(cues,captionIds,captionAnchor.current,id,options);
    selectMany([]);setCaptionIds(next.ids);rawSetCaptionSelected(next.active);captionAnchor.current=next.anchor;
    if(projectPanel==='captions'||!next.ids.length)setProjectPanel('captions');setCameraSelected('');closePreview();
  };
  const applyCaptionTrack=(track:any)=>{validateCaptionTrack(track,{durationFrames:current.current.canvas.durationFrames});mutate(d=>{d.captions=track;});};
  const startCaptions=async(polish=false)=>{
    try{const saved=await save();captionRequest.current={documentId:saved.id,key:captionSourceKey(saved),captions:JSON.stringify(saved.captions??null)};setPendingCaptions(null);setCaptionJob(await api('captions/start',{documentId:saved.id,polish}));}
    catch(e:any){notify(e.message,true);}
  };
  const applyPendingCaptions=()=>{
    const next=pendingCaptions;if(!next)return;
    if(current.current.id!==next.documentId||captionSourceKey(current.current)!==next.sourceKey){notify('底片或剪辑时间已变化，请重新识别字幕',true);return;}
    applyCaptionTrack({...next.track,style:current.current.captions?.style??next.track.style});setPendingCaptions(null);selectCaption(next.track.cues[0]?.id??'');notify('已替换字幕，可撤销');
  };
  useEffect(()=>{
    if(captionJob?.status!=='running')return;let active=true,fetching=false;
    const poll=async()=>{if(fetching)return;fetching=true;try{
      const next=await api('captions/job?id='+captionJob.id);if(!active)return;setCaptionJob(next);
      if(next.status==='complete'&&appliedCaptionJob.current!==next.id){
        appliedCaptionJob.current=next.id;
        if(current.current.id!==next.documentId||captionSourceKey(current.current)!==next.sourceKey){notify('识别完成，但底片或时间轴已变化；未覆盖当前字幕，请重新识别',true);return;}
        if(JSON.stringify(current.current.captions??null)!==captionRequest.current?.captions){setPendingCaptions(next);notify('识别完成，请确认是否替换你刚修改的字幕');return;}
        applyCaptionTrack({...next.track,style:current.current.captions?.style??next.track.style});selectCaption(next.track.cues[0]?.id??'');notify('字幕已添加到独立轨道，点选任意一条即可修正');
      }
    }catch(e:any){if(active){setCaptionJob((j:any)=>({...j,status:'failed',stage:'failed',error:e.message}));notify(e.message,true);}}finally{fetching=false;}};
    const timer=setInterval(poll,1000);return()=>{active=false;clearInterval(timer);};
  },[captionJob?.id,captionJob?.status]);
  const selectCamera=(id:string,occurrence?:any)=>{setSelected('');setProjectPanel('camera');setCameraSelected(id);setCameraOccurrence(occurrence??null);setPart('group');closePreview();};
  const openProjectPanel=(panel:'captions'|'camera'|'roughcut')=>{
    clearSelection();setProjectPanel(panel);
  };
  const importProjectSource=(meta:any)=>{
    const resized=applyImportedSource(current.current,meta);
    apply(resized);seek(0);setCues([]);setPrompt('');setSummary('');
    notify(`已导入 ${meta.name} · ${meta.aspectLabel} · ${resized.canvas.width} × ${resized.canvas.height}；后续动画跟随底片画幅。`);
    setModal('');
  };
  const previewCamera=(clip:any)=>{cameraPreviewStop.current?.();seek(clip.displayStart??Math.round(clip.start*fps));const end=clip.displayEnd??Math.round((clip.start+clip.in+clip.hold+clip.out)*fps);const stop=playback.subscribe(()=>{if(playback.getSnapshot()>=end){player.current?.pause();stop();cameraPreviewStop.current=null;}});cameraPreviewStop.current=stop;player.current?.play();};
  const updateInstance = (fn: (i: Inst) => void) =>
    mutate((d) => {
      const i = d.instances.find((x: Inst) => x.id === selected);
      if (i && !isLocked(i.id,d)) fn(i);
    });
  const runTransport = (input: any) => {
    const { state, effect } = transportReducer(transport.current, input);
    transport.current = state;
    if (!effect) return;
    const video=reviewVideo.current;
    if(video){
      if(effect.kind==='step'){video.pause();seek(playback.getSnapshot()+effect.delta);return;}
      if(effect.rate<=0){video.pause();if(effect.rate<0){const frame=playback.getSnapshot();setReviewPreview(null);player.current?.seekTo(frame);setPlayRate(effect.rate);requestAnimationFrame(()=>player.current?.play());}return;}
      video.playbackRate=effect.rate;void video.play().catch(()=>{});return;
    }
    if (effect.kind === "step") { player.current?.pause(); seek(playback.getSnapshot() + effect.delta); transport.current = state; return; }
    if (effect.rate === 0) { player.current?.pause(); return; }
    setPlayRate(effect.rate);
    if (!player.current?.isPlaying()) requestAnimationFrame(() => { player.current?.play(); transport.current = { ...transport.current, rate: effect.rate }; });
  };
  const transportRun = useRef<(input: any) => void>(() => {});
  transportRun.current = runTransport;
  useEffect(() => {
    const up = (e: KeyboardEvent) => { if (e.key.toLowerCase() === "k") transportRun.current({ type: "up", key: "k" }); };
    const blur = () => transportRun.current({ type: "up", key: "k" });
    window.addEventListener("keyup", up); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, []);
  /** Review "S": split the main-video clip under the playhead (undoable, rough-cut aware). */
  const splitSourceAtPlayhead = () => {
    const d = current.current, frame = playback.getSnapshot();
    const clip = d.source?.clips?.find((c: any) => frame > c.startFrame && frame < c.startFrame + c.durationFrames);
    if (!clip) return "播放头不在主视频片段内部，无法分割";
    if (d.source.locked || clip.locked) return "主视频已锁定";
    try {
      const next = splitSelection(d, [`source/${clip.id}`], frame, uid);
      if (jsonEqual(next, d)) return "此处无法分割";
      player.current?.pause(); apply(next);
      return "已在播放头分割主视频（可撤销）";
    } catch (e: any) { return e.message; }
  };
  const seek = (n: number) => {
    const f = Math.max(
      0,
      Math.min(current.current.canvas.durationFrames - 1, Math.round(n)),
    );
    if(reviewVideo.current){reviewVideo.current.currentTime=f/fps;playback.setFrame(f);}
    hoverPreview.seek(f);
  };
  const playSelection=(repeat:boolean)=>{
    if(looping&&!repeat){rangePlayback.current=null;setLooping(false);player.current?.pause();return;}
    const bounds=selectionBounds(current.current,selection);if(!bounds)return;
    rangePlayback.current={...bounds,repeat};setLooping(repeat);seek(bounds.start);player.current?.play();
  };
  useEffect(()=>playback.subscribe(()=>{const r=rangePlayback.current;if(!r)return;const f=playback.getSnapshot();if(f>=r.end-1){if(r.repeat){player.current?.seekTo(r.start);}else{rangePlayback.current=null;player.current?.pause();}}}),[playback]);
  useEffect(()=>{rangePlayback.current=null;setLooping(false);},[doc.id]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e: any) {
      notify(e.message, true);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!stage.current) return;
    const observer = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setStageSize({
        width: Math.max(1, r.width),
        height: Math.max(1, r.height),
      });
    });
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!dirty || recovery) return;
    const store = () => {
      try {
        localStorage.setItem(
          draftKey(current.current.id,draftTab),
          encodeDraft(current.current, playback.getSnapshot()),
        );
        setDraftStatus("草稿已保护");
      } catch {
        setDraftStatus("草稿空间不足，请检查自动保存状态");
      }
    };
    const timer = setTimeout(store, 450);
    window.addEventListener("pagehide", store);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pagehide", store);
    };
  }, [doc, dirty, recovery]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (shortcutsOpen && e.key === "Escape") { e.preventDefault(); setShortcutsOpen(false); return; }
      if (!manager && !mediaPreview && !previewAsset && !recovery) {
        const review = reviewHotkeyCommand(e, { editing: isEditingTarget(e.target), modal: !!modal });
        if (review === "help") { e.preventDefault(); setShortcutsOpen((open) => !open); return; }
        if (review?.startsWith("transport-")) { e.preventDefault(); transportRun.current({ type: "down", key: review.slice(-1), repeat: e.repeat }); return; }
      }
      if (manager || modal || mediaPreview || previewAsset || recovery) {
        if (e.key === "Escape") {
          e.preventDefault();
          if (recovery) {if (!busy) setRecovery(null);}
          else if (modal) setModal("");
          else if (manager) closeManager();
          else closePreview();
        }
        return;
      }
      const command = keyboardCommand(e, {
        editing: !!(e.target as HTMLElement)?.closest(
          'input,textarea,select,[contenteditable="true"]',
        ),
        modal: !!modal,
        selected: selection.length>0||!!cameraSelected||!!captionSelected,
        timeline: !!(e.target as HTMLElement)?.closest(".timeline"),
        captions: captionIds.length>0,
      });
      if (!command) return;
      e.preventDefault();
      if(command==='previousEdit'||command==='nextEdit')seek(adjacentEdit(doc,playback.getSnapshot(),command==='previousEdit'?-1:1));
      else if(command==='group'||command==='ungroup')timelineCommand(command);
      else if (["copy","cut","paste","split","selectAll"].includes(command)) timelineCommand(command);
      else if (command === "delete") removeSelected();
      else if (command === "duplicate") duplicateSelected();
      else if (command === "undo" || command === "redo") {
        setHistory((h) =>
          command === "undo" ? undoHistory(h) : redoHistory(h),
        );
        setDirty(true);
      } else if (command === "save")
        run(async () => {
          await save();
        });
      else if (command === "escape") {
        setModal("");
        setPreviewAsset("");
        setSelected("");
        setPart("group");
      } else if (command === "toggle") {const video=reviewVideo.current;if(video){if(video.paused)void video.play().catch(()=>{});else video.pause();}else player.current?.toggle();}
      else
        seek(
          command === "start"
            ? 0
            : command === "end"
              ? doc.canvas.durationFrames - 1
              : playback.getSnapshot() +
                ({ back: -1, back10: -10, forward: 1, forward10: 10 }[
                  command
                ] || 0),
        );
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    shortcutsOpen,
    playback,
    doc,
    selected,
    selection,
    cameraSelected,captionSelected,captionIds,
    modal,
    manager,
    mediaPreview,
    previewAsset,
    recovery,
    busy,
  ]);
  useEffect(() => {
    if (!dirty) return;
    const fn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", fn);
    return () => window.removeEventListener("beforeunload", fn);
  }, [dirty]);
  useEffect(() => {
    if(selected.startsWith("audio/")){if(!doc.audioClips?.some(c=>`audio/${c.id}`===selected))setSelected("");return;}
    if(selected.startsWith("source/")){if(!doc.source?.clips?.some(c=>`source/${c.id}`===selected))setSelected("");return;}
    const normalized = normalizeEditorSelection(doc, selected, part, [
      "all-text",
      ...partsFor(doc.instances.find((i) => i.id === selected)).map(
        (p) => p.id,
      ),
    ]);
    if (normalized.selected !== selected) setSelected(normalized.selected);
    if (normalized.part !== part) setPart(normalized.part);
  }, [doc.instances,doc.source,doc.audioClips, selected, part]);
  useEffect(() => {
    if (!job || !["running","cancelling"].includes(job.status)) return;
    const timer = setInterval(
      () =>
        api("job?id=" + job.id)
          .then(setJob)
          .catch((e: any) => notify(e.message, true)),
      1000,
    );
    return () => clearInterval(timer);
  }, [job?.id, job?.status]);
  useEffect(() => {
    if (!chapterJob || chapterJob.status !== "running") return;
    const timer = setInterval(
      () =>
        api("chapters/job?id=" + chapterJob.id)
          .then((r) => {
            setChapterJob(r);
            if (r.status === "complete") {
              if (
                chapterContext.current !==
                JSON.stringify({
                  id: current.current.id,
                  canvas: current.current.canvas,
                })
              ) {
                notify(
                  "章节已生成，但当前项目或画幅已改变，请在原项目重新应用。",
                  true,
                );
                setSummary(
                  JSON.stringify(
                    r.chapters.map((c: any) => ({
                      title: c.title,
                      sourceCueIds: c.sourceCueIds,
                    })),
                  ),
                );
                return;
              }
              setCues(r.cues);
              mutate((d) => {
                let progress = d.instances.find(
                  (i: Inst) => i.assetId === "chapter-progress",
                );
                if (!progress) {
                  progress = makeEditorInstance("chapter-progress", d, 0);
                  d.instances.push(progress);
                }
                progress.props.chapters = r.chapters;
                progress.props.sourceCues = r.cues;
              });
              notify("已按字幕语义生成章节，并对应原片时间");
            } else if (r.status === "failed") notify(r.error, true);
          })
          .catch((e: any) => notify(e.message, true)),
      1200,
    );
    return () => clearInterval(timer);
  }, [chapterJob?.id, chapterJob?.status]);
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("document");
    if (id)
      api("load?id=" + encodeURIComponent(id))
        .then((loaded) => {
          setHistory({
            past: [],
            present: retimeEditorDocument(loaded, 30),
            future: [],
          });
          clearSelection();
          notify("已载入控制台中的资产参数");
        })
        .catch((e: any) => notify(e.message, true));
  }, []);
  saveBridge.current.accept=(result:any,snapshot:any)=>{
    if(current.current.id!==snapshot.id)return;
    const changed=documentContentKey(current.current)!==documentContentKey(snapshot);
    const next=ensureTimeline(mergeServerDelta(snapshot,current.current,result));
    current.current=next;
    setHistory(h=>h.present.id===snapshot.id?{...syncPlanHistory(h,snapshot,result,true),present:next}:h);
    setDirty(changed);dirtyRef.current=changed;
    const url=new URL(location.href);url.searchParams.set('document',next.id);window.history.replaceState(null,'',url);
    if(!changed){try{localStorage.removeItem(draftKey(snapshot.id,draftTab));removeRecoveredDraft(localStorage,recoveredDraft.current);recoveredDraft.current=null;}catch{}setDraftStatus('已保存到项目');}
  };
  dirtyRef.current=dirty;
  useEffect(()=>{if(dirty&&!recovery&&!pointerEditing.current&&!controlBase.current)autosave.schedule();},[doc,dirty,recovery]);
  useEffect(()=>{
    const down=()=>{pointerEditing.current=true;autosave.pause();};
    const up=()=>{pointerEditing.current=false;autosave.resume();if(dirtyRef.current&&!recovery)autosave.schedule();};
    const online=()=>{if(dirtyRef.current&&!recovery)autosave.schedule();};
    window.addEventListener('pointerdown',down,true);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);window.addEventListener('blur',up);window.addEventListener('online',online);
    return()=>{window.removeEventListener('pointerdown',down,true);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);window.removeEventListener('blur',up);window.removeEventListener('online',online);};
  },[recovery]);
  useEffect(()=>()=>autosave.dispose(),[]);
  const save = async (saveAs = false) => {
    if(!saveAs)return autosave.flush({force:true});
    autosave.cancel();await autosave.settled();
    const snapshot=structuredClone(current.current),result=await api('save',{document:snapshot,saveAs:true});
    if(current.current.id!==snapshot.id)return result;
    const changed=documentContentKey(current.current)!==documentContentKey(snapshot);
    const next=ensureTimeline({... (changed?current.current:result),id:result.id,revision:result.revision,assetSourceHash:result.assetSourceHash});
    current.current=next;setHistory({past:[],present:next,future:[]});setDirty(changed);setSaveStatus({state:'saved',id:next.id});
    const url=new URL(location.href);url.searchParams.set('document',next.id);window.history.replaceState(null,'',url);
    notify('已创建独立副本，原项目仍在「项目列表」中');return result;
  };
  const productionPlan=useProductionPlan({document:doc,getDocument:()=>current.current,save:()=>autosave.flush({force:true}),canSync:()=>!pointerEditing.current&&!controlBase.current,onSync:({base,document:remote,mode,expected}:any)=>{
    if(current.current.id!==remote.id)return;
    const next=ensureTimeline(mergeServerDelta(base,current.current,remote));
    current.current=next;
    setHistory(h=>{
      if(h.present.id!==remote.id)return h;
      if(mode==='media-action')return syncPlanHistory(h,base,remote,true);
      if(mode==='action'){
        const rebased=syncPlanHistory(h,expected??remote,remote);
        return editHistory(rebased,ensureTimeline(mergeServerDelta(base,h.present,remote)));
      }
      return syncPlanHistory(h,base,remote,true);
    });
    const unsaved=documentContentKey(next)!==documentContentKey(remote);setDirty(unsaved);dirtyRef.current=unsaved;
    if(unsaved)autosave.schedule();
  }});
  const planResources=usePlanResources(doc);
  const selectPlan=(shotId:string,startFrame?:number)=>{
    setSelected('');setCaptionSelected('');setCameraSelected('');setPlanSelected(shotId);setProjectPanel('plan');closePreview();
    const shot=current.current.productionPlan?.shots.find(s=>s.id===shotId);
    const frame=startFrame??shot?.timing.ranges[0]?.startFrame;
    if(frame!==undefined){player.current?.pause();seek(frame);}
  };
  useEffect(()=>{setPlanSelected('');},[doc.id]);
  useEffect(()=>{if(planSelected&&!doc.productionPlan?.shots.some(s=>s.id===planSelected&&!s.cancelled))setPlanSelected('');},[doc.productionPlan?.shots,planSelected]);
  const [recognitionSubmissions, setRecognitionSubmissions] = useState<any[]>([]);
  const recognizeImported=async(files:any[])=>{
    if(!current.current.productionPlan)throw Error('素材已入库；当前工程没有制作计划，未启动自动识别');
    const batch={id:crypto.randomUUID(),projectId:current.current.id,mediaIds:files.map(f=>f.id).filter(Boolean)};
    setRecognitionSubmissions(rows=>[...rows,batch]);
    try{return await productionPlan.startJob('recognize',{mediaPaths:files.map(f=>f.path||f.stagedPath||f.publicPath).filter(Boolean),mediaIds:batch.mediaIds});}
    finally{setRecognitionSubmissions(rows=>rows.filter(row=>row.id!==batch.id));}
  };
  const [presenterBusy,setPresenterBusy]=useState('');
  const [presenterError,setPresenterError]=useState('');
  const preparePresenter=async (instanceId:string)=>{
    const snapshot=JSON.parse(JSON.stringify(current.current));
    const target=snapshot.instances.find((i:any)=>i.id===instanceId);if(!target||isLocked(instanceId))return;
    setPresenterBusy(instanceId);setPresenterError('');notify('正在本机自动抠出人物…');
    try{
      const started=await api('presenter/start',{document:snapshot,instanceId});
      let job=started;
      while(job.status==='running'){await new Promise(r=>setTimeout(r,1000));job=await api('presenter/job?id='+encodeURIComponent(started.id));}
      if(job.status!=='completed')throw Error(job.error||'人物前景准备失败');
      const live=current.current.instances.find(i=>i.id===instanceId);
      if(!presenterBindingCurrent(snapshot,target,current.current,live)||isLocked(instanceId))throw Error('准备期间底片、区间或轨道已改变，请重新准备');
      mutate(d=>{const i=d.instances.find(i=>i.id===instanceId);if(i){i.props={...i.props,presenterLayer:'behind',presenterForeground:job.manifest,editorBackground:'transparent'};delete i.props.sceneBackground;}});
      notify('人物前景已准备，文字会被人物遮挡，可调整字号和位置。');
    }catch(e:any){setPresenterError(e.message);notify('抠像未完成：'+e.message);}
    finally{setPresenterBusy('');}
  };
  const add = (id: string) => {
    player.current?.pause();
    const frame = playback.getSnapshot();
    hoverPreview.seek(frame);
    closePreview();
    const item = makeEditorInstance(id, doc, frame);
    apply(placeInstance(current.current,item,doc.instances.find(i=>i.id===selected)?.trackId));
    setSelected(item.id);
    setPart(
      partsFor(item).find((p) => !["bar", "panel"].includes(p.id))?.id ||
        "group",
    );
    if(id==='behind-title')void preparePresenter(item.id);
    else notify("已添加，可在右侧调整或在时间轴拖动。");
  };
  const setProp = (key: string, value: any) =>
    updateInstance((i) => {
      i.props[key] = value;
    });
  const setNested = (group: string, key: string, value: any) =>
    updateInstance((i) => {
      if (value === undefined) {
        if (i.props[group]) delete i.props[group][key];
        return;
      }
      i.props[group] = { ...i.props[group], [key]: value };
    });
  const style =
    instance?.props.elements?.[
      part === "all-text"
        ? partsFor(instance).find((p) => !["bar", "panel"].includes(p.id))?.id
        : part
    ] ?? {};
  const setStyle = (key: string, value: any) =>
    mutate((d) => {
      for (const i of d.instances) {
        if(isLocked(i.id,d))continue;
        if (
          i.id !== selected &&
          !(globalEdit && i.assetId === instance.assetId)
        )
          continue;
        i.props.elements ||= {};
        for (const id of part === "all-text"
          ? partsFor(i)
              .filter((p) => !["bar", "panel"].includes(p.id))
              .map((p) => p.id)
          : [part]) {
          i.props.elements[id] = { ...i.props.elements[id] };
          if (value === undefined) delete i.props.elements[id][key];
          else i.props.elements[id][key] = value;
        }
      }
    });
  const exportClip=(target:any)=>{if(target.kind==='camera'&&sourceMapped&&cameraOccurrence&&target.id===cameraSelected)target={...target,rangeStartFrame:cameraOccurrence.startFrame,durationFrames:cameraOccurrence.endFrame-cameraOccurrence.startFrame};if(busy)return;if(['running','cancelling'].includes(job?.status)){setModal('export');return;}setClipTarget(target);setExportMode(target.kind==='instance'?'single-layer':'clip');setJob(null);setModal('export');};
  const timelineCommand = (command:string,options?:any) => {
    try {
      const d=current.current,keys=selection;
      const kind=command==='paste'?clipboard.current?.kind:captionSelected?'caption':cameraSelected?'camera':null;
      if(['copy','cut','paste','delete','duplicate','split'].includes(command)&&(kind==='caption'||kind==='camera')){
        const result=(kind==='caption'?captionSelectionCommand:cameraTimelineCommand)(d,kind==='caption'?captionIds:cameraSelected,command,playback.getSnapshot(),clipboard.current,uid);
        if(result.payload)clipboard.current=result.payload;
        if(result.document!==d)apply(result.document);
        if(kind==='caption')selectCaption(result.ids);else selectCamera(result.selected);
        notify(command==='copy'?'已复制，可在播放头粘贴':'已更新，可撤销');return;
      }
      if(command==='group'){apply(groupClips(d,keys,uid()));notify('已编组，点击任一片段选择整组');return;}
      if(command==='ungroup'){apply(ungroupClips(d,keys));notify('已取消编组');return;}
      if(command==='copyProperties'){propertyClipboard.current=copyProperties(d,selected);notify('已复制模板属性');return;}
      if(command==='pasteProperties'){apply(pasteProperties(d,keys,propertyClipboard.current,options??['text','background']));notify('已粘贴所选属性，文案与时间保留');return;}
      if(command==='disable'){mutate(n=>{const chosen=n.instances.filter(i=>keys.includes(i.id)&&!isLocked(i.id,n));const disabled=chosen.some(i=>!i.disabled);chosen.forEach(i=>i.disabled=disabled);});return;}
      if(command==='selectAll'&&captionIds.length){selectCaption(d.captions.cues.map(c=>c.id));return;}
      if(command==='selectAll'){selectMany(timelineItems(d).filter(i=>!i.locked).map(i=>i.key));return;}
      if(command==='copy'||command==='cut'){
        clipboard.current=copySelection(d,keys);
        if(!clipboard.current.items.length){notify('请先选中未锁定片段',true);return;}
        if(command==='cut'){apply(deleteSelection(d,keys));selectMany([]);}
        notify(`已${command==='cut'?'剪切':'复制'} ${clipboard.current.items.length} 个片段；在播放头位置粘贴`);return;
      }
      if(command==='delete'){const next=deleteSelection(d,keys);if(!jsonEqual(next,d)){apply(next);selectMany([]);notify('已删除，⌘Z 可撤销');}return;}
      if(command==='split'){
        const next=splitSelection(d,keys,playback.getSnapshot(),uid);
        if(jsonEqual(next,d)){notify('请把播放头放在选中片段内部再分割',true);return;}
        apply(next);notify('已分割；右半段继续原来的动画和声音');return;
      }
      if(command==='paste'||command==='duplicate'){
        const payload=command==='duplicate'?copySelection(d,keys):clipboard.current;
        const at=command==='duplicate'?selectionBounds(d,keys)?.end:playback.getSnapshot();
        if(at===undefined)throw Error('请先选择片段');
        const before=new Set(timelineItems(d).map(i=>i.key)),next=pasteSelection(d,payload,at,uid);
        apply(next);selectMany(timelineItems(next).filter(i=>!before.has(i.key)).map(i=>i.key));notify('已放入时间轴；保持所选片段的相对间距');
      }
    }catch(e:any){notify(e.message,true);}
  };
  const removeSelected = () => timelineCommand('delete');
  const duplicateSelected = () => timelineCommand('duplicate');
  const dropTemplate=(id:string,frame:number,trackId?:string|{newTrack:number})=>{
    player.current?.pause();closePreview();
    const item=makeEditorInstance(id,current.current,frame);
    const target=typeof trackId==='object'?insertEmptyTrack(current.current,'visual',trackId.newTrack):{document:current.current,trackId};
    apply(placeInstance(target.document,item,target.trackId));setSelected(item.id);setPart('group');seek(frame);
    if(id==='behind-title')void preparePresenter(item.id);
  };
  const commitGesture = (base: Doc, next: Doc) => {
    setHistory((h) => commitHistory(h, base, next));
    setDirty(true);
  };
  const dragCaptionCanvas = (e: React.PointerEvent,element:HTMLElement) => {
    e.preventDefault();e.stopPropagation();captionDragCancel.current?.();
    (document.activeElement as HTMLElement)?.blur();player.current?.pause();
    const id=element.getAttribute('data-editor-caption')!,base=structuredClone(current.current);
    const chosen=captionSelectionForClick(base.captions.cues,captionIds,captionAnchor.current,id,{toggle:e.metaKey||e.ctrlKey,range:e.shiftKey,preserve:true});
    selectCaption(id,{toggle:e.metaKey||e.ctrlKey,range:e.shiftKey,preserve:true});
    if(!chosen.ids.includes(id)||e.metaKey||e.ctrlKey||e.shiftKey)return;
    const rect=e.currentTarget.getBoundingClientRect();let latest=base;
    const gesture=createCaptionPositionDrag({track:base.captions,ids:chosen.ids,x:e.clientX,y:e.clientY,width:rect.width,height:rect.height,
      onPreview:(track:any)=>{if(current.current.id!==base.id)return;latest={...base,captions:track};current.current=latest;setHistory(h=>({...h,present:latest}));},
      onCommit:()=>{if(current.current.id===base.id)commitGesture(base,latest);},
    });
    const cleanup=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',cancel);window.removeEventListener('blur',cancel);window.removeEventListener('keydown',escape,true);captionDragCancel.current=null;};
    const move=(event:PointerEvent)=>gesture.move(event);
    const end=()=>{cleanup();gesture.end();};
    const cancel=()=>{cleanup();gesture.cancel();};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancel();}};
    captionDragCancel.current=cancel;
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',end,{once:true});window.addEventListener('pointercancel',cancel,{once:true});window.addEventListener('blur',cancel,{once:true});window.addEventListener('keydown',escape,true);
  };
  const dragCanvas = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const caption=(e.target as HTMLElement).closest<HTMLElement>("[data-editor-caption]");
    if(caption){dragCaptionCanvas(e,caption);return;}
    setPreviewAsset("");
    (document.activeElement as HTMLElement)?.blur();
    if (e.altKey) {
      const hits = Array.from(
        new Set(
          document
            .elementsFromPoint(e.clientX, e.clientY)
            .map((el) =>
              el
                .closest("[data-editor-instance]")
                ?.getAttribute("data-editor-instance"),
            )
            .filter(Boolean),
        ),
      );
      if (hits.length) {
        setSelected(hits[(hits.indexOf(selected) + 1) % hits.length]!);
        setPart("group");
      }
      return;
    }
    const target = (e.target as HTMLElement).closest("[data-editor-instance]");
    if (!target) {
      setSelected("");
      return;
    }
    const id = target.getAttribute("data-editor-instance")!;
    const element = (e.target as HTMLElement).closest("[data-editor-part]");
    const key = element?.getAttribute("data-editor-part") || "group";
    setSelected(id);
    setPart(key === "asset" ? "group" : key);
    const base = structuredClone(current.current),
      item = base.instances.find((i) => i.id === id);
    if (!item || isLocked(id,base)) return;
    const mediaItemId = (e.target as HTMLElement).closest('[data-media-item]')?.getAttribute('data-media-item');
    const mediaItem = isMediaAsset(item.assetId) ? item.props.items.find((i:any)=>i.id===mediaItemId) : null;
    if (isMediaAsset(item.assetId) && !mediaItem) return;
    if (mediaItem) setMediaSelection({documentId:base.id,instanceId:id,itemId:mediaItem.id});
    player.current?.pause();
    e.preventDefault(); // Images must not start the browser's native drag gesture.
    const x = e.clientX,
      y = e.clientY,
      scale = e.currentTarget.getBoundingClientRect().width / base.canvas.width;
    const wholeAsset = key === "group" || key === "asset";
    const origin = wholeAsset ? item.props.tune : item.props.elements?.[key];
    const pip = item.assetId === 'source-pip';
    const pipOrigin = pip ? pipPosition(base.canvas.width,base.canvas.height,item.props) : null;
    const originX = mediaItem ? mediaItem.x*base.canvas.width/100 : pipOrigin?.x ?? origin?.x ?? 0;
    const originY = mediaItem ? mediaItem.y*base.canvas.height/100 : pipOrigin?.y ?? origin?.y ?? 0;
    let latest = base,
      changed = false,
      started = false;
    const move = (ev: PointerEvent) => {
      const position = canvasDragPosition({
        dx: ev.clientX - x,
        dy: (ev.clientY - y) * (wholeAsset && item.assetId === "chapter-progress" ? -1 : 1),
        scale, x: originX, y: originY, started,
        snap: wholeAsset && !ev.altKey,
      });
      if (!position) return;
      started = true;
      changed = position.x !== originX || position.y !== originY;
      latest = structuredClone(base);
      const i = latest.instances.find((i) => i.id === id);
      if (changed && mediaItem) {
        const child=i.props.items.find((child:any)=>child.id===mediaItem.id);
        child.x=Math.max(-100,Math.min(100,position.x/base.canvas.width*100));
        child.y=Math.max(-100,Math.min(100,position.y/base.canvas.height*100));
      } else if (changed && wholeAsset && pip) {
        Object.assign(i.props,positionPip(base.canvas.width,base.canvas.height,item.props,position));
      } else if (changed && wholeAsset) {
        i.props.tune = {
          ...i.props.tune,
          ...position,
        };
      } else if (changed) {
        i.props.elements = {
          ...i.props.elements,
          [key]: {
            ...i.props.elements?.[key],
            ...position,
          },
        };
      }
      setHistory((h) => ({ ...h, present: latest }));
    };
    const end = () => {
      window.removeEventListener('blur', cancel);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      if (changed) commitGesture(base, latest);
    };
    const cancel = () => {
      changed = false;
      setHistory((h) => ({ ...h, present: base }));
      end();
    };
    window.addEventListener("pointercancel", cancel, { once: true });
    window.addEventListener('blur', cancel, {once:true});
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
  };
  const parts = partsFor(instance).map((p) => [p.id, p.label]);
  const selectedPart = partsFor(instance).find((p) => p.id === part);
  const textValue =
    instance?.assetId === "chapter-progress"
      ? instance.props.chapters?.find((c) => c.id === part)?.title
      : readPartText(instance?.props || {}, selectedPart);
  const changeText = (value: any) =>
    updateInstance((i) => {
      if (i.assetId === "chapter-progress") {
        const c = i.props.chapters.find((c) => c.id === part);
        if (c) c.title = value;
      } else writePartText(i.props, selectedPart, value);
    });
  const setRatio = (value: string) => {
    const [width, height] = value.split("x").map(Number);
    mutate((d) => {
      d.canvas.width = width;
      d.canvas.height = height;
      for (const i of d.instances) i.props.canvas = value;
    });
  };
  const setBackground = (value: string) => {
    updateInstance((i) => {
      i.props.editorBackground = value;
      if (
        ["chapter-navigation", "pill-stack", "word-cascade"].includes(i.assetId)
      ) {
        i.props.variant = {
          ...i.props.variant,
          bg:
            value === "transparent"
              ? "transparent"
              : asset(i.assetId)?.defaultProps.variant?.bg === "transparent"
                ? "scene"
                : asset(i.assetId)?.defaultProps.variant?.bg,
        };
      }
    });
  };
  const previewSource = usePreviewProxy(doc.source,playing);
  const compositionProps = useMemo(
    () => ({
      document: renderDocument(doc),
      previewSource,
      renderMode: (doc.source||doc.audioClips?.length ? "full" : "layer") as
        | "full"
        | "layer",
    }),
    [reviewContentKey,previewSource],
  );
  const ratio = doc.canvas.width / doc.canvas.height;
  const planShot=doc.productionPlan?.shots.find(s=>s.id===planSelected&&!s.cancelled);
  const planView=planShot?getPlanPreviewView(doc,planShot,productionPlan.jobs,planResources):null;
  const showingPlan=!!planView?.visible&&projectPanel==='plan'&&!previewAsset&&!mediaPreview&&doc.productionPlan?.hoverEnabled!==false;
  const planLayout=showingPlan&&planView?calculatePlanPreviewLayout({width:stageSize.width,height:stageSize.height,ratio,sections:planView.sections}):null;
  const planGrid=planLayout?{
    gridTemplateColumns:planLayout.mode==='sides'?`${planLayout.leftWidth}px minmax(0,1fr) ${planLayout.rightWidth}px`:planLayout.mode==='aside'?`${planLayout.leftWidth}px minmax(0,1fr)`:planLayout.rightSections.length?'minmax(0,1fr) minmax(0,1fr)':'minmax(0,1fr)',
    gridTemplateRows:planLayout.mode==='stack'?`${planLayout.mediaHeight}px minmax(0,1fr)`:'minmax(0,1fr)',
  }:undefined;
  const viewW=planLayout?.mediaWidth??Math.min(stageSize.width,stageSize.height*ratio);
  const imageSlot = instance
    ? Object.entries(asset(instance.assetId)?.slotDescriptors || {}).find(
        ([, descriptor]: any) => descriptor.type === "image",
      )?.[0]
    : undefined;
  const previewInUse =
    mediaPreview &&
    [mediaPreview.path, mediaPreview.publicPath]
      .filter(Boolean)
      .some((path) => JSON.stringify(doc).includes(JSON.stringify(path)));
  const selectedMediaItem=instance&&isMediaAsset(instance.assetId)?resolveMediaTarget(instance.props,mediaSelection.documentId===doc.id&&mediaSelection.instanceId===instance.id?mediaSelection.itemId:undefined):null;
  const mediaAdding=useRef(false);
  useEffect(()=>{closePreview();setLibraryRefresh(v=>v+1);},[doc.id]);
  const addMedia = (item: Pick<StudioItem,'id'|'kind'|'scope'>, frame=playback.getSnapshot(), trackId?:string|{newTrack:number}) => run(async()=>{
    if(mediaAdding.current)return;
    mediaAdding.current=true;
    const projectId=current.current.id;
    player.current?.pause();
    try{
      const meta=await api('library/stage',{id:item.id,projectId,scope:item.scope});
      if(current.current.id!==projectId)throw Error('项目已切换，请在当前项目重新添加素材');
      if(item.kind!=='image'&&item.kind!=='video')throw Error('此入口支持图片和视频');
      const base=makeEditorInstance('source-pip',current.current,frame);
      const clip=configureMediaClip(base,meta,item.kind,current.current,meta.name);
      clip.assetReferences={media:meta.path,...(meta.sourceSharedPath?{shared:meta.sourceSharedPath}:{})};
      if(typeof trackId==='string'&&current.current.tracks.find(t=>t.id===trackId)?.locked)throw Error('目标轨道已锁定');
      const target=typeof trackId==='object'?insertEmptyTrack(current.current,'visual',trackId.newTrack):{document:current.current,trackId};
      apply(placeInstance(target.document,clip,target.trackId));setSelected(clip.id);setPart('group');closePreview();seek(clip.startFrame);
      notify('已添加「'+meta.name+'」到时间轴');
      try{await api('library/use',{id:item.id,projectId,scope:item.scope});}catch{notify('素材已添加，但使用次数未能保存',true);}
      if(current.current.id===projectId)setLibraryRefresh(v=>v+1);
    }finally{mediaAdding.current=false;}
  });
  const importTimelineMedia=(files:any[],frame:number)=>{
    const result=placeImportedMedia(current.current,files,frame,makeEditorInstance);
    if(!result.ids.length)return;
    apply(result.document);selectMany(result.ids);setPart('group');closePreview();seek(frame);
    notify(`已将 ${result.ids.length} 个素材添加到新轨道`);
    const projectId=current.current.id;
    void Promise.all(files.map(item=>api('library/use',{id:item.id,projectId,scope:item.scope})))
      .then(()=>{if(current.current.id===projectId)setLibraryRefresh(v=>v+1);})
      .catch(()=>notify('素材已添加，但使用次数未能保存',true));
  };
  const dropMedia=(payload:string,frame:number,trackId?:string|{newTrack:number})=>{
    try{const item=JSON.parse(payload);if(item.projectId!==current.current.id)throw Error('素材来自其他项目，请重新选择');void addMedia(item,frame,trackId);}catch(error:any){notify(error.message,true);}
  };
  const promoteMedia=async(item:StudioItem)=>{
    const projectId=current.current.id,result=await api('library/promote',{id:item.id,projectId,scope:item.scope});
    if(current.current.id!==projectId)return;
    setMediaPreview(previous=>previous?.id===item.id?{...previous,sharedId:result.sharedId??result.item?.id??result.id}:previous);
    setLibraryRefresh(v=>v+1);notify('已添加到素材库，本项目素材已保留');
  };
  const addTemplateSound = () => run(async () => {
    const live=current.current,target=live.instances.find(i=>i.id===selectedInstanceRef.current);
    if(!target||isLocked(target.id))throw Error('请先选择未锁定的模板');
    const recipe=soundRecipes[target.assetId];if(!recipe?.file)throw Error('此模板默认留白');
    const clipId=`sfx-${target.id}`;
    if(live.audioClips?.some(c=>c.id===clipId)){setSelected(`audio/${clipId}`);return;}
    const snapshot=JSON.stringify(target),staged=await api('library/stage',{id:recipe.libraryId});
    const latest=current.current,now=latest.instances.find(i=>i.id===target.id);
    if(latest.id!==live.id||JSON.stringify(now)!==snapshot||isLocked(target.id))throw Error('模板已变化，请重新添加音效');
    if(latest.audioClips?.some(c=>c.id===clipId)){setSelected(`audio/${clipId}`);return;}
    const clip=templateSoundClip(now,staged,fps,latest.canvas.durationFrames);
    apply(placeAudio(latest,clip));setSelected(`audio/${clip.id}`);notify('已添加独立音效，可试听后调整音量、移动或静音');
  });
  const useMedia = (item: StudioItem) =>
    run(async () => {
      if(item.kind==='audio'){
        const projectId=current.current.id,staged=await api('library/stage',{id:item.id});
        if(current.current.id!==projectId)throw Error('项目已切换，请重新添加声音');
        const total=Math.floor(staged.durationSeconds*fps),start=playback.getSnapshot();if(!Number.isFinite(total)||total<1)throw Error('无法读取音频时长');
        const clip={id:uid(),name:item.name,path:staged.path,originalPath:item.path,startFrame:start,durationFrames:Math.min(total,current.current.canvas.durationFrames-start),sourceInFrame:0,sourceDurationFrames:total,volume:1,fadeInFrames:0,fadeOutFrames:0};
        apply(placeAudio(current.current,clip));setSelected(`audio/${clip.id}`);closePreview();notify('已添加到独立音轨');
      } else if (instance && (instance.assetId==='source-pip'||isMediaAsset(instance.assetId)) && ['video','image','reference'].includes(item.kind)) {
        const documentId=current.current.id,targetId=instance.id,targetItemId=selectedMediaItem?.id;
        const staged=await api('library/stage',{id:item.id,...(item.kind==='reference'?{}:{projectId:current.current.id,scope:item.scope})});
        const kind=item.kind==='video'?'video':'image';
        if(kind==='image') {
          const img=new Image();
          await new Promise<void>((resolve,reject)=>{img.onload=()=>resolve();img.onerror=()=>reject(new Error('无法读取素材图片'));img.src='/'+staged.publicPath;});
          staged.width=img.naturalWidth;staged.height=img.naturalHeight;
        }
        if(current.current.id!==documentId || !current.current.instances.some(i=>i.id===targetId))throw new Error('作品或小窗已切换，请重新选择素材');
        if(isMediaAsset(instance.assetId)){
          const selection=mediaSelectionRef.current,live=current.current.instances.find(i=>i.id===targetId);
          const liveItem=live?resolveMediaTarget(live.props,selection.documentId===documentId&&selection.instanceId===targetId?selection.itemId:undefined):null;
          if(selectedInstanceRef.current!==targetId||liveItem?.id!==targetItemId)throw new Error('选中的素材位置已改变，请重新应用');
        }
        mutate(d=>{const target=d.instances.find(i=>i.id===targetId);target.assetReferences={...target.assetReferences,[targetItemId??'pip']:item.path};if(isMediaAsset(target.assetId)){const index=target.props.items.findIndex((i:any)=>i.id===targetItemId);if(index<0)throw new Error('素材位置已移除');const media=assignPipMedia({},staged,kind).media;target.props.items[index]=replaceMediaItem(target.props.items[index],media);}else target.props=assignPipMedia(target.props,staged,kind);});
        closePreview();notify('已放入选中模板素材位置');
      } else if (item.kind === "video") {
        const meta = await api("media", { path: item.path });
        apply(applyImportedSource(current.current, meta));
        seek(0);
        closePreview();
        notify("已将「" + item.name + "」设为底片，动画沿用底片画幅");
      } else if (
        (item.kind === "image" || item.kind === "reference") &&
        imageSlot &&
        instance
      ) {
        const documentId = current.current.id,
          targetId = instance.id,
          slot = imageSlot;
        const staged = await api("library/stage", { id: item.id,...(item.kind==='reference'?{}:{projectId:current.current.id,scope:item.scope}) });
        if (
          current.current.id !== documentId ||
          !current.current.instances.some((i) => i.id === targetId)
        )
          throw new Error("作品已切换，请重新选择图片");
        mutate((d) => {
          const target = d.instances.find((i) => i.id === targetId);
          target.assetReferences={...target.assetReferences,[slot]:item.path};
          target.props.slots = {
            ...target.props.slots,
            [slot]: staged.publicPath,
          };
        });
        closePreview();
        notify("已应用到「" + asset(instance.assetId).name + "」的图片槽");
      }
    });
  return (
    <ControlGestures.Provider value={controlGestures}>
    <BackendVersionBanner/>
    {shortcutsOpen&&<ShortcutHelp onClose={()=>setShortcutsOpen(false)} review={projectPanel==='roughcut'&&!!doc.roughcut}/>}
    <TransportRateBadge rate={playRate} playing={playing}/>
    <ProjectMediaContext.Provider value={{projectId:doc.id,getProjectId:()=>current.current.id,getDocument:()=>current.current,onImported:()=>{setLibraryRefresh(v=>v+1);setDirty(true);},onAnalyzeImported:recognizeImported,recognition:{document:doc,jobs:productionPlan.jobs,submitting:recognitionSubmissions},prepareImport:async()=>{const id=current.current.id;await save();if(current.current.id!==id)throw Error('项目已切换，请重新选择文件');}}}>
      <div
        className={"app studio-app"+(reviewMode?" review-mode":"")}
      >
        <header>
          <ProjectMenu busy={busy}
            onNew={()=>setModal("new-project")}
            onOpen={()=>run(async()=>{if(dirty)await save();setSavedList(await api("documents"));setModal("open");})}
            onDuplicate={()=>run(async()=>{await save(true);})}
            onSettings={()=>setModal("media")}
          />
          <input
            aria-label="项目名称"
            value={doc.name}
            onChange={(e) => mutate((d) => (d.name = e.target.value))}
          />
          {saveStatus.id===doc.id&&saveStatus.state==='error'&&<span className="save-state" role="alert" title={saveStatus.message||draftStatus}>
            {saveStatus.conflict?'其他窗口已更新，当前编辑已保护':'自动保存失败，草稿已保护'}
          </span>}
          {saveStatus.id===doc.id&&saveStatus.state==='error'&&<button onClick={()=>run(async()=>{await save(!!saveStatus.conflict);})}>{saveStatus.conflict?'保留为副本':'重试自动保存'}</button>}
          <span className="spacer" />
          <button aria-pressed={reviewMode} onClick={()=>{player.current?.pause();reviewVideo.current?.pause();closePreview();clearSelection();setProjectPanel(null);setReviewMode(v=>!v);}}>审片模式</button>
          <button className="primary" onClick={() => {if(!["running","cancelling"].includes(job?.status)){setClipTarget(null);setExportMode("instances");}setModal("export");}}>
            <Icon name="download" />
            {job?.status==='cancelling'?'正在取消…':job?.status==='running'?'正在导出 · 查看进度':'导出'}
          </button>
        </header>
        {recovery && (
          <div
            className="recovery-backdrop"
            {...recoveryBackdrop}
            role="dialog"
            aria-modal="true"
            aria-label="恢复未保存的编辑"
          >
            <div className="recovery-banner">
              <div>
                <strong>发现未保存的编辑</strong>
                <span>
                  「{recovery.document.name}」 ·{" "}
                  {new Date(recovery.savedAt).toLocaleString("zh-CN")}
                </span>
              </div>
              <button
                autoFocus
                className="primary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    if (
                      !recovery.document.instances.every((i) =>
                        EDITOR_ASSETS.some((a) => a.id === i.assetId),
                      )
                    ) {
                      notify(
                        "草稿包含当前无法识别的模板，请保留草稿并检查模板版本",
                        true,
                      );
                      return;
                    }
                    let restored = retimeEditorDocument(recovery.document, 30);
                    if (restored.revision > 0) {
                      let saved;
                      try {
                        saved = await api(
                          "load?id=" + encodeURIComponent(restored.id),
                        );
                      } catch {
                        /* Keep the local draft recoverable even if its original project is unavailable. */
                      }
                      if (!saved || saved.revision !== restored.revision) {
                        restored = {
                          ...restored,
                          id: uid(),
                          revision: 0,
                          name: restored.name + "（恢复副本）",
                        };
                      }
                    }
                    const recoveredFrame = Math.max(
                      0,
                      Math.min(
                        restored.canvas.durationFrames - 1,
                        recovery.frame,
                      ),
                    );
                    setHistory({ past: [], present: restored, future: [] });
                    current.current = restored;
                    clearSelection();
                    setDirty(true);
                    recoveredDraft.current=recovery;
                    setRecovery(null);
                    playback.setFrame(recoveredFrame);
                    setTimeout(
                      () => player.current?.seekTo(recoveredFrame),
                      50,
                    );
                    notify("已恢复草稿，将自动保存");
                  })
                }
              >
                恢复编辑
              </button>
              <button
                onClick={() => {
                  try {
                    removeRecoveredDraft(localStorage,recovery);
                  } catch {}
                  setRecovery(null);
                }}
              >
                放弃草稿
              </button>
              <button className="dialog-close" aria-label="关闭草稿恢复提示" title="关闭" disabled={busy} onClick={()=>setRecovery(null)}><Icon name="close"/></button>
            </div>
          </div>
        )}
        <div className="workspace"><PanelResize side="library"/><PanelResize side="inspector"/>
          <nav className="studio-rail" aria-label="工作区导航">
            {[
              ["templates", "layout-template", "模板"],
              ["media", "film", "素材"],
              ["audio", "audio-lines", "声音"],
            ].map(([id, icon, label]) => (
              <button
                key={id}
                aria-label={label + "库"}
                aria-pressed={libraryTab === id}
                className={libraryTab === id ? "active" : ""}
                onClick={() => setLibraryTab(id)}
              >
                <Icon name={icon} size={20} />
                <span>{label}</span>
              </button>
            ))}
            <div className="rail-spacer" />
            <button onClick={() => openManager("library")}>
              <Icon name="folder-open" size={20} />
              <span>资产</span>
            </button>
          </nav>
          <aside className="library" aria-label="资产浏览区">
            {libraryTab === "templates" ? (
              <TemplateLibrary assets={EDITOR_ASSETS} onAdd={add} onPreview={previewTemplate} selectedId={previewAsset}/>
            ) : <StudioLibrary category={libraryTab} selectedId={mediaPreview?.id} onPreview={previewMedia} onManage={openManager} refreshKey={libraryRefresh}/>}


          </aside>
          <main className="viewer" aria-label="作品预览">
            <div
              className={
                "stage" + (reviewCached?" review-has-video":"") + (previewAsset || mediaPreview ? " has-preview" : "") + (planLayout ? " is-plan-preview plan-layout-"+planLayout.mode : "")
              }
              ref={stage}
              style={planGrid}
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) clearSelection();
              }}
            >
              {showingPlan&&planView&&<>
                <PlanAnnotationHeading view={planView} onClose={()=>selectPlan('')}/>
                <PlanAnnotationRail side="left" sections={planLayout?.leftSections??[]}/>
                {!!planLayout?.rightSections.length&&<PlanAnnotationRail side="right" sections={planLayout.rightSections}/>}
              </>}
              {previewAsset && (
                <div className="studio-preview-stage" {...previewBackdrop}>
                  <TemplatePreview
                    asset={asset(previewAsset)}
                    canvas={doc.canvas}
                    onAdd={add}
                    onClose={closePreview}
                  />
                </div>
              )}
              {mediaPreview && (
                <div className="studio-preview-stage" {...previewBackdrop}>
                  <StudioPreview
                    item={
                      previewInUse
                        ? {
                            ...mediaPreview,
                            deletable: false,
                            deleteReason: "当前作品正在使用此素材",
                          }
                        : mediaPreview
                    }
                    onClose={closePreview}
                    adding={busy}
                    onUse={['image','video'].includes(mediaPreview.kind)?item=>void addMedia(item):['audio','reference'].includes(mediaPreview.kind)?useMedia:undefined}
                    useLabel={['image','video','audio'].includes(mediaPreview.kind)?'添加到时间轴':'应用到选中模板'}
                    onPromote={promoteMedia}
                    onApply={['image','video','reference'].includes(mediaPreview.kind)&&instance&&(isMediaAsset(instance.assetId)||instance.assetId==='source-pip'||(imageSlot&&mediaPreview.kind!=='video'))?useMedia:undefined}
                    applyLabel={instance&&isMediaAsset(instance.assetId)?`替换当前素材：${selectedMediaItem?.label??'待选择'}`:instance?.assetId==='source-pip'?'替换选中小窗素材':'应用到选中模板'}
                    onDeleted={() => {
                      closePreview();
                      setLibraryRefresh((v) => v + 1);
                      notify("已移入素材回收区");
                    }}
                    onError={(message) => notify(message, true)}
                  />
                </div>
              )}
              {!previewAsset &&
                !mediaPreview &&
                !doc.source &&
                !doc.instances.length && !doc.captions?.cues?.length && (
                  <div className="studio-canvas-empty">
                    <span className="empty-canvas-icon">
                      <Icon name="film" size={30} />
                    </span>
                    <strong>从一段素材开始</strong>
                    <p>导入底片，或从左侧选一个动画模板</p>
                    <button onClick={() => setModal("media")}>
                      <Icon name="plus" />
                      导入底片
                    </button>
                    <small>点击模板可以先预览，再加入时间轴</small>
                  </div>
                )}
              <div
                className="player-wrap"
                style={{ width: viewW, aspectRatio: ratio, touchAction: "none" }}
                onPointerDown={reviewMode?undefined:dragCanvas}
                data-selected={selected}
                onKeyDown={e=>{const caption=(e.target as HTMLElement).closest('[data-editor-caption]');if(caption&&(e.key==='Enter'||e.key===' ')){e.preventDefault();e.stopPropagation();selectCaption(caption.getAttribute('data-editor-caption')!,{toggle:e.metaKey||e.ctrlKey,range:e.shiftKey,preserve:true});}}}
              >
                <style>
                  {selected
                    ? `.player-wrap [data-editor-instance="${CSS.escape(selected)}"]${instance?.assetId==='source-pip'?'[data-source-pip]':isMediaAsset(instance?.assetId)?` [data-media-item="${CSS.escape(selectedMediaItem?.id??'')}"]`:` ${part === "group" ? "[data-editor-part]" : `[data-editor-part="${CSS.escape(part)}"]`}`}{outline:2px solid #77a9fa;outline-offset:-2px;cursor:move}`
                    : ""}
                </style>
                <style>{captionIds.length?captionIds.map(id=>`.player-wrap [data-editor-caption="${CSS.escape(id)}"]`).join(',')+'{outline:2px solid #77a9fa;outline-offset:4px}':''}</style>
                {reviewCached&&<video className="review-cached-video" ref={reviewVideo} src={reviewPreview.url} controls playsInline onPlay={()=>player.current?.pause()} onTimeUpdate={e=>playback.setFrame(Math.min(doc.canvas.durationFrames-1,Math.round(e.currentTarget.currentTime*fps)))} onLoadedMetadata={e=>{e.currentTarget.currentTime=playback.getSnapshot()/fps;}}/>}
                <PreviewBoundary revisionKey={JSON.stringify(doc.instances)}>
                  <Player
                    key={previewRecovery}
                    ref={bindPlayer}
                    component={EditorComposition}
                    inputProps={compositionProps}
                    durationInFrames={doc.canvas.durationFrames}
                    compositionWidth={doc.canvas.width}
                    compositionHeight={doc.canvas.height}
                    fps={fps}
                    playbackRate={playRate}
                    style={{ width: "100%" }}
                    clickToPlay={false}
                    controls={false}
                    errorFallback={({ error }) => (
                      <div className="preview-error">
                        <strong>预览暂时无法播放</strong>
                        <p>{error.message}</p>
                        <button
                          onClick={() => {
                            setPreviewRecovery((n) => n + 1);
                            setBuffering(false);
                          }}
                        >
                          重新加载预览
                        </button>
                      </div>
                    )}
                    loop
                  />
                </PreviewBoundary>
              </div>
              {!previewAsset && !mediaPreview && <PlaybackOverlay
                clock={playback}
                hoverPreview={hoverPreview}
                fps={fps}
                duration={doc.canvas.durationFrames}
                playing={playing}
                buffering={buffering}
                onToggle={() => player.current?.toggle()}
              />}
            </div>
          </main>
          <ReviewPanel onOpenPlan={(shotId:string)=>{setReviewMode(false);selectPlan(shotId);}} active={reviewMode} document={doc} getDocument={()=>current.current} save={()=>save()} clock={playback} onSeek={(frame:number)=>{seek(frame);if(reviewVideo.current)reviewVideo.current.currentTime=frame/fps;}} onPause={()=>{player.current?.pause();reviewVideo.current?.pause();}} onEdit={()=>{reviewVideo.current?.pause();seek(playback.getSnapshot());setReviewMode(false);}} preview={reviewPreview} onPreview={setReviewPreview} onSync={(base:any,remote:any)=>{if(current.current.id!==remote.id)return;const next=ensureTimeline(mergeServerDelta(base,current.current,remote));current.current=next;setHistory(h=>editHistory(h,next));const unsaved=documentContentKey(next)!==documentContentKey(remote);setDirty(unsaved);dirtyRef.current=unsaved;if(unsaved)autosave.schedule();}}/>
          <aside className="inspector" aria-label="项目与属性">{mediaPreview&&<AssetUsage document={doc} item={mediaPreview} onLocate={(key,frame)=>{selectMany([key]);seek(frame);setFollow(true);}}/>}
            <div className="studio-inspector-title">
              <strong>
                {!previewAsset&&!mediaPreview&&projectPanel==='roughcut' ? '口播粗剪' : !previewAsset&&!mediaPreview&&projectPanel==='plan' ? '制作计划' : !previewAsset&&!mediaPreview&&(projectPanel==='captions'||captionSelected) ? "字幕" : !previewAsset&&!mediaPreview&&(projectPanel==='camera'||cameraSelected) ? "口播镜头变化" : instance && !previewAsset && !mediaPreview
                  ? "编辑属性"
                  : "项目信息"}
              </strong>
              {(projectPanel||captionSelected||cameraSelected)&&!previewAsset&&!mediaPreview ? <button className="project-panel-back" onClick={clearSelection}>返回项目</button> : <span>{instance && !previewAsset && !mediaPreview ? "仅当前作品" : ""}</span>}
            </div>
            <div hidden={projectPanel!=='roughcut'||!!previewAsset||!!mediaPreview}><RoughcutPanel previewSource={previewSource} document={doc} getDocument={()=>current.current} onTranscriptEdit={applyTranscriptEdit} getFrame={()=>playback.getSnapshot()} onSplitAtPlayhead={splitSourceAtPlayhead} hotkeys={!modal&&!manager&&!recovery&&!shortcutsOpen} save={save} onChange={next=>{roughcutPreviewStop.current?.();player.current?.pause();const frame=Math.min(playback.getSnapshot(),next.canvas.durationFrames-1);apply(next);seek(frame);}} onSeek={seek} onPlayCut={(frame,loop=false)=>{roughcutPreviewStop.current?.();player.current?.pause();const start=Math.max(0,frame-Math.round(1.5*fps)),end=Math.min(current.current.canvas.durationFrames-1,frame+Math.round(2*fps));seek(start);const stop=playback.subscribe(()=>{if(playback.getSnapshot()>=end){if(loop){seek(start);requestAnimationFrame(()=>player.current?.play());}else{player.current?.pause();stop();roughcutPreviewStop.current=null;}}});roughcutPreviewStop.current=stop;requestAnimationFrame(()=>player.current?.play());}} onPause={()=>{roughcutPreviewStop.current?.();roughcutPreviewStop.current=null;player.current?.pause();}} playing={playing} onChooseSource={()=>setModal('media')} onOpenDocument={next=>{player.current?.pause();autosave.cancel();current.current=ensureTimeline(next);setHistory({past:[],present:current.current,future:[]});setDirty(false);dirtyRef.current=false;clearSelection();setProjectPanel('roughcut');seek(0);const url=new URL(location.href);url.searchParams.set('document',next.id);window.history.replaceState(null,'',url);}} active={projectPanel==='roughcut'&&!previewAsset&&!mediaPreview}/></div>
            {<div hidden={projectPanel!=='plan'||!!previewAsset||!!mediaPreview}><ProductionPlanPanel onRevertRevision={(result:any)=>{apply(revertRevision(current.current,result));notify('已撤回这段 AI 修改，可再次撤销');}} active={projectPanel==='plan'&&!previewAsset&&!mediaPreview} document={doc} controller={productionPlan} resources={planResources} annotationsVisible={showingPlan} onCandidatePlay={()=>player.current?.pause()} selectedShot={planSelected} onSelect={selectPlan}/></div>}
            {!previewAsset&&!mediaPreview&&(projectPanel==='plan'||projectPanel==='roughcut') ? null : !previewAsset&&!mediaPreview&&projectPanel==='captions' ? <CaptionPanel getFrame={()=>playback.getSnapshot()} document={doc} selected={captionSelected} selection={captionIds} onSelect={selectCaption} onChange={applyCaptionTrack} onSeek={seek} onStart={startCaptions} job={captionJob} pending={pendingCaptions} onApplyPending={applyPendingCaptions} onChooseSource={()=>setModal('media')}/> : !previewAsset&&!mediaPreview&&(projectPanel==='camera'||cameraSelected) ? (
              doc.source ? <>
                <CameraControls document={doc} plan={doc.source.cameraPlan} duration={doc.canvas.durationFrames/fps} getFrame={()=>playback.getSnapshot()} selected={cameraSelected} selectedRange={cameraOccurrence} onSelect={selectCamera} onPreviewClip={previewCamera} onExport={exportClip} exportBusy={busy||['running','cancelling'].includes(job?.status)} fps={fps} onSeek={seek} onChange={(plan:any)=>mutate(d=>{if(d.source&&!d.source.locked)d.source.cameraPlan=plan;})}/>
              </> : <div className="project-feature-empty"><p>导入口播底片后，可添加推近、拉远等镜头变化。</p><FilePicker compact label="导入底片" kind="video" onImported={importProjectSource}/></div>
            ) : !previewAsset&&!mediaPreview&&captionSelected ? <CaptionInspector document={doc} selected={captionSelected} selection={captionIds} onChange={applyCaptionTrack} onSelect={selectCaption} onSeek={seek}/> : !previewAsset&&!mediaPreview&&audioClip&&selection.length===1 ? (<div className="selection-inspector"><h3>{audioClip.name}</h3><AudioControls clip={audioClip} fps={fps} locked={isLocked(selected)} onChange={patch=>{if(!isLocked(selected))mutate(d=>{const c=d.audioClips.find(c=>`audio/${c.id}`===selected);if(c)Object.assign(c,patch);});}}/></div>) : !previewAsset&&!mediaPreview&&(selection.length>1||selected.startsWith('source/')) ? (
              <div className="selection-inspector"><h3>{selection.length>1?`已选 ${selection.length} 个片段`:'主视频片段'}</h3><p>{selected.startsWith('source/')&&selection.length===1?'拖动片段两端补回或缩短原片；后续主视频、字幕、素材和声音一起移动。双击片段可放大微调，每次操作可一步撤销。':'拖动选区整体移动；复制、删除和分割都可一步撤销。'}</p>
                {selectionBounds(doc,selection)&&<p>{(selectionBounds(doc,selection)!.start/fps).toFixed(2)} — {(selectionBounds(doc,selection)!.end/fps).toFixed(2)} 秒</p>}
                <label>整体移动（帧）<input aria-label="整体移动帧数" type="number" value={batchDelta} onChange={e=>setBatchDelta(Number(e.target.value))}/></label><button onClick={()=>{try{apply(moveSelection(current.current,selection,batchDelta));setBatchDelta(0);}catch(e:any){notify(e.message,true);}}}>应用整体移动</button><p>各片段的起点与时长分别保留。</p>{selected.startsWith('source/')&&selection.length===1&&<fieldset disabled={!!doc.source.locked}><label>原声音量<input aria-label="原声音量" type="range" min="0" max="2" step=".01" value={doc.source.volume??1} onChange={e=>mutate(d=>{d.source.volume=Number(e.target.value);})}/></label><label><input type="checkbox" checked={!!doc.source.muted} onChange={e=>mutate(d=>{d.source.muted=e.target.checked;})}/>原声静音</label></fieldset>}
                {selected.startsWith('source/')&&selection.length===1&&<label className="source-waveform-option"><input type="checkbox" checked={showSourceWaveform} onChange={e=>setShowSourceWaveform(e.target.checked)}/>显示音频波形</label>}
                <button onClick={()=>timelineCommand('split')}>在播放头分割</button><button onClick={()=>timelineCommand('duplicate')}>创建副本</button><button onClick={()=>timelineCommand('delete')}>删除选中片段</button>
              </div>
            ) : previewAsset || mediaPreview || !instance ? (
              <div className="studio-project-info">
                {(previewAsset || mediaPreview) && <><Icon
                  name={previewAsset || mediaPreview ? "eye" : "sliders"}
                  size={28}
                />
                <h3>
                  {previewAsset
                    ? asset(previewAsset).name
                    : mediaPreview
                      ? mediaPreview.name
                      : "选择画面中的内容"}
                </h3>
                <p>
                  {previewAsset
                    ? "模板预览使用当前画幅。添加到时间轴后，可以修改文字、布局和样式。"
                    : mediaPreview
                      ? "浏览素材不会改变当前作品。使用素材时，请选择预览下方的操作。"
                      : "选中动画后，可在这里调整内容、样式与位置。"}
                </p></>}
                <dl>
                  <div>
                    <dt>画幅</dt>
                    <dd>
                      {doc.canvas.width} × {doc.canvas.height}
                    </dd>
                  </div>
                  <div>
                    <dt>时长</dt>
                    <dd>{(doc.canvas.durationFrames / fps).toFixed(1)} 秒</dd>
                  </div>
                  <div>
                    <dt>动画</dt>
                    <dd>{doc.instances.length} 个</dd>
                  </div>
                </dl>
                <div className="project-features" aria-label="项目功能">
                  <div className="project-feature-row"><div className="project-feature-identity"><span className="project-feature-name">口播粗剪</span><span className="project-feature-status" data-empty={!doc.roughcut}>{doc.roughcut?'可调整与恢复':'去停顿与重说'}</span></div><div className="project-feature-actions"><button aria-label="打开口播粗剪" onClick={()=>openProjectPanel('roughcut')}>{doc.roughcut?'调整':'开始'}</button></div></div>
                  <ProductionPlanEntry document={doc} controller={productionPlan} onOpen={()=>selectPlan(planSelected)}/>
                  <div className="project-feature-row">
                    <div className="project-feature-identity">
                    <span className="project-feature-name">底片</span>
                    <span className="project-feature-status" data-empty={!doc.source}>{doc.source ? '已导入' : '未导入'}</span>
                    </div>
                    <div className="project-feature-actions"><button aria-label="底片与画幅设置" onClick={()=>setModal('media')}>{doc.source?'管理':'导入'}</button></div>
                  </div>
                  <div className="project-feature-row">
                    <div className="project-feature-identity">
                    <span className="project-feature-name">字幕</span>
                    <span className="project-feature-status" data-empty={!doc.captions?.cues.length&&!pendingCaptions&&!captionJob} role="status">{captionJob?.status==='running'?'识别中…':pendingCaptions?'待确认':captionJob?.status==='failed'?'识别失败':doc.captions?.cues.length?`${doc.captions.cues.length} 条${doc.captions.enabled?'':' · 已隐藏'}`:'未添加'}</span>
                    </div>
                    <div className="project-feature-actions"><button aria-label={doc.captions?.cues.length?'编辑字幕':'添加字幕'} onClick={()=>openProjectPanel('captions')}>{captionJob?.status==='running'||pendingCaptions?'查看':doc.captions?.cues.length?'编辑':'添加'}</button></div>
                  </div>
                  <div className="project-feature-row">
                    <div className="project-feature-identity">
                    <span className="project-feature-name">口播镜头变化</span>
                    <span className="project-feature-status" data-empty={cameraCount===0}>{cameraCount===null?'已有计划':cameraCount?`${cameraCount} 段`:'未添加'}</span>
                    </div>
                    <div className="project-feature-actions"><button aria-label={cameraCount!==0?'查看与调整口播镜头变化':'添加口播镜头变化'} onClick={()=>openProjectPanel('camera')}>{cameraCount!==0?'调整':'添加'}</button></div>
                  </div>
                  <div className="project-feature-row">
                    <div className="project-feature-identity">
                    <span className="project-feature-name">封面</span>
                    <span className="project-feature-status" data-empty={!hasCover} role="status">{doc.cover?'已添加':coverCandidateCount>0?`${coverCandidateCount} 组候选`:'未生成'}</span>
                    </div>
                    <div className="project-feature-actions"><button aria-label={hasCover?'预览封面':'制作封面'} onClick={openCovers}>{hasCover?'预览':'制作'}</button></div>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <button className="module-export-trigger" disabled={busy} onClick={()=>exportClip({kind:'instance',id:instance.id})}><Icon name="export" size={15}/> 导出此模块 <span>选择范围</span></button>
                {soundRecipes[instance.assetId] && <div className="template-sound-control"><span>模板音效 · {soundRecipes[instance.assetId].name}</span>{soundRecipes[instance.assetId].file ? <button disabled={busy||isLocked(instance.id)} onClick={()=>void addTemplateSound()}>{doc.audioClips?.some(c=>c.id===`sfx-${instance.id}`)?'调整音效':'添加默认音效'}</button> : <small>推荐保留人声；可从声音库添加</small>}</div>}
                <fieldset disabled={isLocked(instance.id)} style={{border:0,padding:0,margin:0,minWidth:0}}>{isLocked(instance.id)&&<p>轨道已锁定，请先在时间轴解锁。</p>}<label className="clip-rename">片段名称<input aria-label="片段名称" value={instance.name||''} placeholder={asset(instance.assetId)?.name} onChange={e=>updateInstance(i=>{if(e.target.value.trim())i.name=e.target.value;else delete i.name;})}/></label>
                {instance.assetId==='behind-title'&&<div className="template-sound-control"><span>{presenterBusy===instance.id?'正在自动抠像…':instance.props.presenterLayer==='behind'?'人物前景已准备':'尚未准备人物前景'}</span><button disabled={!!presenterBusy||isLocked(instance.id)} onClick={()=>void preparePresenter(instance.id)}>{instance.props.presenterLayer==='behind'?'重新准备':'自动抠出人物'}</button>{presenterError&&<small>{presenterError}</small>}</div>}
                <Inspector
                  asset={asset(instance.assetId)}
                  instance={instance}
                  selectedMediaItemId={selectedMediaItem?.id}
                  onSelectMediaItem={(itemId:string)=>setMediaSelection({documentId:doc.id,instanceId:instance.id,itemId})}
                  part={part}
                  parts={parts}
                  onPartChange={setPart}
                  style={style}
                  onStyle={setStyle}
                  textValue={textValue}
                  onText={changeText}
                  onBackground={setBackground}
                  onProp={setProp}
                  onPatchProps={(patch) => {
                    if(current.current.id!==doc.id||isLocked(instance.id))return;
                    mutate(d=>{const target=d.instances.find(i=>i.id===instance.id);if(target)target.props={...target.props,...(typeof patch==='function'?patch(target.props):patch)};});
                  }}
                  onNested={setNested}
                  onPatchSlots={(v) =>
                    updateInstance((i) => {
                      i.props.slots = { ...i.props.slots, ...v };
                    })
                  }
                  onPatchTune={(v) =>
                    updateInstance((i) => {
                      i.props.tune = { ...i.props.tune, ...v };
                    })
                  }
                  onInstance={(k, v) => {
                    try {
                      if(k==='startFrame')apply(moveSelection(current.current,[instance.id],v-instance.startFrame));
                      else if(k==='durationFrames')apply(trimClip(current.current,instance.id,'right',v-instance.durationFrames));
                      else updateInstance(i=>{i[k]=v;});
                    }catch(e:any){notify(e.message,true);}
                  }}
                  layerIndex={doc.tracks.findIndex(t=>t.id===instance.trackId)}
                  layerCount={doc.tracks.length}
                  onLayerChange={(direction:number)=>{try{apply(reorderTrack(current.current,instance.trackId,direction));}catch(e:any){notify(e.message,true);}}}
                  canvas={doc.canvas}
                  source={doc.source}
                  onDelete={removeSelected}
                  onReset={(scope) =>
                    updateInstance((i) => {
                      if (scope === "all")
                        i.props = makeEditorInstance(
                          i.assetId,
                          doc,
                          i.startFrame,
                        ).props;
                      else
                        for (const id of part === "all-text"
                          ? partsFor(i)
                              .filter((p) => !["bar", "panel"].includes(p.id))
                              .map((p) => p.id)
                          : [part])
                          delete i.props.elements?.[id];
                    })
                  }
                />
                {instance.assetId === "chapter-progress" && (
                  <button onClick={() => setModal("chapters")}>
                    编辑章节与时间
                  </button>
                )}
                <label className="global-edit">
                  <input
                    type="checkbox"
                    checked={globalEdit}
                    onChange={(e) => setGlobalEdit(e.target.checked)}
                  />
                  同步调整同类动画
                </label></fieldset>
              </>
            )}
          </aside>
        </div>
        {reviewMode&&<ReviewScrubber document={doc} clock={playback} onSeek={(frame:number)=>{seek(frame);if(reviewVideo.current)reviewVideo.current.currentTime=frame/fps;}}/>}
        <div className="studio-timeline-container">
          <Timeline
            hoverPreview={hoverPreview}
            hoverBlocked={!!(modal||manager||mediaPreview||previewAsset||recovery)}
            onHoverPlay={()=>{rangePlayback.current=null;setLooping(false);hoverPreview.startPlayback();player.current?.play();}}
            showSourceWaveform={showSourceWaveform||projectPanel==='roughcut'}
            coverThumbnail={coverThumbnail} onPreviewCover={openCovers}
            canUndo={!!history.past.length} canRedo={!!history.future.length}
            onUndo={()=>{setHistory(h=>undoHistory(h));setDirty(true);}}
            onRedo={()=>{setHistory(h=>redoHistory(h));setDirty(true);}}
            document={doc}
            planJobs={productionPlan.jobs}
            planResources={planResources}
            planSelected={planSelected}
            onPlanSelect={selectPlan}
            onPlanAction={productionPlan.action}
            onPlanDrop={(payload:string,shotId:string,rangeId:string)=>{void (async()=>{const item=JSON.parse(payload);if(item.projectId!==current.current.id)throw Error('素材来自其他工程，请重新选择');const id=current.current.id;const media=await api('library/stage',{id:item.id,scope:item.scope,projectId:id});if(current.current.id!==id)throw Error('工程已切换');const shot=current.current.productionPlan?.shots.find(s=>s.id===shotId);await productionPlan.startJob('recognize',{mediaIds:[media.id??item.id],mediaPaths:[media.path],shotId,slotId:shot?.slots.length===1?shot.slots[0].id:undefined,rangeId});setLibraryRefresh(v=>v+1);notify('素材已提交后台分析，通过核验后自动追加到时间轴。');})().catch(e=>notify(e.message,true));}}
            getDocument={()=>current.current}
            follow={follow} setFollow={setFollow} looping={looping} onPlaySelection={playSelection}
            clock={playback}
            selected={selected}
            selection={selection}
            onSelection={(ids)=>{setCaptionSelected('');selectMany(ids);}}
            captionSelected={captionSelected}
            captionSelection={captionIds}
            onCaptionSelect={selectCaption}
            onCommand={timelineCommand}
            onChange={apply}
            onDropTemplate={dropTemplate}
            onDropMedia={dropMedia}
            onImportedMedia={importTimelineMedia}
            onMediaImportStart={()=>player.current?.pause()}
            cameraSelected={cameraSelected}
            cameraOccurrence={cameraOccurrence}
            onCameraSelect={selectCamera}
            onCameraPreview={previewCamera}
            onExportClip={exportClip}
            exportBusy={busy||['running','cancelling'].includes(job?.status)}
            playing={playing}
            zoom={zoom}
            setZoom={setZoom}
            snap={snap}
            setSnap={setSnap}
            onSeek={seek}
            onSelect={(id) => {
              setCameraSelected('');
              closePreview();
              setSelected(id);
              setPart("group");
            }}
            onPreview={(next) => setHistory((h) => ({ ...h, present: next }))}
            onCommit={commitGesture}
            onPlay={() => player.current?.toggle()}
            onDelete={removeSelected}
            onDuplicate={duplicateSelected}
            nameOf={(id) => asset(id)?.name || id}
          />
        </div>
        <div
          role="status"
          aria-live="polite"
          className={"status " + (error ? "error" : "")}
        >
          {busy ? "处理中… " : ""}
          {notice}
          {notice && !busy && <button aria-label="关闭提示" onClick={() => {setNotice("");setError(false);}}><Icon name="close" size={14}/></button>}
        </div>
        {manager && (
          <div
            className="studio-manager-backdrop"
            {...managerBackdrop}
            role="dialog"
            aria-modal="true"
            aria-label="资产"
          >
            <section className="studio-manager">
              <div className="studio-manager-header">
                <strong>资产</strong>
                <span>当前作品保留在工作区</span>
                <button
                  autoFocus
                  className="dialog-close"
                  title="关闭"
                  onClick={closeManager}
                  aria-label="关闭管理面板"
                >
                  <Icon name="close" />
                </button>
              </div>
              <div className="studio-manager-tabs">
                {[
                  ["library", "素材"],
                  ["sfx", "声音"],
                  ["fonts", "字体"],
                  ["refs", "参考"],
                  ["chapters", "章节规划"],
                  ["projects", "成片与历史"],
                  ["icons", "图标"],
                  ["lottie", "Lottie"],
                  ["components", "组件"],
                  ["recipes", "镜头配方"],
                  ["skinlab", "风格皮肤"],
                  ["storage", "存储清理"],
                  ["health", "系统体检"],
                ].map(([id, label]) => (
                  <button
                    className={manager === id ? "active" : ""}
                    key={id}
                    onClick={() => {if(id==='chapters'){setManager('');setModal('chapters');}else setManager(id);}}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {manager === 'sfx' ? <StudioLibrary category="audio" management onPreview={item=>{setManager('');setLibraryRefresh(v=>v+1);previewMedia(item);}} onManage={openManager} refreshKey={libraryRefresh}/> : <iframe
                key={manager}
                title="资产工具"
                src={"/assets/BROWSER.html?embedded=1#" + manager}
              />}
            </section>
          </div>
        )}
        {modal && (
          <div className="modal-bg" {...modalBackdrop} role="dialog" aria-modal="true" aria-label="编辑器对话框">
            <div className={modal==='cover'?'modal cover-modal':'modal'}>
              <div className="row">
                <h2 style={{ flex: 1 }}>
                  {
                    {
                      shortcuts: "Motion Studio 设置",
                      open: "项目列表",
                      "new-project": "新建空白项目",
                      media: "Motion Studio 设置",
                      chapters: "字幕与章节",
                      export: "导出视频",
                      cover: "封面",
                    }[modal]
                  }
                </h2>
                <button className="dialog-close" aria-label="关闭弹窗" title="关闭" onClick={() => setModal("")}>
                  <Icon name="close" />
                </button>
              </div>
              {modal === 'cover' && <>{coverError&&<p className="cover-error" role="alert">{coverError}</p>}<CoverPanel key={doc.id} documentId={doc.id} listing={covers} onRefresh={refreshCovers} defaultRatio={coverRatio} selectedCover={doc.cover} onSelect={async cover=>{if(current.current.id!==doc.id)return;mutate(d=>{if(cover)d.cover=cover;else delete d.cover;});seek(0);await save();await refreshCovers();notify(cover?'已设置视频首帧封面':'已移除首帧封面');}}/></>}
              {(modal === "media" || modal === "shortcuts") && (
                <nav className="studio-settings-nav" aria-label="设置分类">
                  <button aria-pressed={modal === "media"} onClick={() => setModal("media")}><Icon name="sliders" />项目与预览</button>
                  <button aria-pressed={modal === "shortcuts"} onClick={() => setModal("shortcuts")}><Icon name="keyboard" />快捷键</button>
                </nav>
              )}
              {modal === "new-project" && <>
                <p>新建后会切换到空白时间轴，开始制作另一条视频</p>
                <p>当前项目「{doc.name}」会先保存，之后可从左上角 Motion Studio 菜单的「项目列表」重新打开，底片、字幕和动画都会保留</p>
                <div className="row"><button onClick={()=>setModal("")}>继续编辑当前项目</button><button className="primary" disabled={busy} onClick={()=>run(async()=>{
                  await save();
                  const fresh=blank();current.current=fresh;setHistory({past:[],present:fresh,future:[]});
                  const url=new URL(location.href);url.searchParams.delete('document');window.history.replaceState(null,'',url);
                  setSaveStatus({state:'idle'});clearSelection();setDirty(false);seek(0);setModal('');notify('已创建空白项目，原项目可从「项目列表」打开');
                })}>保存当前项目并新建</button></div>
              </>}
              {modal === "shortcuts" && (
                <div className="shortcut-list">
                  {[
                    ["播放 / 暂停", "空格键"],
                    ["删除选中动画", "⌫ 退格 / Delete 删除"],
                    ["复制 / 剪切 / 粘贴", "⌘ / Ctrl + C / X / V"],
                    ["创建副本 / 分割", "⌘ / Ctrl + D / B"],
                    ["多选 / 全选", "Shift 点击 / 时间轴内 ⌘A"],
                    ["缩放时间轴", "触控板捏合 / + −"],
                    ["横移时间轴", "双指横移 / Shift + 滚轮"],
                    ["定位 / 框选", "单击时间尺 / 拖动轨道空白处"],
                    ["片段与轨道操作", "鼠标右键"],
                    ["撤销 / 重做", "⌘ / Ctrl + Z / Shift + Z"],
                    ["保存", "⌘ / Ctrl + S"],
                    ["逐帧 / 跳 10 帧", "← → / Shift + ← →"],
                    ["回到开头 / 结尾", "Home / End"],
                    ["取消选择 / 关闭弹窗", "Esc"],
                  ].map(([name, key]) => (
                    <div key={name}>
                      <span>{name}</span>
                      <kbd>{key}</kbd>
                    </div>
                  ))}
                </div>
              )}
              {modal === "open" && <ProjectList documents={savedList} currentId={doc.id} busy={busy} onOpen={(d)=>
                        run(async () => {
                          if (dirty) await save();
                          const loaded = await api("load?id=" + d.id);
                          current.current=ensureTimeline(retimeEditorDocument(loaded,30));setHistory({past:[],present:current.current,future:[]});
                          const url=new URL(location.href);url.searchParams.set('document',loaded.id);window.history.replaceState(null,'',url);setSaveStatus({state:'saved',id:loaded.id});
                          setSelected("");
                          setDirty(false);
                          seek(0);
                          setModal("");
                          notify("已打开 " + loaded.name);
                        })
              }/>}
              {modal === "media" && (
                <>
                  <h3>底片</h3>
                  <FilePicker
                    label={doc.source ? "更换底片" : "选择底片"}
                    kind="video"
                    value={doc.source?.path}
                    onImported={importProjectSource}
                  />
                  {doc.source && (
                    <p className="hint">
                      当前画幅 {doc.canvas.width} × {doc.canvas.height}
                    </p>
                  )}
                  <button onClick={() => mutate((d) => (d.source = null))}>
                    移除底片
                  </button>
                  <div className="group" />
                  <h3>项目画布</h3>
                  <p className="hint">画布尺寸用于作品排版和导出，预览窗口会等比缩放显示。</p>
                  <AspectControl
                    value={`${doc.canvas.width}x${doc.canvas.height}`}
                    onChange={setRatio}
                  />
                  <p className="hint">
                    有横竖版的模板随画幅排版；固定版式模板等比放入新画幅。
                  </p>
                  {[
                    ["width", "宽度"],
                    ["height", "高度"],
                    ["durationFrames", "总帧数"],
                  ].map(([k, n]) => (
                    <Field
                      key={k}
                      label={n}
                      value={doc.canvas[k]}
                      min={1}
                      onChange={(v: number) => {
                        v = Math.max(1, Math.round(v));
                        if (k === "durationFrames") {
                          try {
                            apply(resizeTimeline(current.current, v));
                          } catch (e: any) {
                            notify(e.message, true);
                          }
                          return;
                        }
                        mutate((d) => (d.canvas[k] = v));
                      }}
                    />
                  ))}
                  <div className="studio-preview-settings">
                    <h3>预览</h3>
                    <dl><div><dt>时间轴帧率</dt><dd>{fps} fps</dd></div><div><dt>画面显示</dt><dd>等比适应窗口</dd></div></dl>
                    <p className="hint">当前没有独立的预览清晰度档位。编辑时间轴固定为 30 fps；最终帧率在「导出」中选择，预览窗口大小不影响导出分辨率。</p>
                  </div>
                </>
              )}
              {modal === "chapters" && (
                <>
                  <p className="hint">
                    选择字幕文件或粘贴 SRT，点击智能总结。Codex
                    会概括章节，系统从原字幕定位时间；你可以继续调整。也可下载任务交给当前会话。
                  </p>
                  <FilePicker
                    label="选择字幕文件"
                    kind="text"
                    onText={(text) => setSrt(text)}
                  />
                  <textarea
                    aria-label="SRT 字幕"
                    value={srt}
                    placeholder="1\n00:00:00,000 --> 00:00:03,000\n字幕内容"
                    onChange={(e) => setSrt(e.target.value)}
                  />
                  <button
                    className="primary"
                    disabled={!srt || chapterJob?.status === "running"}
                    onClick={() =>
                      run(async () => {
                        chapterContext.current = JSON.stringify({
                          id: doc.id,
                          canvas: doc.canvas,
                        });
                        setChapterJob(
                          await api("chapters/summarize", {
                            srt,
                            canvas: doc.canvas,
                          }),
                        );
                        notify("Codex 正在总结章节…");
                      })
                    }
                  >
                    {chapterJob?.status === "running"
                      ? "正在总结…"
                      : "智能总结章节"}
                  </button>
                  <button
                    onClick={() =>
                      run(async () => {
                        const r = await api("chapters/prepare", {
                          srt,
                          canvas: doc.canvas,
                        });
                        setCues(r.cues);
                        setPrompt(r.prompt);
                        notify(`已读取 ${r.cues.length} 条字幕`);
                      })
                    }
                  >
                    读取字幕
                  </button>
                  {prompt && (
                    <>
                      <button
                        onClick={() => download("chapter-task.md", prompt)}
                      >
                        下载总结任务
                      </button>
                      <textarea aria-label="总结任务" readOnly value={prompt} />
                      <textarea
                        aria-label="章节总结 JSON"
                        value={summary}
                        onChange={(e) => setSummary(e.target.value)}
                        placeholder='[{"title":"开场","sourceCueIds":["1","2"]}]'
                      />
                      <button
                        onClick={() =>
                          run(async () => {
                            const chapters = await api("chapters/map", {
                              summary: JSON.parse(summary),
                              cues,
                              canvas: doc.canvas,
                            });
                            mutate((d) => {
                              let progress = d.instances.find(
                                (i: Inst) => i.assetId === "chapter-progress",
                              );
                              if (!progress) {
                                progress = makeEditorInstance(
                                  "chapter-progress",
                                  d,
                                  0,
                                );
                                d.instances.push(progress);
                              }
                              progress.props.chapters = chapters;
                              progress.props.sourceCues = cues;
                            });
                            notify("章节已按字幕时间生成");
                          })
                        }
                      >
                        应用章节总结
                      </button>
                    </>
                  )}
                  {doc.instances
                    .filter((i: Inst) => i.assetId === "chapter-progress")
                    .map((i: Inst) => (
                      <div key={i.id}>
                        <h3>调整章节</h3>
                        {i.props.chapters.map((c: any, n: number) => (
                          <div className="chapter-row" key={c.id}>
                            <input
                              aria-label={"章节标题 " + (n + 1)}
                              value={c.title}
                              onChange={(e) =>
                                mutate(
                                  (d) =>
                                    (d.instances.find(
                                      (x: Inst) => x.id === i.id,
                                    ).props.chapters[n].title = e.target.value),
                                )
                              }
                            />
                            <Field
                              label="开始帧"
                              value={c.startFrame}
                              min={
                                n ? i.props.chapters[n - 1].startFrame + 1 : 0
                              }
                              max={c.endFrame - 1}
                              onChange={(v: number) => {
                                if (!n) return;
                                v = Math.max(
                                  i.props.chapters[n - 1].startFrame + 1,
                                  Math.min(c.endFrame - 1, Math.round(v)),
                                );
                                mutate((d) => {
                                  const ch = d.instances.find(
                                    (x: Inst) => x.id === i.id,
                                  ).props.chapters;
                                  ch[n].startFrame = v;
                                  ch[n - 1].endFrame = v;
                                });
                              }}
                            />
                            <div className="row">
                              <button
                                disabled={c.endFrame - c.startFrame < 2}
                                onClick={() =>
                                  mutate((d) => {
                                    const ch = d.instances.find(
                                      (x: Inst) => x.id === i.id,
                                    ).props.chapters;
                                    const middle = Math.floor(
                                      (c.startFrame + c.endFrame) / 2,
                                    );
                                    ch[n].endFrame = middle;
                                    ch.splice(n + 1, 0, {
                                      ...c,
                                      id: uid(),
                                      title: c.title + "（后半）",
                                      startFrame: middle,
                                      sourceCueIds: [],
                                    });
                                  })
                                }
                              >
                                拆成两章
                              </button>
                              <button
                                disabled={n === i.props.chapters.length - 1}
                                onClick={() =>
                                  mutate((d) => {
                                    const ch = d.instances.find(
                                      (x: Inst) => x.id === i.id,
                                    ).props.chapters;
                                    ch[n].endFrame = ch[n + 1].endFrame;
                                    ch[n].sourceCueIds = [
                                      ...ch[n].sourceCueIds,
                                      ...ch[n + 1].sourceCueIds,
                                    ];
                                    ch.splice(n + 1, 1);
                                  })
                                }
                              >
                                合并下一章
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                </>
              )}
              {modal === "export" && (
                <>
                  {clipTarget && <fieldset className="export-scope" disabled={busy||['running','cancelling'].includes(job?.status)}>
                    <legend>选择导出范围</legend>
                    <div className="export-scope-options">
                      {clipTarget.kind==='instance' && <button className="export-scope-card" aria-pressed={exportMode==='single-layer'} onClick={()=>setExportMode('single-layer')}>
                        <Icon name="layers" size={20}/><strong>仅此模板图层</strong><span>不含底片与其他模板</span><small>透明图层 MOV · 整镜模板 MP4</small>
                      </button>}
                      <button className="export-scope-card" aria-pressed={exportMode==='clip'} onClick={()=>setExportMode('clip')}>
                        <Icon name="play" size={20}/><strong>该时段全部图层</strong><span>按模块起止时间截取完整画面</span><small>包含底片与声音 · MP4</small>
                      </button>
                    </div>
                    <p className="hint">保存到桌面「产物」中的本期视频目录；无法识别期数时直接放在「产物」外层。透明图层保留 MOV。</p>
                  </fieldset>}
                  <div className="export-framerate">
                    <label>导出帧率</label>
                    <div className="option-segments">
                      {[24, 25, 30, 50, 60].map((n) => (
                        <button
                          key={n}
                          aria-pressed={exportFps === n}
                          disabled={busy||["running","cancelling"].includes(job?.status)}
                          onClick={() => setExportFps(n)}
                        >
                          {n} 帧
                        </button>
                      ))}
                    </div>
                  </div>
                  {!clipTarget&&<select
                    aria-label="导出方式"
                    disabled={busy||["running","cancelling"].includes(job?.status)}
                    value={exportMode}
                    onChange={(e) => setExportMode(e.target.value)}
                  >
                    {clipTarget?.kind==='instance'&&<option value="single-layer">仅此模板图层</option>}
                    {clipTarget&&<option value="clip">该时段全部图层 · MP4</option>}
                    <option value="instances">
                      逐动画导出 · {doc.instances.length} 个文件
                    </option>
                    <option value="full">全部导出 · 含底片的完整视频</option>
                    <option value="layer">整条动画层 · 合成一个 MOV</option>
                  </select>}
                  {!['clip','single-layer'].includes(exportMode)&&<p className="hint">
                    透明动画使用
                    MOV，保留原画幅与位置。整镜模板自带的背景也会保留，合成 MOV
                    不会自动去底。逐动画文件从自身起点开始，附原片对时清单。
                  </p>}
                  {planExportReport.requiresAcknowledgement&&<div className="production-plan-export-gaps"><strong>制作计划尚有缺口</strong><ul>{planExportReport.missing.map(m=><li key={m.shotId+'/'+m.slotId}>{m.title}：{m.reason}</li>)}{planExportReport.emptyRanges.map((r,i)=><li key={r.shotId+'/'+i}>第 {(r.startFrame/fps).toFixed(2)}–{((r.startFrame+r.durationFrames)/fps).toFixed(2)} 秒没有实际画面，导出可能出现空画面。</li>)}</ul><label><input type="checkbox" checked={planAcknowledged} onChange={e=>setPlanAcknowledged(e.target.checked)}/>我已查看缺口，继续使用当前实际画面导出</label><small>计划说明和占位块不会进入成片。</small></div>}
                  <button
                    className="primary"
                    disabled={
                      (planExportReport.requiresAcknowledgement&&!planAcknowledged) || busy ||
                      ["running","cancelling"].includes(job?.status) ||
                      (!doc.instances.length &&
                        !(exportMode === "full" && doc.source)&&!(['clip','single-layer'].includes(exportMode)&&clipTarget))
                    }
                    onClick={() =>
                      run(async () => {
                        setError(false);
                        setExportSubmitting("正在保存当前编辑…");
                        try {
                        const saved = await save();
                        setExportSubmitting("正在提交导出任务…");
                        setJob(
                          await api("export", {
                            documentId: saved.id,
                            planAcknowledged,
                            mode: exportMode,
                            target:['clip','single-layer'].includes(exportMode)?clipTarget:undefined,
                            fps: exportFps,
                          }),
                        );
                        notify("已加入渲染队列");
                        } finally { setExportSubmitting(""); }
                      })
                    }
                  >
                    {exportSubmitting || (['running','cancelling'].includes(job?.status)?'导出进行中':'开始导出')}
                  </button>
                  {['running','cancelling'].includes(job?.status)&&<button className="export-cancel" disabled={job.status==='cancelling'} onClick={()=>run(async()=>{setJob(await api('cancel',{id:job.id}));notify('正在停止本次导出');})}>
                    {job.status==='cancelling'?'正在取消…':'取消导出'}
                  </button>}
                  {exportSubmitting && <p role="status" aria-live="polite">{exportSubmitting}</p>}
                  {error && <p className="export-error" role="alert">{notice}</p>}
                  {job && (
                    <>
                      <h3>
                        {job.status === "cancelled" ? "已取消导出" : job.status === "cancelling" ? "正在取消导出" : job.status === "running"
                          ? "正在导出"
                          : job.status === "complete"
                            ? "导出完成"
                            : "部分导出失败"}
                      </h3>
                      {job.items.map((it: any) => (
                        <div className="job-item" key={it.id}>
                          <span>
                            {it.filename}
                            <small>
                              {" "}
                              ·{" "}
                              {it.status === "cancelled" ? "已取消" : it.status === "cancelling" ? "正在取消" : it.status === "complete"
                                ? "完成"
                                : it.status === "failed"
                                  ? "失败"
                                  : it.status === "rendering"
                                    ? "渲染中"
                                    : "排队中"}
                            </small>
                            <ExportProgress item={it} />
                            {it.status==='complete'&&it.deliveryPath&&<small style={{display:'block',overflowWrap:'anywhere'}}>已保存到：{it.deliveryPath}</small>}
                            {it.error && (
                              <details>
                                <summary>查看错误</summary>
                                <pre
                                  style={{
                                    maxWidth: 480,
                                    whiteSpace: "pre-wrap",
                                  }}
                                >
                                  {it.error}
                                </pre>
                              </details>
                            )}
                          </span>
                          {it.status === "complete" && (
                            <a href={it.url} download>
                              下载
                            </a>
                          )}
                        </div>
                      ))}
                      {job.status === "failed" && (
                        <button
                          onClick={() =>
                            run(async () =>
                              setJob(await api("retry", { id: job.id })),
                            )
                          }
                        >
                          仅重试失败项
                        </button>
                      )}
                      <button
                        onClick={() =>
                          download(
                            "manifest.json",
                            JSON.stringify(job, null, 2),
                          )
                        }
                      >
                        下载对时清单
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </ProjectMediaContext.Provider>
    </ControlGestures.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
