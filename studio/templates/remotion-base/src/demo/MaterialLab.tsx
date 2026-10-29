import React, {useMemo} from 'react';
import {AbsoluteFill, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {ThreeCanvas} from '@remotion/three';
import {MeshTransmissionMaterial} from '@react-three/drei';
import * as THREE from 'three';
import {useHdriEnvironment} from '../components/three/useHdriEnvironment';
import {surface} from '../lib/theme';

// 质感演示合成:HDRI 环境光 + 玻璃(透射材质)+ 金属。
// 用途:验证素材库 HDRI 是否生效,以及作为产品宣传片 3D 装饰物的起点。
// 项目里用时:复制这个场景结构,换几何体和配色即可。

const Scene: React.FC = () => {
  const frame = useCurrentFrame();
  useHdriEnvironment(staticFile('hdri/studio_small_08_2k.hdr'));

  const slow = frame * 0.008;

  return (
    <>
      {/* 玻璃主体:透射 + 色散,靠 HDRI 反射出质感。
          background 是透射缓冲的底色:画布是透明的,玻璃"看不到"画布外的
          CSS 辉光层,不给底色折射出来就是黑,给一个与辉光相配的深色即可 */}
      <mesh rotation={[slow * 0.7, slow, 0]} position={[-1.6, 0.1, 0]}>
        <torusKnotGeometry args={[1.15, 0.38, 220, 48]} />
        <MeshTransmissionMaterial
          transmission={1}
          thickness={0.9}
          roughness={0.06}
          ior={1.5}
          chromaticAberration={0.05}
          color="#d9ffee"
          background={useMemo(() => new THREE.Color('#2f8a63'), [])}
        />
      </mesh>
      {/* 金属配角:高金属度低粗糙,反射全靠环境贴图 */}
      <mesh rotation={[slow * 1.3, -slow * 0.9, slow * 0.4]} position={[2.4, -0.4, 0.5]}>
        <icosahedronGeometry args={[1.1, 0]} />
        <meshStandardMaterial color="#d8d8d2" metalness={1} roughness={0.18} envMapIntensity={1.2} />
      </mesh>
      {/* 补一点方向光让暗部有层次;主光照来自 HDRI */}
      <directionalLight position={[4, 6, 5]} intensity={0.6} />
    </>
  );
};

export const MaterialLab: React.FC = () => {
  const {width, height} = useVideoConfig();
  return (
    <AbsoluteFill style={{backgroundColor: surface.dark}}>
      {/* 背景辉光:CSS 层负责氛围,3D 层负责质感——产品片的标准分层 */}
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(ellipse 60% 50% at 30% 60%, rgba(20, 120, 90, 0.35), transparent 70%),' +
            'radial-gradient(ellipse 50% 45% at 75% 30%, rgba(30, 90, 140, 0.3), transparent 70%)',
        }}
      />
      <ThreeCanvas
        width={width}
        height={height}
        gl={{alpha: true}}
        camera={{fov: 35, position: [0, 0, 9]}}
      >
        <Scene />
      </ThreeCanvas>
    </AbsoluteFill>
  );
};
