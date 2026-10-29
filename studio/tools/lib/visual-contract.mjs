import {readFile, stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join, resolve} from 'node:path';

const KITS = new Set(['impact', 'editorial', 'human', 'modern', 'tech-data', 'minimal']);
const ENGINES = new Set(['remotion', 'hyperframes', 'hybrid']);
const PROFILES = new Set(['visual-max', 'editorial-luxe', 'brand-energy', 'data-cinematic']);

const requiredString = (errors, value, path) => {
  if (typeof value !== 'string' || value.trim() === '') errors.push(`${path} is required`);
};

const isBlank = (value) => typeof value !== 'string' || value.trim() === '';

/**
 * preset 匹配记录:每镜必须留下「查过菜单、结论是什么、为什么」的痕迹。
 *
 * 四个字段(B-roll 硬性,其他工作流可选):
 *   presetCandidates  —— 读 docs/presets/MENU.md 后进入比较的 preset id 列表(可为空数组 = 一个都没沾边)
 *   selectedPreset    —— 本次所选原生 preset id；null = 未选择原生模板，可走 custom
 *   matchReason       —— 选中时：模板如何达到本镜的表达与效果目标
 *   unmatchedReason   —— 未选择时：效果差距、定制收益或用户所选路线，不必虚构槽位失败
 *
 * presetAlternatives —— 并列难分的第二/第三候选,各自带自己的 presetProps。
 * 它们只用来渲「真实文案预览」给用户二选一,选完必须清空(--preset-resolved 会拦)。
 */
const validatePresetMatch = (errors, shot, prefix, {requireMatching, requireResolved}) => {
  const has = (field) => shot[field] !== undefined && shot[field] !== null;
  const candidates = shot.presetCandidates;
  if (candidates !== undefined) {
    if (!Array.isArray(candidates) || candidates.some((c) => isBlank(c))) {
      errors.push(`${prefix}.presetCandidates must be an array of non-blank preset ids`);
    }
  } else if (requireMatching) {
    errors.push(`${prefix}.presetCandidates is required (读过 docs/presets/MENU.md 的痕迹;一个都没沾边就写 [])`);
  }

  const selected = shot.selectedPreset;
  if (selected !== undefined && selected !== null && isBlank(selected)) {
    errors.push(`${prefix}.selectedPreset must be a preset id or null`);
  }
  if (selected === undefined && requireMatching) {
    errors.push(`${prefix}.selectedPreset is required (选择原生模板写 preset id，未选择写 null)`);
  }

  const matched = typeof selected === 'string' && selected.trim() !== '';
  if (matched) {
    if (Array.isArray(candidates) && !candidates.includes(selected)) {
      errors.push(`${prefix}.selectedPreset「${selected}」must appear in presetCandidates`);
    }
    if (!shot.preset || shot.preset.id !== selected) {
      errors.push(`${prefix}.selectedPreset「${selected}」must match ${prefix}.preset.id(选中就要真的挂上 preset)`);
    }
    if (isBlank(shot.matchReason)) errors.push(`${prefix}.matchReason is required when selectedPreset is set`);
    if (has('unmatchedReason')) errors.push(`${prefix}.unmatchedReason must be absent when selectedPreset is set`);
  } else if (selected === null || (requireMatching && selected === undefined)) {
    if (shot.preset) errors.push(`${prefix}.selectedPreset is null but ${prefix}.preset is set(未选择原生模板的镜不许挂 preset)`);
    if (isBlank(shot.unmatchedReason)) {
      errors.push(`${prefix}.unmatchedReason is required when selectedPreset is null(说明未选择原生模板的效果理由或用户选择)`);
    }
    if (has('matchReason')) errors.push(`${prefix}.matchReason must be absent when selectedPreset is null`);
  }

  const alts = shot.presetAlternatives;
  if (alts !== undefined) {
    if (!Array.isArray(alts)) {
      errors.push(`${prefix}.presetAlternatives must be an array`);
    } else {
      if (alts.length > 0 && !matched) {
        errors.push(`${prefix}.presetAlternatives requires a non-null selectedPreset(并列候选是相对选中项而言的)`);
      }
      if (alts.length > 0 && requireResolved) {
        errors.push(
          `${prefix}.presetAlternatives must be empty after the confirmation gate` +
            `(用户已经二选一了:把选中的那个写进 preset/presetProps,再把本字段清空)`,
        );
      }
      alts.forEach((alt, i) => {
        const p = `${prefix}.presetAlternatives[${i}]`;
        if (!alt || typeof alt !== 'object' || Array.isArray(alt)) {
          errors.push(`${p} must be an object {id, version, presetProps}`);
          return;
        }
        requiredString(errors, alt.id, `${p}.id`);
        if (!Number.isInteger(alt.version) || alt.version < 1) errors.push(`${p}.version must be a positive integer`);
        if (!alt.presetProps || typeof alt.presetProps !== 'object' || Array.isArray(alt.presetProps)) {
          errors.push(`${p}.presetProps must be an object(并列候选要用真实文案渲预览,不是空壳)`);
        }
        if (alt.id === selected) errors.push(`${p}.id must differ from selectedPreset`);
        if (Array.isArray(candidates) && !isBlank(alt.id) && !candidates.includes(alt.id)) {
          errors.push(`${p}.id「${alt.id}」must appear in presetCandidates`);
        }
      });
    }
  }
};

