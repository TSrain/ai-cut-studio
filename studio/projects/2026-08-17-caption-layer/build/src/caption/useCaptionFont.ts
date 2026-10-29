import {useEffect, useState} from 'react';
import {delayRender, continueRender, staticFile} from 'remotion';

export const FULL_FONT = 'fonts/NotoSerifSC-Bold.otf';

/**
 * 加载字幕层字体。**字体文件跟着脚本走,不写死在渲染器里。**
 *
 * 为什么不是模块级副作用:子集化后的字体只包含**那一支脚本用到的字**,
 * 拿 A 片的子集去渲 B 片会静默渲出方框字——项目明令禁止的静默回退。
 * 所以字体路径必须由 props(脚本)决定,而 props 只有组件里拿得到。
 *
 * 子集怎么来:`node tools/subset-caption-font.mjs <脚本.json> --name <名字>`
 * 实测 11.5MB → 117KB(0.99%)。不子集化的话整片渲染会随机撞 delayRender 超时,
 * 降并发和加超时都压不住。
 */
export const useCaptionFont = (file: string = FULL_FONT) => {
  const [ready, setReady] = useState(false);
  const [handle] = useState(() => delayRender(`caption font: ${file}`));

  useEffect(() => {
    let cancelled = false;
    const face = new FontFace('Noto Serif SC', `url(${staticFile(file)})`, {
      weight: '700',
      style: 'normal',
    });
    face
      .load()
      .then((f) => {
        if (cancelled) return;
        (document.fonts as unknown as {add: (x: FontFace) => void}).add(f);
        setReady(true);
        continueRender(handle);
      })
      .catch((err) => {
        // 必须炸出来:回退到系统宋体会让字重明显变轻,而且不报错
        throw new Error(`字幕层字体加载失败(${file}): ${err?.message ?? err}`);
      });
    return () => {
      cancelled = true;
    };
  }, [file, handle]);

  return ready;
};
