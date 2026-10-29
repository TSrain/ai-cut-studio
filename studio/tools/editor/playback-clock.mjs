// Playback is transient UI state. Only the transport and playhead subscribe;
// documents, history, the asset library and inspector must not render per frame.
export function createPlaybackClock() {
  let frame = 0;
  const listeners = new Set();
  return {
    getSnapshot: () => frame,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setFrame(next) {
      if (!Number.isInteger(next) || next < 0)
        throw new RangeError("Invalid playback frame");
      if (next === frame) return;
      frame = next;
      for (const listener of listeners) listener();
    },
  };
}