const validateDesignIntent = (errors, shot, prefix) => {
  const object = (value, path) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${path} must be an object`); return {};
    }
    return value;
  };
  const strings = (value, path, nonempty = false) => {
    if (!Array.isArray(value) || (nonempty && !value.length) || value.some(isBlank)) {
      errors.push(`${path} must be ${nonempty ? 'a non-empty' : 'an'} array of non-blank strings`);
    }
  };
  const path = `${prefix}.designIntent`;
  const intent = object(shot.designIntent, path);
  for (const key of ['goal', 'concept', 'focus', 'presenterRelation']) requiredString(errors, intent[key], `${path}.${key}`);
  const states = object(intent.states, `${path}.states`);
  for (const key of ['start', 'change', 'end']) requiredString(errors, states[key], `${path}.states.${key}`);
  if (!Array.isArray(intent.beats) || !intent.beats.length) errors.push(`${path}.beats must be a non-empty array`);
  else {
    const ids = new Set();
    intent.beats.forEach((item, index) => {
      const beatPath = `${path}.beats[${index}]`;
      const beat = object(item, beatPath);
      for (const key of ['id', 'anchor', 'action']) requiredString(errors, beat[key], `${beatPath}.${key}`);
      if (ids.has(beat.id)) errors.push(`${beatPath}.id must be unique`);
      ids.add(beat.id);
    });
  }
  const candidates = [];
  if (!Array.isArray(intent.templateOptions)) errors.push(`${path}.templateOptions must be an array`);
  else intent.templateOptions.forEach((item, index) => {
    const optionPath = `${path}.templateOptions[${index}]`;
    const option = object(item, optionPath);
    requiredString(errors, option.presetId, `${optionPath}.presetId`);
    requiredString(errors, option.fit, `${optionPath}.fit`);
    strings(option.gaps, `${optionPath}.gaps`);
    if (candidates.includes(option.presetId)) errors.push(`${optionPath}.presetId must be unique`);
    candidates.push(option.presetId);
  });
  if (JSON.stringify(shot.presetCandidates) !== JSON.stringify(candidates)) errors.push(`${prefix}.presetCandidates must equal designIntent.templateOptions preset ids in order`);
  const custom = object(intent.customOption, `${path}.customOption`);
  for (const key of ['approach', 'benefit', 'cost']) requiredString(errors, custom[key], `${path}.customOption.${key}`);
  const recommendation = object(intent.recommendation, `${path}.recommendation`);
  requiredString(errors, recommendation.reason, `${path}.recommendation.reason`);
  if (!['preset', 'component-custom', 'custom'].includes(recommendation.route)) errors.push(`${path}.recommendation.route is invalid`);
  if (recommendation.route === 'preset') {
    const option = intent.templateOptions?.find?.(item => item?.presetId === shot.selectedPreset);
    if (!option || !Array.isArray(option.gaps) || option.gaps.length) errors.push(`${path} preset route requires a selected candidate without gaps`);
  } else if (shot.selectedPreset !== null) errors.push(`${prefix}.selectedPreset must be null for custom design routes`);
  strings(intent.acceptance, `${path}.acceptance`, true);
  strings(intent.risks, `${path}.risks`);
};

/**
 * @param {object} value 合同对象
 * @param {{requirePresetMatching?: boolean, requirePresetResolved?: boolean}} [options]
 *   requirePresetMatching —— 每镜必须留下 preset 匹配记录,且非 remotion 引擎必须写 engineReason(B-roll 用)
 *   requirePresetResolved —— 追加要求:并列候选已被用户选定并清空(渲视频前那道门)
 */
export const validateVisualContract = (value, options = {}) => {
  const requireMatching = options.requirePresetMatching === true;
  const requireResolved = options.requirePresetResolved === true;
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {ok: false, errors: ['contract must be an object']};
  }
  const hasDesign = value.designIntentVersion !== undefined || (Array.isArray(value.shots) && value.shots.some(shot => shot?.designIntent !== undefined));
  if (hasDesign && value.designIntentVersion !== 1) errors.push('designIntentVersion must equal integer 1');
  if (value.version !== 1) errors.push('version must equal 1');
  requiredString(errors, value.project, 'project');
  if (value.mode !== 'visual-first') errors.push('mode must equal visual-first');
  if (value.profile !== undefined && !PROFILES.has(value.profile)) {
    errors.push('profile must be one of visual-max, editorial-luxe, brand-energy, data-cinematic');
  }

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
    if (shot.tags !== undefined) {
      if (!Array.isArray(shot.tags) || shot.tags.some((t) => typeof t !== 'string' || t.trim() === '')) {
        errors.push(`${prefix}.tags must be an array of non-blank strings`);
      }
    }
    if (shot.preset !== undefined) {
      if (!shot.preset || typeof shot.preset !== 'object' || Array.isArray(shot.preset)) {
        errors.push(`${prefix}.preset must be an object`);
      } else {
        requiredString(errors, shot.preset.id, `${prefix}.preset.id`);
        if (!Number.isInteger(shot.preset.version) || shot.preset.version < 1) {
          errors.push(`${prefix}.preset.version must be a positive integer`);
        }
      }
      if (!shot.presetProps || typeof shot.presetProps !== 'object' || Array.isArray(shot.presetProps)) {
        errors.push(`${prefix}.presetProps must be an object when preset is set`);
      }
    }
    // Remotion 是默认引擎;换成 hyperframes/hybrid 必须在合同里留一句为什么(route.json 的 override 之外的人话版)
    if (shot.engineReason !== undefined && isBlank(shot.engineReason)) {
      errors.push(`${prefix}.engineReason must be a non-blank string`);
    }
    if (requireMatching && ENGINES.has(shot.engine) && shot.engine !== 'remotion' && isBlank(shot.engineReason)) {
      errors.push(
        `${prefix}.engineReason is required for engine「${shot.engine}」` +
          `(Remotion 是默认引擎,切换必须写明理由:换回 Remotion 这镜就等于做失败了在哪)`,
      );
    }
    if (hasDesign) validateDesignIntent(errors, shot, prefix);
    validatePresetMatch(errors, shot, prefix, {requireMatching, requireResolved});
  });

  return {ok: errors.length === 0, errors};
};


const sha256File = async (path) => createHash('sha256').update(await readFile(path)).digest('hex');

const readJson = async (errors, path, label) => {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    errors.push(`${label} is not readable JSON: ${error.message}`);
    return null;
  }
};

const asResolved = (path) => resolve(path);

const validatePreviewTile = async (errors, shot, projectDir, tile) => {
  const id = shot.id;
  const prefix = `preview tile for ${id}`;
  if (!tile || typeof tile !== 'object' || Array.isArray(tile)) {
    errors.push(`${prefix} must be an object`);
    return;
  }
  const expectedProps = join(projectDir, 'shots', id, 'props.json');
  const expectedRoute = join(projectDir, 'shots', id, 'route.json');
  const expectedSignals = join(projectDir, 'shots', id, 'signals.json');
  if (tile.kind !== 'selected') errors.push(`${prefix}.kind must be selected`);
  if (tile.preset !== shot.preset.id) errors.push(`${prefix}.preset must equal ${shot.preset.id}`);
  if (tile.version !== shot.preset.version) errors.push(`${prefix}.version must equal ${shot.preset.version}`);
  if (!Number.isInteger(tile.frame) || tile.frame < 0) errors.push(`${prefix}.frame must be a non-negative integer`);
  if (typeof tile.compositionId !== 'string' || tile.compositionId.trim() === '') {
    errors.push(`${prefix}.compositionId is required`);
  }
  if (asResolved(tile.props ?? '') !== asResolved(expectedProps)) errors.push(`${prefix}.props must point to shots/${id}/props.json`);
  if (asResolved(tile.route ?? '') !== asResolved(expectedRoute)) errors.push(`${prefix}.route must point to shots/${id}/route.json`);
  if (asResolved(tile.signals ?? '') !== asResolved(expectedSignals)) errors.push(`${prefix}.signals must point to shots/${id}/signals.json`);
  if (typeof tile.still !== 'string' || tile.still.trim() === '') errors.push(`${prefix}.still is required`);

  const render = tile.render;
  if (!render || typeof render !== 'object' || Array.isArray(render)) {
    errors.push(`${prefix}.render receipt is required`);
  } else {
    const expectedCommand = [
      'npx', 'remotion', 'still', tile.compositionId,
      `--props=${expectedProps}`,
      `--frame=${tile.frame}`,
      `--scale=${tile.scale ?? 0.4}`,
      tile.still,
    ];
    if (render.status !== 'passed' || render.exitCode !== 0) {
      errors.push(`${prefix}.render must be a passed Remotion still execution`);
    }
    if (asResolved(render.expectedOutput ?? '') !== asResolved(tile.still)) {
      errors.push(`${prefix}.render.expectedOutput must equal tile.still`);
    }
    if (!Array.isArray(render.command) || JSON.stringify(render.command) !== JSON.stringify(expectedCommand)) {
      errors.push(`${prefix}.render.command must match the Remotion still command for preset/props/composition/frame`);
    }
  }

  for (const [field, path] of [
    ['propsSha256', expectedProps],
    ['routeSha256', expectedRoute],
    ['signalsSha256', expectedSignals],
    ['stillSha256', tile.still],
  ]) {
    if (typeof tile[field] !== 'string' || !/^[a-f0-9]{64}$/.test(tile[field])) {
      errors.push(`${prefix}.${field} is required`);
      continue;
    }
    try {
      const actual = await sha256File(path);
      if (actual !== tile[field]) {
        errors.push(`${prefix}.${field.replace('Sha256', '')} sha256 mismatch: ${path}`);
      }
    } catch (error) {
      errors.push(`${prefix} cannot hash ${path}: ${error.message}`);
    }
  }
};

export const validatePresetArtifacts = async (contract, projectDir, options = {}) => {
  const errors = [];
  const exists = async (path) => {
    try {
      const info = await stat(path);
      return info.isFile() && info.size > 0;
    } catch {
      return false;
    }
  };
  const shots = Array.isArray(contract?.shots) ? contract.shots : [];
  let manifest = null;
  if (options.requirePreviewReceipt === true && shots.some(shot => shot?.preset)) {
    const manifestPath = join(projectDir, 'preview', 'preview-manifest.json');
    manifest = await readJson(errors, manifestPath, 'preview/preview-manifest.json');
    if (manifest && manifest.version !== 2) {
      errors.push('preview/preview-manifest.json must be version 2 with render binding receipts');
    }
    if (manifest && !Array.isArray(manifest.tiles)) {
      errors.push('preview/preview-manifest.json tiles must be an array');
    }
  }
  for (const [index, shot] of shots.entries()) {
    if (!shot || typeof shot !== 'object' || !shot.preset) continue;
    const id = typeof shot.id === 'string' && shot.id.trim() ? shot.id : `#${index}`;
    for (const file of ['props.json', 'route.json', 'signals.json']) {
      const relative = join('shots', id, file);
      if (!(await exists(join(projectDir, relative)))) {
        errors.push(`${relative} is required for preset shot ${id}(run tools/expand-presets.mjs, do not hand-draw preset output)`);
      }
    }
    if (manifest && Array.isArray(manifest.tiles)) {
      const tiles = manifest.tiles.filter((tile) => tile?.shot === id && tile?.kind === 'selected');
      if (tiles.length !== 1) {
        errors.push(`preview/preview-manifest.json must contain exactly one selected preview tile for preset shot ${id}`);
      } else {
        await validatePreviewTile(errors, {...shot, id}, projectDir, tiles[0]);
      }
    }
  }
  return {ok: errors.length === 0, errors};
};

export const readVisualContract = async (path, options = {}) => {
  const value = JSON.parse(await readFile(path, 'utf8'));
  const result = validateVisualContract(value, options);
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return value;
};
