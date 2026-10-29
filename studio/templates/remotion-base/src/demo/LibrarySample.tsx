import React, {useState} from 'react';
import {AbsoluteFill, continueRender, delayRender, staticFile, useVideoConfig} from 'remotion';
import {ThreeCanvas} from '@remotion/three';
import {useThree} from '@react-three/fiber';
import * as THREE from 'three';
import {useHdriEnvironment} from '../components/three/useHdriEnvironment';

// 素材库的「样品球」。控制台里 HDRI 和 PBR 材质原本只显示文件名(qwantani_dusk_2_2k.hdr
// 这种名字对人零信息量),这个合成负责把它们渲成一张能看的图:
//   · HDRI 模式:一排三个球(镜面 / 半哑光金属 / 白哑光),同一盏光下能看出
//     光的颜色、方向、软硬——这是选环境光时唯一要判断的事。
//   · 材质模式:左边球体贴上全套 PBR 贴图,右边一块平铺样片看纹理本身。
// 由 tools/build-library-previews.mjs 逐个素材渲一张,不进出片流程。
//
// 坑:三个球都用 envMap 照明,没有实体光源,所以 HDRI 没加载完就截图会全黑——
// useHdriEnvironment 里已经用 delayRender + advance() 兜住了,别绕过它直接 set scene.environment。

export type LibrarySampleProps = {
  /** public/ 下的 .hdr 路径;材质模式下用它当中性打光 */
  hdri: string;
  /** 有值就是材质模式:public/ 下的 PBR 贴图路径 */
  maps: {
    color: string;
    roughness?: string | null;
    metalness?: string | null;
    normal?: string | null;
  } | null;
};

/** 和 useHdriEnvironment 同一套时序:贴图到位 → 强制重绘 → 才放行截图 */
const useTextures = (paths: (string | null | undefined)[]): (THREE.Texture | null)[] => {
  const {invalidate, advance} = useThree();
  const [handle] = useState(() => delayRender(`textures: ${paths.filter(Boolean).join(',')}`));
  const [maps, setMaps] = useState<(THREE.Texture | null)[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    const wanted = paths.map((p) => p ?? null);
    if (!wanted.some(Boolean)) {
      continueRender(handle);
      return;
    }
    const loader = new THREE.TextureLoader();
    Promise.all(
      wanted.map(
        (p) =>
          new Promise<THREE.Texture | null>((resolve) => {
            if (!p) return resolve(null);
            loader.load(
              staticFile(p),
              (t) => {
                t.wrapS = THREE.RepeatWrapping;
                t.wrapT = THREE.RepeatWrapping;
                resolve(t);
              },
              undefined,
              () => resolve(null),
            );
          }),
      ),
    ).then((loaded) => {
      if (cancelled) {
        continueRender(handle);
        return;
      }
      setMaps(loaded);
      invalidate();
      advance(performance.now());
      continueRender(handle);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths.join('|')]);

  return maps;
};

const HdriScene: React.FC<{hdri: string}> = ({hdri}) => {
  useHdriEnvironment(staticFile(hdri));
  // 三个球的差别只有 roughness/metalness:镜面球照出环境长什么样,
  // 半哑光球照出高光形状(软箱还是点光),白哑光球照出光的颜色和方向
  const balls: {x: number; metalness: number; roughness: number; color: string}[] = [
    {x: -2.5, metalness: 1, roughness: 0.02, color: '#ffffff'},
    {x: 0, metalness: 1, roughness: 0.3, color: '#d8d8d2'},
    {x: 2.5, metalness: 0, roughness: 0.85, color: '#efefec'},
  ];
  return (
    <>
      {balls.map((b) => (
        <mesh key={b.x} position={[b.x, 0, 0]}>
          <sphereGeometry args={[1.05, 96, 96]} />
          <meshStandardMaterial
            color={b.color}
            metalness={b.metalness}
            roughness={b.roughness}
            envMapIntensity={1}
          />
        </mesh>
      ))}
    </>
  );
};

const MaterialScene: React.FC<{hdri: string; maps: NonNullable<LibrarySampleProps['maps']>}> = ({
  hdri,
  maps,
}) => {
  useHdriEnvironment(staticFile(hdri));
  const [color, roughness, metalness, normal] = useTextures([
    maps.color,
    maps.roughness,
    maps.metalness,
    maps.normal,
  ]);

  return (
    <>
      {/* 球体:看材质在曲面上的反光与凹凸 */}
      <mesh position={[-1.9, 0, 0]}>
        <sphereGeometry args={[1.5, 128, 128]} />
        <meshStandardMaterial
          map={color ?? undefined}
          roughnessMap={roughness ?? undefined}
          metalnessMap={metalness ?? undefined}
          normalMap={normal ?? undefined}
          metalness={metalness ? 1 : 0.85}
          roughness={roughness ? 1 : 0.35}
          envMapIntensity={1.1}
        />
      </mesh>
      {/* 平片:看纹理本身长什么样(球体上会被压缩得看不清)。
          金属平片正对镜头时反射到的是环境里最暗的那块,单靠 HDRI 会黑成一片,
          所以材质模式额外补一盏方向光——它只影响这张缩略图,不是出片用的打光方案 */}
      <directionalLight position={[3, 4, 6]} intensity={2.2} />
      <mesh position={[2.1, 0, 0]} rotation={[0, -0.2, 0]}>
        <planeGeometry args={[2.8, 2.8]} />
        <meshStandardMaterial
          map={color ?? undefined}
          roughnessMap={roughness ?? undefined}
          metalnessMap={metalness ?? undefined}
          normalMap={normal ?? undefined}
          metalness={metalness ? 1 : 0.85}
          roughness={roughness ? 1 : 0.35}
          envMapIntensity={1.1}
        />
      </mesh>
    </>
  );
};

export const LibrarySample: React.FC<LibrarySampleProps> = ({hdri, maps}) => {
  const {width, height} = useVideoConfig();
  return (
    <AbsoluteFill style={{backgroundColor: '#101216'}}>
      <ThreeCanvas
        width={width}
        height={height}
        gl={{alpha: true}}
        camera={{fov: 32, position: [0, 0, 10]}}
      >
        {maps ? <MaterialScene hdri={hdri} maps={maps} /> : <HdriScene hdri={hdri} />}
      </ThreeCanvas>
    </AbsoluteFill>
  );
};
