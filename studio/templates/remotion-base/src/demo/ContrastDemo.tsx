import React from 'react';
import {AbsoluteFill} from 'remotion';
import {surface, ink, seriesDark, createTypography} from '../lib/theme';
import {ContrastColumns} from '../components/ContrastColumns';
import {SemanticIcon} from '../components/SemanticIcon';

// ContrastColumns 的样例镜头(9:16)。改了组件就渲这个看一眼。
// 字体套装是显式选的:对照句子要够硬,用 impact。
const typography = createTypography('impact');

export const ContrastDemo: React.FC = () => (
  <AbsoluteFill
    style={{backgroundColor: surface.dark, fontFamily: typography.families.body}}
  >
    <ContrastColumns
      typography={typography}
      left={{
        label: '平台要的：',
        payoff: '让你多\n待一会儿',
        icon: <SemanticIcon name="clock" size={88} color={ink.muted} />,
      }}
      right={{
        label: '你要的：',
        payoff: '明年比\n今年值钱',
        icon: <SemanticIcon name="growth" size={88} color={seriesDark[0]} />,
      }}
      symbol="≠"
    />
  </AbsoluteFill>
);
