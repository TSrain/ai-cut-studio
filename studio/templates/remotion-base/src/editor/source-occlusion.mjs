import {resolveSceneBackground} from './scene-background.mjs';
/** Only suppress pixels when a known opaque scene covers the complete canvas. */
export function coversSource(instance, asset, responsive, frame, opacity = 1) {
  if (opacity < 1) return false;
  if (frame < instance.startFrame || frame >= instance.startFrame + instance.durationFrames) return false;
  if (instance.assetId!=='source-pip' && resolveSceneBackground(instance.props??{})) return true;
  if (!responsive || !asset) return false;
  const props = instance.props ?? {};
  const tune = props.tune ?? {};
  if ((tune.x ?? 0) !== 0 || (tune.y ?? 0) !== 0 || (tune.scale ?? 1) !== 1) return false;
  if (props.editorBackground === 'transparent') return false;
  const background = asset.exportBackground;
  if (background?.mode === 'opaque') return true;
  if (background?.mode === 'conditional') {
    const value = props.variant?.[background.variantKey] ?? asset.defaultProps?.variant?.[background.variantKey];
    return value !== undefined && value !== background.value;
  }
  return false;
}
