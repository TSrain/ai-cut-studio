import React from 'react';
import {CaptionLayer} from './CaptionLayer';
import {REFERENCE_SCRIPT} from './script-reference';
import {useCaptionFont} from './useCaptionFont';

export const CaptionReference: React.FC = () => {
  // 参考脚本用完整字体:它是对标基准,不该受子集范围影响
  const ready = useCaptionFont();
  if (!ready) return null;
  return <CaptionLayer script={REFERENCE_SCRIPT} />;
};
