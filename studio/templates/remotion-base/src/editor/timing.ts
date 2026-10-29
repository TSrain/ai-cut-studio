import type {EditorInstance} from './types';

export const isInstanceVisible = (instance: Pick<EditorInstance, 'startFrame' | 'durationFrames'>, globalFrame: number) =>
  globalFrame >= instance.startFrame && globalFrame < instance.startFrame + instance.durationFrames;

export const sortInstances = <T extends Pick<EditorInstance, 'zIndex'>>(instances: T[]) =>
  instances.map((instance, order) => ({instance, order})).sort((a, b) => a.instance.zIndex - b.instance.zIndex || a.order - b.order).map(({instance}) => instance);

export const localSequenceStart = (instance: Pick<EditorInstance, 'startFrame'>, rangeStartFrame = 0) => instance.startFrame - rangeStartFrame;
