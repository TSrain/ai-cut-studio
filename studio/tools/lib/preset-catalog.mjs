import {resolveSceneBackground} from '../../templates/remotion-base/src/editor/scene-background.mjs';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const PRESET_DOCS_ROOT = join(REPO_ROOT, 'docs', 'presets');

export function readPresetCatalog(root = PRESET_DOCS_ROOT) {
  if (!existsSync(root)) throw new Error(`Preset docs directory does not exist: ${root}`);
  return readdirSync(root, {withFileTypes: true})
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, 'preset.json')))
    .map((entry) => JSON.parse(readFileSync(join(root, entry.name, 'preset.json'), 'utf8')))
    .filter((preset) => preset.engine === 'remotion' && typeof preset.id === 'string' && typeof preset.compositionId === 'string')
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function presetCatalogById(root = PRESET_DOCS_ROOT) {
  return new Map(readPresetCatalog(root).map((preset) => [preset.id, preset]));
}

export function editorAssetBackgroundMode(assetId, props = {}, root = PRESET_DOCS_ROOT) {
  if (props.editorBackground === 'transparent') return 'transparent';
  if (resolveSceneBackground(props)) return 'opaque';
  if (['chapter-progress','source-pip'].includes(assetId)) return 'transparent';
  if (assetId === 'number-beat' && (props.variant?.layout === 'side' || props.variant?.bg === 'transparent')) return 'transparent';
  if (['media-stack','media-split'].includes(assetId)) return 'opaque';
  const preset = presetCatalogById(root).get(assetId);
  if (!preset) throw new Error(`Unknown editor asset: ${assetId}`);
  const condition = preset.output?.alphaWhen;
  const variantValue = condition ? (props.variant?.[condition.variantKey] ?? preset.variants?.[condition.variantKey]?.default) : undefined;
  return condition && variantValue === condition.value ? 'transparent' : 'opaque';
}
