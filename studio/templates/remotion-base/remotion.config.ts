import {Config} from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
// 无头渲染 WebGL(Three.js 场景)必需,见 remotion.dev/docs/three
Config.setChromiumOpenGlRenderer('angle');
