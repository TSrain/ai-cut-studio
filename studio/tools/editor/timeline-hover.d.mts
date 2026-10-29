type Clock={getSnapshot():number;setFrame(frame:number):void};
export type TimelineHoverController={
 getSnapshot():number|null;
 subscribe(listener:()=>void):()=>void;
 preview(frame:number):void;
 cancel():void;
 capturePointerSeek(clientX:number|null):void;
 resolvePointerSeek(clientX:number,fallback:number):number;
 seek(frame:number):void;
 startPlayback():void;
 receiveFrame(frame:number):void;
 reset():void;
};
export function createTimelineHover(options:{clock:Clock;seekTo(frame:number):void;getDuration():number;isPlaying():boolean}):TimelineHoverController;
