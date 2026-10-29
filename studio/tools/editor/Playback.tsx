import React, { useSyncExternalStore } from "react";
import { Icon } from "./Icon";
import { formatStudioTime } from "./studio-state.mjs";
import { createPlaybackClock } from "./playback-clock.mjs";
import type {TimelineHoverController} from './timeline-hover.mjs';

type Clock = ReturnType<typeof createPlaybackClock>;
export function PlaybackOverlay({
  clock,
  hoverPreview,
  fps,
  duration,
  playing,
  buffering,
  onToggle,
}: {
  clock: Clock;
  hoverPreview: TimelineHoverController;
  fps: number;
  duration: number;
  playing: boolean;
  buffering: boolean;
  onToggle(): void;
}) {
  const frame = useSyncExternalStore<number>(clock.subscribe, clock.getSnapshot);
  const hoverFrame=useSyncExternalStore(hoverPreview.subscribe,hoverPreview.getSnapshot);
  return (
    <div className="preview-playback-overlay">
      <button
        className="preview-play-toggle"
        aria-label={playing ? "暂停" : "播放"}
        title={playing ? "暂停（空格）" : "播放（空格）"}
        onClick={onToggle}
      >
        <Icon name={playing ? "pause" : "play"} size={20} />
      </button>
      {buffering && <span className="preview-buffering" role="status">素材加载中…</span>}
      <span className={'preview-timecode'+(hoverFrame!==null?' is-hover-preview':'')} aria-label={hoverFrame!==null?'悬停预览时间':'播放时间'} title="当前时间 / 总时长（分:秒:帧）">
        {hoverFrame!==null&&<small>预览</small>}{formatStudioTime(hoverFrame??frame, fps)} / {formatStudioTime(duration, fps)}
      </span>
    </div>
  );
}

export function TimelinePlayhead({
  clock,
  labelWidth,
  pxPerFrame,
  onPointerDown,
}: {
  clock: Clock;
  labelWidth: number;
  pxPerFrame: number;
  onPointerDown(event: React.PointerEvent): void;
}) {
  const frame = useSyncExternalStore<number>(
    clock.subscribe,
    clock.getSnapshot,
  );
  return (
    <div
      className="playhead-hit"
      aria-label="拖动播放头"
      onPointerDown={onPointerDown}
      style={{
        left: labelWidth - 8,
        transform: `translateX(${frame * pxPerFrame}px)`,
      }}
    >
      <div className="playhead-grip" />
      <div className="playhead" />
    </div>
  );
}
