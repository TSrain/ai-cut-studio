import {mediaRecognitionStatus} from './media-recognition-status.mjs';
import {ProjectMediaUpload} from './ProjectMediaUpload';
import {useProjectMedia} from './ProjectMediaContext';
import React, { useEffect, useRef, useState } from "react";
import {HoverVideo} from "./HoverVideo";
import { FilePicker } from "./FilePicker";

export interface StudioItem {
  id: string;
  name: string;
  kind: "image" | "video" | "audio" | "font" | "reference";
  path: string;
  url: string;
  thumbnail?: string;
  bytes: number;
  usageCount: number;
  scope?: "project" | "shared";
  addedAt?: string;
  useCount?: number;
  sharedId?: string;
  stagedPath?: string;
  deletable?: boolean;
  deleteReason?: string;
  publicPath?: string;
  audioCategory?: "music" | "effect" | "other";
  audioPending?: boolean;
}
export interface StudioLibraryProps {
  category: string;
  selectedId?: string;
  onPreview(item: StudioItem): void;
  onManage(section: string): void;
  refreshKey?: number;
  management?: boolean;
}
export function StudioLibrary({
  category,
  selectedId,
  onPreview,
  onManage,
  refreshKey,
  management = false,
}: StudioLibraryProps) {
  const projectMedia=useProjectMedia();
  const libraryRef = useRef<HTMLElement>(null);
  const [scope,setScope]=useState<"project"|"shared">("project");
  const [hovered, setHovered] = useState<string|null>(null);
  const [focused, setFocused] = useState<string|null>(null);
  const [items, setItems] = useState<StudioItem[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [audioIndexing,setAudioIndexing]=useState(false);
  const [error, setError] = useState("");
  const [limit, setLimit] = useState(60);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setAudioIndexing(false);
    setError("");
    const params=category=== "media" ? "?scope="+scope+"&projectId="+encodeURIComponent(projectMedia.projectId) : "";
    let timer:ReturnType<typeof setTimeout>|undefined;
    const read=()=>fetch("/api/editor/library"+params, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "素材库读取失败");
        return data;
      })
      .then((data) => {
        if(controller.signal.aborted)return;
        setItems(data.items || []);
        setAudioIndexing(category==='audio'&&!!data.audioIndexing);
        if(category==='audio'&&data.audioIndexing)timer=setTimeout(read,1000);
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(reason.message || "素材库连接失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    void read();
    return () => {controller.abort();clearTimeout(timer);};
  }, [refreshKey, revision, category, scope, projectMedia.projectId]);
  useEffect(() => {
    setQuery("");
    setFilter("all");
  }, [category]);
  useEffect(() => {
    setLimit(60);
  }, [category, query, filter, scope, projectMedia.projectId]);
  const manageSection =
    category === "media"
      ? "library"
      : category === "audio"
        ? "sfx"
        : category === "references"
          ? "refs"
          : "fonts";
  const kinds =
    category === "media"
      ? ["image", "video"]
      : category === "audio"
        ? ["audio"]
        : category === "fonts"
          ? ["font"]
          : ["reference"];
  const visible = items.filter(
    (item) =>
      kinds.includes(item.kind) &&
      (category !== "audio" || filter === "all" || item.audioCategory === filter) &&
      `${item.name} ${item.path}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  const title =
    category === "media"
      ? "素材"
      : category === "audio"
        ? "声音"
        : category === "fonts"
          ? "字体"
          : "参考";
  return (
    <section ref={libraryRef} className={`studio-library${management ? ' studio-audio-management' : ''}`} aria-label={`${title}库`}>
      <header className="studio-library-header">
        <h2>{category === "media" ? "素材" : category === "audio" ? "声音素材" : `${title}库`}</h2>
      <input
        className="studio-library-search"
        type="search"
        placeholder={`搜索${title}`}
        aria-label={`搜索${title}`}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
        {!management && <button type="button" onClick={() => onManage(manageSection)}>
          管理
        </button>}
      </header>
      {category === "media" && <div className="project-media-tabs" aria-label="素材范围">
        {([['project','本项目'],['shared','素材库']] as const).map(([value,label])=><button type="button" key={value} aria-pressed={scope===value} onClick={()=>{setScope(value);setQuery('');}}>{label}</button>)}
      </div>}
      {category === "audio" && (
        <div className="studio-library-filters" aria-label="声音类型">
          {[["all","全部"],["music","配乐"],["effect","音效"]].map(([value, label]) => (
            <button
              type="button"
              key={value}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="studio-library-upload">
        {category === "media" ? (
          scope==='project' ? <ProjectMediaUpload key={projectMedia.projectId} dropTargetRef={libraryRef} onImported={()=>{setFilter('all');setQuery('');setRevision(v=>v+1);}}/> : null
        ) : category === "audio" ? (
          <>{[["music","上传配乐"],["effect","上传音效"]].map(([value,label])=><FilePicker key={value} compact label={label} kind="audio" audioCategory={value} onImported={result=>{setFilter(result.audioCategory??value);setQuery('');setRevision(v=>v+1);}}/>)}</>
        ) : (
          <button type="button" onClick={() => onManage(manageSection)}>
            {category === "references" ? "管理参考" : `上传${title}`}
          </button>
        )}
      </div>
      {!loading&&audioIndexing&&<p role="status" className="hint">正在补全声音分类，可先浏览和试听。</p>}
      {loading ? (
        <p role="status">正在读取素材…</p>
      ) : error ? (
        <div role="alert">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => setRevision((value) => value + 1)}
          >
            重试
          </button>
        </div>
      ) : visible.length === 0 ? (
        <p className="studio-library-empty">
          {audioIndexing ? "分类更新中…" : query || filter !== "all"
            ? category === "media" ? "没有匹配的素材，请调整搜索。" : "没有匹配的素材，请调整搜索或类型。"
            : category=== "media" && scope=== "shared" ? "暂无公共素材，可在本项目预览素材时添加。" : `暂无${title}，可通过上方入口导入。`}
        </p>
      ) : (
        management ? <div className="studio-audio-list">{visible.slice(0,limit).map(item=><div className="studio-audio-row" key={item.id}>
          <div><strong title={item.name}>{item.name}</strong><small>{item.audioCategory==='music'?'配乐':item.audioCategory==='effect'?'音效':'声音'}</small></div>
          <audio src={item.url} controls preload="metadata" aria-label={`试听 ${item.name}`} onPlay={event=>{const current=event.currentTarget;current.closest('.studio-audio-list')?.querySelectorAll('audio').forEach(audio=>{if(audio!==current)audio.pause();});}}/>
          <button onClick={()=>onPreview(item)}>查看与使用</button>
        </div>)}</div> : <div className="studio-library-grid">
          {visible.slice(0, limit).map((item) => {
            const status = category === "media" && scope === "project" && projectMedia.recognition
              ? mediaRecognitionStatus(item, projectMedia.recognition) : null;
            return (
            <button
              type="button"
              className={`studio-library-card${selectedId === item.id ? " is-selected" : ""}`}
              key={item.id}
              onMouseEnter={()=>setHovered(item.id)}
              onMouseLeave={()=>setHovered(null)}
              onFocus={()=>setFocused(item.id)}
              onBlur={()=>setFocused(null)}
              draggable={item.kind==='image'||item.kind==='video'}
              onDragStart={event=>{event.dataTransfer.setData('application/x-motion-media',JSON.stringify({id:item.id,kind:item.kind,scope:item.scope,projectId:projectMedia.projectId}));event.dataTransfer.effectAllowed='copy';}}
              onClick={() => onPreview(item)}
              aria-label={`预览 ${item.name}`}
              aria-pressed={selectedId === item.id}
            >
              <span className="studio-library-thumbnail">
                {status && <span title={status==='unmatched'?'素材已保留在项目库；未找到可靠匹配，不自动入轨':undefined} className={`studio-media-status is-${status}`} role="status" aria-label={`${item.name}：${({recognizing:"识别中",filled:"已填充",failed:"识别失败",cancelled:"已取消识别",stale:"待重新匹配",ignored:"已忽略",unmatched:"未匹配入轨"})[status]}`}>{({recognizing:"识别中",filled:"已填充",failed:"识别失败",cancelled:"已取消识别",stale:"待重新匹配",ignored:"已忽略",unmatched:"未匹配入轨"})[status]}</span>}
                {item.kind === "image" || item.kind === "reference" ? (
                  <img draggable={false} src={item.thumbnail || item.url} alt="" loading="lazy" />
                ) : item.kind === "video" ? (
                  <HoverVideo src={item.url} poster={item.thumbnail} active={(hovered??focused)===item.id}/>
                ) : (
                  <span aria-hidden="true">
                    {item.kind === "audio"
                      ? "♫"
                      : item.kind === "font"
                        ? "Aa"
                        : "参考"}
                  </span>
                )}
              </span>
              <span className="studio-library-name" title={item.path}>
                {item.name}
              </span>
              <small>
                {item.kind === "video"
                  ? "视频"
                  : item.kind === "image"
                    ? "图片"
                    : item.kind === "audio"
                      ? item.audioCategory==='music'?'配乐':item.audioCategory==='effect'?'音效':'声音'
                      : item.kind === "font"
                        ? "字体"
                        : "参考"}{" "}
                · 预览
              </small>
            </button>
          );})}
        </div>
      )}
      {!loading && !error && visible.length > limit && (
        <button
          type="button"
          className="studio-library-load-more"
          onClick={() => setLimit((value) => value + 60)}
        >
          加载更多（剩余 {visible.length - limit} 项）
        </button>
      )}
    </section>
  );
}
