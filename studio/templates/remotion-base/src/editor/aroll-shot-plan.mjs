import {cameraEvents} from './camera-clips.mjs';
const EPS = 1e-6;

export const PURPOSES = new Set([
  'hook',
  'emphasis',
  'argument',
  'emotion-build',
  'tension-release',
  'topic-shift',
  'evidence',
  'edit-cover',
]);

export const DEFAULT_LEVELS = Object.freeze({A: 1, B: 1.12, C: 1.18});
export const DEFAULT_ANCHOR = Object.freeze({x: 0.5, y: 0.5});

const r2 = (value) => Math.round(value * 100) / 100;
const startOf = (event) => event.transition === 'slow' ? Number(event.from) : Number(event.at);
const endOf = (event) => event.transition === 'slow' ? Number(event.toTime) : startOf(event);

const levelsOf = (plan) => ({...DEFAULT_LEVELS, ...(plan?.levels ?? {})});
const durationOf = (plan, duration) => Number(duration ?? plan?.duration ?? 0);

const orderedEvents = (plan) => [...(Array.isArray(plan?.events) ? plan.events : [])]
  .sort((a, b) => startOf(a) - startOf(b));

export function validateShotPlan(plan, {duration} = {}) {
  const errors = [];
  const warnings = [];
  if(plan?.clipGroups){try{if(JSON.stringify(cameraEvents(plan,plan.clipGroups))!==JSON.stringify(plan.events))errors.push('clip groups and events differ');}catch(e){errors.push(e.message);}}
  const mediaDuration = durationOf(plan, duration);
  const declaredDuration = Number(plan?.duration ?? mediaDuration);
  const levels = levelsOf(plan);
  const events = orderedEvents(plan);

  if (plan?.version !== 2) errors.push('version must be 2');
  if (!(mediaDuration > 0)) errors.push('duration must be greater than zero');
  if (duration !== undefined && Math.abs(declaredDuration - Number(duration)) > 0.1) {
    errors.push(`duration drift exceeds 0.1s: plan=${declaredDuration}, media=${duration}`);
  }
  if (Math.abs(levels.A - 1) > EPS) errors.push('level A must be 1.00');
  if (!Number.isFinite(levels.B) || levels.B < 1 || levels.B > 1.35) errors.push('level B must be within 1.00–1.35');
  if (!Number.isFinite(levels.C) || levels.C < 1 || levels.C > 1.35) errors.push('level C must be within 1.00–1.35');
  if (!(levels.A <= levels.B && levels.B <= levels.C)) errors.push('levels must satisfy A <= B <= C; equal levels allow a two-level plan');

  const anchor = {...DEFAULT_ANCHOR, ...(plan?.anchor ?? {})};
  if (![anchor.x, anchor.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
    errors.push('anchor x/y must be normalized coordinates within 0–1');
  }
  if (!events.length) errors.push('events must contain at least the initial shot');

  let currentZoom = levels.A;
  let previousEnd = 0;
  let slowSeconds = 0;
  let changeCount = 0;
  const changedEvents = [];

  for (let index = 0; index < events.length; index++) {
    const item = events[index];
    const label = `event ${index + 1}`;
    const start = startOf(item);
    const end = endOf(item);
    const targetZoom = (item.zoom ?? levels[item.to]);
    if(item.zoom!==undefined && (!Number.isFinite(item.zoom)||item.zoom<1||item.zoom>1.35||(item.to==='A'&&item.zoom!==1)))errors.push('event zoom outside safe range');

    if (!['cut', 'slow'].includes(item.transition)) errors.push(`${label}: transition must be cut or slow`);
    if (!PURPOSES.has(item.purpose)) errors.push(`${label}: purpose is missing or unsupported`);
    if (typeof item.cue !== 'string' || !item.cue.trim()) errors.push(`${label}: cue must quote a real source phrase`);
    if (typeof item.reason !== 'string' || !item.reason.trim()) errors.push(`${label}: reason must explain why the shot changes now`);
    if (!Number.isFinite(targetZoom)) errors.push(`${label}: target level must be A, B or C`);
    if (!Number.isFinite(start) || start < 0 || start > mediaDuration + 0.1) errors.push(`${label}: start time is outside the media`);
    if (start < previousEnd - EPS) errors.push(`${label}: overlap with the previous slow movement`);

    if (item.transition === 'slow') {
      if (!Number.isFinite(end) || end <= start || end > mediaDuration + 0.1) {
        errors.push(`${label}: slow movement needs from < toTime within the media`);
      }
      if (end - start < 0.2 - EPS) errors.push(`${label}: continuous movement must last at least 0.2s`);
      if (item.easing !== undefined && !['smoothstep', 'ramped', 'linear'].includes(item.easing)) errors.push(`${label}: unsupported easing`);
      slowSeconds += Math.max(0, end - start);
    } else if (!Number.isFinite(Number(item.at))) {
      errors.push(`${label}: cut requires numeric at`);
    }

    if (Number.isFinite(targetZoom)) {
      const delta = Math.abs(targetZoom - currentZoom);
      if (item.transition === 'cut' && start > EPS && delta < 0.1 - EPS) {
        warnings.push(`${label}: small hard cut delta ${r2(delta)}; review continuity, do not enlarge the crop just to pass a threshold`);
      }
      if (item.transition === 'slow' && delta <= EPS) {
        errors.push(`${label}: slow movement delta ${r2(delta)} must be greater than zero`);
      }
      if ((start > EPS || item.transition === 'slow') && delta > EPS) {
        changeCount++;
        changedEvents.push({start, to: item.to});
      }
      currentZoom = targetZoom;
    }

    const next = events[index + 1];
    if (item.transition === 'cut' && start > EPS && next) {
      const hold = startOf(next) - start;
      if (hold < 1.5 - EPS) errors.push(`${label}: hard cut must hold for at least 1.5s`);
    }
    previousEnd = Math.max(previousEnd, end);
  }

  const changesPerMinute = mediaDuration > 0 ? changeCount / (mediaDuration / 60) : 0;
  // Half-open windows [start, start + 60): do not dilute bursts with a static tail.
  // Initial framing is not a change; each push and return counts separately.
  let maxChangesIn60Seconds = 0;
  let windowStart = 0;
  for (let index = 0; index < changedEvents.length; index++) {
    while (changedEvents[index].start - changedEvents[windowStart].start >= 60) windowStart++;
    const count = index - windowStart + 1;
    maxChangesIn60Seconds = Math.max(maxChangesIn60Seconds, count);

  }

  const slowCoveragePct = mediaDuration > 0 ? slowSeconds / mediaDuration * 100 : 0;
  // Occupancy includes the entire close hold, not just motion. Technical
  // validity and editorial review are separate: no new frequency quota.
  let baseSeconds = 0, closeHoldSeconds = 0, movementSeconds = 0;
  let cursor = 0, heldZoom = levels.A;
  const addHold = (end) => {
    const seconds = Math.max(0, end - cursor);
    if (Math.abs(heldZoom - levels.A) <= EPS) baseSeconds += seconds;
    else closeHoldSeconds += seconds;
    cursor = end;
  };
  if (!errors.length) {
    for (const item of events) {
      addHold(startOf(item));
      if (item.transition === 'slow') {
        movementSeconds += endOf(item) - startOf(item);
        cursor = endOf(item);
      }
      heldZoom = (item.zoom ?? levels[item.to]);
    }
    addHold(mediaDuration);
  }
  const pct = seconds => mediaDuration > 0 ? r2(seconds / mediaDuration * 100) : 0;
  const baseCoveragePct = pct(baseSeconds);
  if (!errors.length && baseCoveragePct <= 50) {
    warnings.push('REVIEW REQUIRED: base framing is not the majority; shorten close holds or document an explicit episode exception');
  } else if (!errors.length && baseCoveragePct < 75) {
    warnings.push('REVIEW REQUIRED: base framing below the 75–85% trial target; inspect close holds and return points');
  }
  for (const item of events) {
    if (item.transition === 'cut' && startOf(item) > EPS) warnings.push('REVIEW REQUIRED: hard cut needs a specific continuity or narrative reason; continuous movement is preferred');
  }

  for (let index = 0; index + 3 < changedEvents.length; index++) {
    const [a, b, c, d] = changedEvents.slice(index, index + 4);
    if (a.to === c.to && b.to === d.to && a.to !== b.to && d.start - a.start <= 12 + EPS) {
      warnings.push(`REVIEW REQUIRED: oscillation ${a.to}→${b.to}→${c.to}→${d.to} occurs inside 12s`);
      break;
    }
  }

  return {
    errors,
    warnings,
    stats: {
      eventCount: events.length,
      changeCount,
      changesPerMinute: r2(changesPerMinute),
      maxChangesIn60Seconds,
      slowCoveragePct: r2(slowCoveragePct), // legacy reporting field, no ceiling
      baseCoveragePct,
      closeHoldCoveragePct: pct(closeHoldSeconds),
      movementCoveragePct: pct(movementSeconds),
      nonBaseCoveragePct: pct(closeHoldSeconds + movementSeconds),
      occupancyDenominator: "full camera track; B-roll visibility not inferred",
      styleReviewRequired: warnings.some(w => w.startsWith("REVIEW REQUIRED")),
    },
  };
}

export function compileShotPlan(plan, {duration} = {}) {
  const mediaDuration = durationOf(plan, duration);
  const report = validateShotPlan(plan, {duration: mediaDuration});
  if (report.errors.length) throw new Error(report.errors.join('\n'));

  const levels = levelsOf(plan);
  const events = orderedEvents(plan);
  const segments = [];
  let cursor = 0;
  let currentZoom = levels.A;

  const holdUntil = (to) => {
    if (to > cursor + EPS) {
      segments.push({from: cursor, to, zoomFrom: currentZoom, zoomTo: currentZoom, transition: 'hold'});
      cursor = to;
    }
  };

  for (const item of events) {
    const start = startOf(item);
    holdUntil(start);
    if (item.transition === 'cut') {
      currentZoom = (item.zoom ?? levels[item.to]);
      cursor = start;
      continue;
    }

    const end = endOf(item);
    const targetZoom = (item.zoom ?? levels[item.to]);
    segments.push({
      from: start,
      to: end,
      zoomFrom: currentZoom,
      zoomTo: targetZoom,
      transition: 'slow',
      ...(item.easing ? {easing: item.easing} : {}),
      purpose: item.purpose,
      cue: item.cue,
      reason: item.reason,
    });
    currentZoom = targetZoom;
    cursor = end;
  }

  holdUntil(mediaDuration);
  return segments;
}

// FFmpeg time-domain scale expression. `ramped` integrates a trapezoidal
// velocity: first/last 10% accelerate/decelerate, middle 80% stays steady.
export function buildZoomExpression(segments) {
  let expression = '1';
  for (let index = segments.length - 1; index >= 0; index--) {
    const {from, to, zoomFrom, zoomTo, easing} = segments[index];
    const span = Math.max(0.000001, Number((to - from).toFixed(8)));
    const p = `clip((t-${from})/${span},0,1)`;
    const eased = easing === 'linear' ? p : easing === 'ramped'
      ? `if(lt(${p},0.1),(${p})*(${p})/0.18,if(gt(${p},0.9),1-(1-${p})*(1-${p})/0.18,(${p}-0.05)/0.9))`
      : `(${p}*${p}*(3-2*${p}))`;
    const delta = Number((zoomTo - zoomFrom).toFixed(8));
    const zoom = zoomFrom === zoomTo ? String(zoomFrom) : `(${zoomFrom}+${delta}*${eased})`;
    expression = `if(between(t,${from},${to}),${zoom},${expression})`;
  }
  return expression;
}

// Keep the raster size fixed. Dynamic scale + crop rounds both size and crop
// origin, creating lateral reversals during small zooms. Perspective performs
// the same uniform affine zoom with fractional source coordinates instead.
export function buildCameraFilter(segments, {width, height, fps, anchor = DEFAULT_ANCHOR}) {
  if (!(width > 0 && height > 0 && fps > 0)) throw new Error('positive width, height and fps required');
  const zoom = buildZoomExpression(segments).replace(/\bt\b/g, `(on/${fps})`);
  const left = `${anchor.x}*W*(1-1/(${zoom}))`;
  const top = `${anchor.y}*H*(1-1/(${zoom}))`;
  const right = `(${left})+W/(${zoom})`;
  const bottom = `(${top})+H/(${zoom})`;
  return `perspective=x0='${left}':y0='${top}':x1='${right}':y1='${top}':x2='${left}':y2='${bottom}':x3='${right}':y3='${bottom}':sense=source:eval=frame:interpolation=cubic,format=yuv420p`;
}

// Same easing and segment boundaries as buildZoomExpression; deterministic on seek.
export function sampleCameraZoom(segments, time) {
 const s=segments.find(s=>time>=s.from && time<=s.to);
 if(!s) return 1;
 const p=Math.min(1,Math.max(0,(time-s.from)/Math.max(1e-6,s.to-s.from)));
 const q=s.easing==='linear'?p:s.easing==='ramped'?(p<.1?p*p/.18:p>.9?1-(1-p)*(1-p)/.18:(p-.05)/.9):p*p*(3-2*p);
 return s.zoomFrom+(s.zoomTo-s.zoomFrom)*q;
}
