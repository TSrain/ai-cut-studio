import React, {createContext, useContext} from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {presetExit} from './preset-exit.mjs';

const ExitContext = createContext(false);
export const useManagedPresetExit = () => useContext(ExitContext);

/** Shared final dissolve: backgrounds and transparent layers retain their own alpha. */
export const PresetExit: React.FC<{durationSeconds: number; enabled?: boolean; children: React.ReactNode}> = ({durationSeconds, enabled = true, children}) => {
  const managed = useManagedPresetExit();
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const {opacity} = presetExit(frame, fps, durationSeconds);
  if (managed || !enabled) return <>{children}</>;
  return <ExitContext.Provider value={true}><AbsoluteFill data-preset-exit style={{opacity}}>{children}</AbsoluteFill></ExitContext.Provider>;
};
