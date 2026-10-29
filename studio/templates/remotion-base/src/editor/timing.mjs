export const isInstanceVisible = (instance, globalFrame) =>
  globalFrame >= instance.startFrame && globalFrame < instance.startFrame + instance.durationFrames;

export const sortInstances = (instances) =>
  instances.map((instance, order) => ({instance, order})).sort((a, b) => a.instance.zIndex - b.instance.zIndex || a.order - b.order).map(({instance}) => instance);

export const localSequenceStart = (instance, rangeStartFrame = 0) => instance.startFrame - rangeStartFrame;
