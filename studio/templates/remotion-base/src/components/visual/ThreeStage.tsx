import React from 'react';
import {AbsoluteFill} from 'remotion';
import {ThreeCanvas} from '@remotion/three';
import {PerspectiveCamera as DreiPerspectiveCamera} from '@react-three/drei';
import {useThree} from '@react-three/fiber';
import type * as THREE from 'three';
import {useHdriEnvironment} from '../three/useHdriEnvironment';

// 3D 舞台:把已有的 R3F / Drei / @remotion/three 栈包成一个"相机、布光、环境、
// 进度全走 props"的组件。项目里已有的 3D 代码(`src/demo/MaterialLab.tsx`、
// `src/components/three/useHdriEnvironment.ts`)是**场景内容**,这个是**摄影棚**。
//
// **何时用**:需要真实材质(玻璃/金属/次表面)、真反射、真景深的镜头。
// **何时不用**(这条比"何时用"重要):
// - 只是想要个"立体感" → CSS 3D transform / SVG 等距投影更快更可控;
// - 写实 3D 产品渲染 → 见记忆 feedback-showcase-avoid-photoreal-3d,
//   把玻璃打好看是**布光设计问题**,不是代码问题,别指望调参数调出来;
// - 路径追踪 → 实测 140spp ≈ 50 秒/帧,5 秒片约 2 小时且仍有噪点,不划算。
//
// ============ 硬规则:相机只能帧驱动 ============
//
// **绝不用 `useFrame` 的时钟**(`state.clock.elapsedTime` / `getDelta()`)。
// R3F 的时钟是墙钟时间,离线渲染时每帧的墙钟间隔取决于当前机器有多忙,
// 于是同一帧两次渲染会得到不同相机位置——抽帧自查就此失效
// (design-principles §9)。这里相机位姿是 `progress` 的纯函数:
//
//     const pose = typeof camera === 'function' ? camera(p) : lerpPose(camera.from, camera.to, p)
//
// 调用方拿 `useCurrentFrame()` 算出 progress 传进来,组件内部一个时钟都没有。
// 同理:场景内容里要动的东西,也请从外面把帧派生值传进 children,
// 不要在 children 里写 `useFrame`。
//
// ============ 踩过的坑(全部来自本项目实测) ============
//
// 1. **`ThreeCanvas` 的 `camera` prop 只在初始化时生效。** 每帧改它没有任何效果,
//    而且不报错——画面就是不动。必须放一个 `makeDefault` 的相机组件在场景里,
//    位姿走 React props 每帧重设。这是本组件存在的主要理由之一。
// 2. **`clearcoat` 会把材质的漫反射整个吃掉,表面渲成纯黑。**
//    (2026-07-22 冰落威士忌项目,three-gpu-pathtracer 0.0.23 实测的实现缺陷;
//    标准 WebGL 管线下没这么极端,但 clearcoat + 低粗糙度依然会让漫反射几乎不可见。)
//    症状是"调光完全没反应"。实体材质一律先不要加 clearcoat。
// 3. **`RectAreaLight` 只参与光源采样,不是可见发光体。**
//    光滑折射面(玻璃/液体)采样不到它,那一块会渲成黑。要让光"透过"透明物体,
//    必须用**发光网格**:`meshStandardMaterial` + `emissive` + `emissiveIntensity`。
//    所以本组件的灯组里没有 RectAreaLight —— 它给的是错误的心智模型。
// 4. **HDRI 必须是本地文件**(`staticFile('hdri/xxx.hdr')`)。渲染期网络请求是禁的,
//    而且远程 HDRI 会让每帧渲染时长随网络抖动。素材照常登记 assets.md。
// 5. **异步加载完必须 `advance()`,不只是 `invalidate()`。**
//    离线渲染时 `frameloop='never'`,invalidate 不会真的触发重绘,
//    截到的是环境光生效前的黑帧。这一条已经封在 `useHdriEnvironment` 里了。
// 6. **透明画布 + 透射材质要给 `background` 色。** `MeshTransmissionMaterial`
//    折射的是透射缓冲,画布透明处折射出来就是黑;给一个与背景相配的深色。
// 7. **背景辉光放 CSS 层,不放 3D 层。** 3D 层负责质感,CSS 层负责氛围——
//    在 3D 里做大面积柔光既慢又难控。本组件的 `environment.backdrop` 就是那一层。
// 8. **颜色不要在这里手写 hex**:调用方从 `scenePalette()` 取,当字符串传进来。
//    three.js 认 hex 字符串,所以令牌可以直接用。

