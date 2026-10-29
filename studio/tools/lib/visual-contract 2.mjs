import {readFile} from 'node:fs/promises';

const KITS = new Set(['impact', 'editorial', 'human', 'modern', 'tech-data']);
const ENGINES = new Set(['remotion', 'hyperframes', 'hybrid']);

const requiredString = (errors, value, path) => {
  if (typeof value !== 'string' || value.trim() === '') errors.push(`${path} is required`);
};

export const validateVisualContract = (value) => {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {ok: false, errors: ['contract must be an object']};
  }
  if (value.version !== 1) errors.push('version must equal 1');
  requiredString(errors, value.project, 'project');
  if (value.mode !== 'visual-first') errors.push('mode must equal visual-first');

  const canvas = value.canvas ?? {};
  if (![canvas.width, canvas.height].every(Number.isInteger) || canvas.width % 2 || canvas.height % 2) {
    errors.push('canvas.width and canvas.height must be even integers');
  }
  if (!Number.isInteger(canvas.fps) || canvas.fps <= 0) errors.push('canvas.fps must be a positive integer');
  if (!(canvas.durationSeconds > 0)) errors.push('canvas.durationSeconds must be greater than 0');

  const density = value.density ?? {};
  if (!(density.target >= 1 && density.target <= 10)) errors.push('density.target must be between 1 and 10');
  if (!(density.occupancyMin >= 0 && density.occupancyMin <= 1)) errors.push('density.occupancyMin must be between 0 and 1');
  if (!(density.occupancyMax >= 0 && density.occupancyMax <= 1)) errors.push('density.occupancyMax must be between 0 and 1');
  if (density.occupancyMin > density.occupancyMax) errors.push('density.occupancyMin must not exceed occupancyMax');
  if (!Number.isInteger(density.layerCount) || density.layerCount < 1) errors.push('density.layerCount must be a positive integer');

  const focus = value.focus ?? {};
  requiredString(errors, focus.primary, 'focus.primary');
  if (!Array.isArray(focus.secondary)) errors.push('focus.secondary must be an array');
  else if (focus.secondary.length > 2) errors.push('focus.secondary must contain at most 2 items');

  const typography = value.typography ?? {};
  if (!KITS.has(typography.kit)) errors.push('typography.kit is required');
  for (const field of ['displayRole', 'bodyRole', 'dataRole']) requiredString(errors, typography[field], `typography.${field}`);

  const assets = value.assets ?? {};
  for (const field of ['allowBrandLogos', 'allowScreenshots', 'allowUnknownNetworkImages', 'cacheSelectedLocally']) {
    if (assets[field] !== true) errors.push(`assets.${field} must equal true`);
  }
  if (!['exact', 'illustrative'].includes(value.facts?.mode)) errors.push('facts.mode must be exact or illustrative');

  if (!Array.isArray(value.shots) || value.shots.length === 0) errors.push('shots must contain at least one shot');
  else value.shots.forEach((shot, index) => {
    const prefix = `shots[${index}]`;
    requiredString(errors, shot.id, `${prefix}.id`);
    requiredString(errors, shot.objective, `${prefix}.objective`);
    requiredString(errors, shot.startAnchor, `${prefix}.startAnchor`);
    requiredString(errors, shot.endAnchor, `${prefix}.endAnchor`);
    if (!(shot.durationSeconds > 0)) errors.push(`${prefix}.durationSeconds must be greater than 0`);
    if (!ENGINES.has(shot.engine)) errors.push(`${prefix}.engine must be remotion, hyperframes, or hybrid`);
  });

  return {ok: errors.length === 0, errors};
};

export const readVisualContract = async (path) => {
  const value = JSON.parse(await readFile(path, 'utf8'));
  const result = validateVisualContract(value);
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return value;
};
