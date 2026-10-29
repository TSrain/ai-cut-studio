import React from 'react';
import {AbsoluteFill} from 'remotion';
import {surface, ink, type, createTypography} from '../lib/theme';
import {KenBurns} from '../components/KenBurns';

// KenBurns 的样例镜头(9:16,横图进竖版:上下留深色底衬)。
// 焦点坐标是源图像素坐标——实际项目里必须用 docs/locate-protocol.md 的网格法拿,不要目测。
const IMG_W = 1280;
const IMG_H = 720;

// 影像镜头配人文气质的中文,用 human。
const typography = createTypography('human');

export const KenBurnsDemo: React.FC = () => (
  <AbsoluteFill
    style={{backgroundColor: surface.dark, fontFamily: typography.families.body}}
  >
    <KenBurns
      src="sample-wide.png"
      imgW={IMG_W}
      imgH={IMG_H}
      windowW={1080}
      windowH={900}
      focusStart={{x: 280, y: 415}}
      focusEnd={{x: 985, y: 255}}
      scaleStart={1.08}
      scaleEnd={1.6}
      moveEnd={180}
      style={{left: 0, top: 460}}
    />
    {/* 合规角标:用到第三方影像时署名要烧进画面,全程可见 */}
    <div
      style={{
        position: 'absolute',
        left: 96,
        top: 1512,
        fontSize: type.label,
        color: ink.muted,
        letterSpacing: 1,
      }}
    >
      示例图·模板自带素材
    </div>
  </AbsoluteFill>
);