export type ThreeCameraPose = {
  /** 世界坐标 */
  position: [number, number, number];
  /** 看向哪。默认原点 */
  lookAt?: [number, number, number];
  /** 视场角(度)。默认 35。**推镜优先改 position,不改 fov** —— 改 fov 是变焦,
   *  会改透视关系,读起来像镜头畸变而不是"走近了" */
  fov?: number;
  near?: number;
  far?: number;
};

/** 相机:要么给一个静止位姿,要么给首尾两个位姿(按 progress 插值),要么给个纯函数。 */
export type ThreeCameraSpec =
  | ThreeCameraPose
  | {from: ThreeCameraPose; to: ThreeCameraPose}
  | ((progress: number) => ThreeCameraPose);

export type ThreeLightRig =
  | 'none'
  | {
      /** 'studio' 三点光 / 'rim' 逆光轮廓 / 'soft' 大面积柔光 */
      preset: 'studio' | 'rim' | 'soft';
      /** 整组强度缩放。默认 1。HDRI 给主光时应降到 0.3–0.5,否则会过曝 */
      intensity?: number;
      /** 主光颜色(hex 字符串,从 scenePalette() 取,见坑 8) */
      keyColor?: string;
      /** 轮廓光颜色 */
      rimColor?: string;
    };

export type ThreeEnvironment = {
  /** 本地 HDRI 路径,用 `staticFile('hdri/xxx.hdr')` 生成(坑 4) */
  hdri?: string;
  /** CSS 氛围层:放在 3D 之下的背景(坑 7)。给字符串就是 CSS background */
  backdrop?: string;
};

