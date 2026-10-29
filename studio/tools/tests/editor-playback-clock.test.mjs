import test from "node:test";
import assert from "node:assert/strict";
import { createPlaybackClock } from "../editor/playback-clock.mjs";

test("frame consumers see each advance and loop rewind without document edits", () => {
  const clock = createPlaybackClock();
  const frames = [];
  const unsubscribe = clock.subscribe(() => frames.push(clock.getSnapshot()));
  for (let frame = 1; frame <= 30; frame++) clock.setFrame(frame);
  clock.setFrame(0);
  assert.deepEqual(frames, [...Array.from({ length: 30 }, (_, i) => i + 1), 0]);
  unsubscribe();
  clock.setFrame(8);
  assert.equal(frames.length, 31);
  assert.equal(clock.getSnapshot(), 8);
});

test("duplicate pause/seek notifications do not rerender subscribers", () => {
  const clock = createPlaybackClock();
  let notifications = 0;
  clock.subscribe(() => notifications++);
  clock.setFrame(90);
  clock.setFrame(90);
  clock.setFrame(90);
  assert.equal(notifications, 1);
  assert.equal(clock.getSnapshot(), 90);
});

test("transport and playhead subscriptions have independent lifetimes", () => {
  const clock = createPlaybackClock();
  const transport = [],
    playhead = [];
  const stopTransport = clock.subscribe(() =>
    transport.push(clock.getSnapshot()),
  );
  clock.subscribe(() => playhead.push(clock.getSnapshot()));
  clock.setFrame(10);
  stopTransport();
  clock.setFrame(11);
  const stopNewTransport = clock.subscribe(() =>
    transport.push(clock.getSnapshot()),
  );
  assert.equal(clock.getSnapshot(), 11);
  clock.setFrame(12);
  stopNewTransport();
  assert.deepEqual(transport, [10, 12]);
  assert.deepEqual(playhead, [10, 11, 12]);
});

test("invalid frames cannot poison playback consumers", () => {
  const clock = createPlaybackClock();
  clock.setFrame(12);
  for (const frame of [NaN, Infinity, -1, 2.5])
    assert.throws(() => clock.setFrame(frame), RangeError);
  assert.equal(clock.getSnapshot(), 12);
});
