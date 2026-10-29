// Transient preview state. The committed clock remains the editing authority.
export function createTimelineHover({clock,seekTo,getDuration,isPlaying}) {
 let frame=null,settling=null,pointerSeek=null;
 const listeners=new Set();
 const clamp=n=>Math.max(0,Math.min(getDuration()-1,Math.round(n)));
 const publish=next=>{if(frame===next)return;frame=next;for(const fn of listeners)fn();};
 const seek=n=>{pointerSeek=null;const target=clamp(n);settling=target;clock.setFrame(target);publish(null);seekTo(target);};
 return {
  getSnapshot:()=>frame,
  subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
  preview(n){if(isPlaying()||!Number.isFinite(n))return;const target=clamp(n);if(frame===target)return;settling=null;publish(target);seekTo(target);},
  cancel(){if(frame===null)return;const target=clock.getSnapshot();settling=target;publish(null);seekTo(target);},
  // Capture before pointerdown cancels preview; consume only for that click.
  capturePointerSeek(x){pointerSeek=x!==null&&frame!==null?{x,frame}:null;},
  resolvePointerSeek(x,fallback){const captured=pointerSeek;pointerSeek=null;return captured?.x===x?captured.frame:fallback;},
  seek,
  startPlayback(){if(frame!==null){clock.setFrame(frame);publish(null);}settling=null;},
  receiveFrame(n){if(frame!==null)return;if(settling!==null&&n!==settling)return;settling=null;clock.setFrame(n);},
  reset(){pointerSeek=null;settling=null;publish(null);},
 };
}