export type ThreeStageProps = {
  children: React.ReactNode;
  camera: ThreeCameraSpec;
  /**
   * 布光。**必填且没有默认值**——布光是 3D 画面质感的第一来源,
   * 和字体一样不允许"沉默地继承一个默认值"。不要灯就显式写 'none'(HDRI 独打)。
   */
  lights: ThreeLightRig;
  /** 环境。同样必填;什么都不要就传 `{}`,那是一个被看得见的决定 */
  environment: ThreeEnvironment;
  /** 0–1,会被钳到 0–1。相机位姿与 children 的动画都应由它推导 */
  progress: number;
  width: number;
  height: number;
  style?: React.CSSProperties;
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

const mixVec = (
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] => [
  mix(a[0], b[0], t),
  mix(a[1], b[1], t),
  mix(a[2], b[2], t),
];

const resolvePose = (spec: ThreeCameraSpec, p: number): ThreeCameraPose => {
  if (typeof spec === 'function') return spec(p);
  if ('from' in spec && 'to' in spec) {
    const {from, to} = spec;
    return {
      position: mixVec(from.position, to.position, p),
      lookAt: mixVec(from.lookAt ?? [0, 0, 0], to.lookAt ?? [0, 0, 0], p),
      fov: mix(from.fov ?? 35, to.fov ?? 35, p),
      near: from.near ?? to.near,
      far: from.far ?? to.far,
    };
  }
  return spec;
};

/**
 * 每帧把相机位姿写回默认相机。
 * 坑 1:必须是场景内的 `makeDefault` 相机,不能靠 ThreeCanvas 的 camera prop。
 */
const StageCamera: React.FC<{pose: ThreeCameraPose}> = ({pose}) => {
  const ref = React.useRef<THREE.PerspectiveCamera>(null);
  const invalidate = useThree((s) => s.invalidate);
  const target = pose.lookAt ?? [0, 0, 0];

  // 没有依赖数组:每帧都跑。lookAt 要在 R3F 把 position prop 写进对象之后执行,
  // 所以放 layout effect(commit 阶段、绘制之前),不是 useEffect
  React.useLayoutEffect(() => {
    const cam = ref.current;
    if (!cam) return;
    cam.lookAt(target[0], target[1], target[2]);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    invalidate();
  });

  return (
    <DreiPerspectiveCamera
      ref={ref}
      makeDefault
      position={pose.position}
      fov={pose.fov ?? 35}
      near={pose.near ?? 0.1}
      far={pose.far ?? 200}
    />
  );
};

/** HDRI 只能在 Canvas 内部调(要拿 scene)。抽成组件是为了让 hook 有个合法的家。 */
const StageEnvironment: React.FC<{hdri: string}> = ({hdri}) => {
  useHdriEnvironment(hdri);
  return null;
};

const LightRig: React.FC<{rig: ThreeLightRig}> = ({rig}) => {
  if (rig === 'none') return null;
  const k = rig.intensity ?? 1;
  const keyColor = rig.keyColor;
  const rimColor = rig.rimColor;

  // 坑 3:没有 RectAreaLight。要"可见的柔光箱"请在 children 里放发光网格
  switch (rig.preset) {
    case 'rim':
      return (
        <>
          <ambientLight intensity={0.08 * k} />
          {/* 逆光在主体后上方:轮廓光的作用是把主体从背景里"切"出来 */}
          <directionalLight
            position={[-2, 4, -6]}
            intensity={1.6 * k}
            color={rimColor}
          />
          <directionalLight position={[3, 1, 2]} intensity={0.25 * k} color={keyColor} />
        </>
      );
    case 'soft':
      return (
        <>
          {/* 半球光模拟"上方大面积柔光 + 地面反弹",比单纯抬 ambient 有方向性 */}
          <hemisphereLight intensity={0.85 * k} groundColor={rimColor} />
          <directionalLight position={[2, 5, 4]} intensity={0.45 * k} color={keyColor} />
        </>
      );
    case 'studio':
    default:
      return (
        <>
          <ambientLight intensity={0.14 * k} />
          {/* 主光 */}
          <directionalLight
            position={[4, 6, 5]}
            intensity={1.15 * k}
            color={keyColor}
          />
          {/* 补光:强度约主光 1/3,位置在主光对侧,只是把暗部从纯黑里捞出来 */}
          <directionalLight position={[-5, 2, 3]} intensity={0.36 * k} />
          {/* 轮廓光 */}
          <directionalLight
            position={[0, 3, -6]}
            intensity={0.75 * k}
            color={rimColor}
          />
        </>
      );
  }
};

export const ThreeStage: React.FC<ThreeStageProps> = ({
  children,
  camera,
  lights,
  environment,
  progress,
  width,
  height,
  style,
}) => {
  const p = clamp01(progress);
  const pose = resolvePose(camera, p);

  return (
    <AbsoluteFill style={{width, height, ...style}}>
      {/* 坑 7:氛围在 CSS 层 */}
      {environment.backdrop ? (
        <AbsoluteFill style={{background: environment.backdrop}} />
      ) : null}
      <ThreeCanvas
        width={width}
        height={height}
        // 画布透明:背景交给上面那层 CSS。透射材质记得给 background 色(坑 6)
        gl={{alpha: true}}
      >
        <StageCamera pose={pose} />
        {environment.hdri ? <StageEnvironment hdri={environment.hdri} /> : null}
        <LightRig rig={lights} />
        {children}
      </ThreeCanvas>
    </AbsoluteFill>
  );
};
