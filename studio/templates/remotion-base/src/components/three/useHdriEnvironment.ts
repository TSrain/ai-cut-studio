import {useEffect, useState} from 'react';
import {continueRender, delayRender} from 'remotion';
import {useThree} from '@react-three/fiber';
import * as THREE from 'three';
import {RGBELoader} from 'three/examples/jsm/loaders/RGBELoader.js';

// 在 ThreeCanvas 内调用:加载 .hdr 环境贴图并设为场景环境光。
// 关键顺序:贴图挂到 scene → 强制重绘 → 才 continueRender 放行。
// 离线渲染时 ThreeCanvas 的 frameloop='never',invalidate() 无效,
// 必须 advance() 手动重绘,否则截到的是环境光生效前的黑帧。
export const useHdriEnvironment = (url: string): void => {
  const {scene, invalidate, advance} = useThree();
  const [handle] = useState(() => delayRender(`hdri: ${url}`));

  useEffect(() => {
    let cancelled = false;
    new RGBELoader().load(
      url,
      (tex) => {
        if (cancelled) {
          continueRender(handle);
          return;
        }
        tex.mapping = THREE.EquirectangularReflectionMapping;
        scene.environment = tex;
        invalidate();
        advance(performance.now());
        continueRender(handle);
      },
      undefined,
      (err) => {
        continueRender(handle);
        throw new Error(`HDRI 加载失败 ${url}: ${err}`);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [url, scene, invalidate, handle]);
};
