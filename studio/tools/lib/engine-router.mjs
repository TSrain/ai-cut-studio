// tools/lib/engine-router.mjs
const SIGNALS = [
  'framePrecision', 'dataBinding', 'continuity', 'captions', 'audioSync',
  'webUi', 'shader3d', 'kineticType', 'registryFit', 'remotionRisk', 'hyperframesRisk',
];

export const routeShot = (input) => {
  for (const name of SIGNALS) {
    if (!Number.isInteger(input[name]) || input[name] < 0 || input[name] > 2) {
      throw new TypeError(`${name} must be an integer from 0 to 2`);
    }
  }

  const remotionScore =
    input.framePrecision * 3 + input.dataBinding * 3 + input.continuity * 3 +
    input.captions * 4 + input.audioSync * 4 - input.remotionRisk * 2;
  const hyperframesScore =
    input.webUi * 3 + input.shader3d * 4 + input.kineticType * 3 +
    input.registryFit * 2 - input.hyperframesRisk * 2;

  const exactLayer = input.framePrecision === 2 || input.captions === 2 || input.audioSync === 2;
  const spectacleLayer = input.webUi === 2 || input.shader3d === 2;
  if (exactLayer && spectacleLayer) {
    return {engine: 'hybrid', remotionScore, hyperframesScore, reason: 'exact timing/data layer plus web/shader visual layer'};
  }
  if (input.captions === 2 || input.audioSync === 2 || input.dataBinding === 2) {
    return {engine: 'remotion', remotionScore, hyperframesScore, reason: 'hard precision or data requirement'};
  }
  if (input.shader3d === 2 || (input.webUi === 2 && input.registryFit >= 1)) {
    return {engine: 'hyperframes', remotionScore, hyperframesScore, reason: 'hard web, registry, or shader requirement'};
  }
  if (remotionScore >= 10 && hyperframesScore >= 10 && Math.abs(remotionScore - hyperframesScore) <= 2) {
    return {engine: 'hybrid', remotionScore, hyperframesScore, reason: 'both engines score highly with complementary strengths'};
  }
  if (hyperframesScore > remotionScore) {
    return {engine: 'hyperframes', remotionScore, hyperframesScore, reason: 'higher HyperFrames score'};
  }
  return {engine: 'remotion', remotionScore, hyperframesScore, reason: 'higher or tied Remotion score'};
};
