import React from "react";
import {Tooltip} from './Tooltip';
const paths: Record<string, React.ReactNode> = {
  // Lucide icons (ISC): match the approved 1A / 2A / 3A / 4A / 5B candidates.
  'layout-template': <><rect width="18" height="7" x="3" y="3" rx="1"/><rect width="9" height="7" x="3" y="14" rx="1"/><rect width="5" height="7" x="16" y="14" rx="1"/></>,
  'audio-lines': <path d="M2 10v3M6 6v11M10 3v18M14 8v7M18 5v13M22 10v3"/>,
  'folder-open': <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>,
  download: <path d="M12 15V3M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m4-5 5 5 5-5"/>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/></>,
  unlock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0"/></>,
  paste: <><path d="M8 5H5v16h14V5h-3"/><rect x="8" y="3" width="8" height="4" rx="1"/></>,
  split: <><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="m8 8 12 12M8 16 20 4"/></>,
  history: <path d="M3 10a9 9 0 1 1 1 8M3 4v6h6m3-4v6l4 2"/>,
  more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  solo: <><path d="M4 13v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="11" width="4" height="9" rx="2"/><rect x="17" y="11" width="4" height="9" rx="2"/></>,
  pencil: <><path d="m16 3 5 5-13 13H3v-5Zm-2 2 5 5"/></>,
  'arrow-up': <path d="M12 20V4m-7 7 7-7 7 7"/>,
  'arrow-down': <path d="M12 4v16m-7-7 7 7 7-7"/>,
  'eye-off': <><path d="m3 3 18 18M10 5.2a11 11 0 0 1 12 6.8 16 16 0 0 1-4 4M6 6C3 8 2 12 2 12s4 7 10 7a12 12 0 0 0 5-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></>,
  'volume-off': <path d="M3 9h4l5-5v16l-5-5H3Zm13 0 6 6m0-6-6 6"/>,
  expand: <path d="m7 8 5-5 5 5M7 16l5 5 5-5"/>,
  collapse: <path d="m7 3 5 5 5-5M7 21l5-5 5 5"/>,
  text: <path d="M4 20 10 4h3l6 16M7 13h9M2 20h5m10 0h5"/>,
  play: <path d="m8 5 11 7-11 7Z" />,
  pause: (
    <>
      <path d="M8 5v14M16 5v14" />
    </>
  ),
  back: <path d="M5 5v14M19 5l-11 7 11 7Z" />,
  next: <path d="M19 5v14M5 5l11 7-11 7Z" />,
  undo: <path d="M9 5 4 10l5 5M4 10h10a6 6 0 0 1 6 6v3" />,
  redo: <path d="m15 5 5 5-5 5m5-5H10a6 6 0 0 0-6 6v3" />,
  plus: <path d="M12 5v14M5 12h14" />,
  trash: (
    <>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V4H4v12h4" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 10 6-10 6L2 9Zm-9 11 9 5 9-5M3 18l9 5 9-5" />
    </>
  ),
  search: (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="m15 15 6 6" />
    </>
  ),
  folder: <path d="M3 6h7l2 3h9v11H3ZM3 6V3h7l2 3h8v3" />,
  save: (
    <>
      <path d="M4 3h13l4 4v14H3V3ZM7 3v6h9V3M7 21v-8h10v8" />
    </>
  ),
  export: (
    <>
      <path d="M12 16V3m-5 5 5-5 5 5M4 14v7h16v-7" />
    </>
  ),
  fit: <path d="M3 9V3h6m6 0h6v6M3 15v6h6m6 0h6v-6" />,
  'zoom-selection': <><circle cx="10" cy="10" r="7"/><rect x="6" y="8" width="8" height="4" rx=".5"/><path d="m15 15 6 6"/></>,
  'organize-tracks': <><path d="M3 4h12M3 20h12M3 12h18M18 3v5m-3-3 3 3 3-3M18 21v-5m-3 3 3-3 3 3"/></>,
  'timeline-fit': <path d="M3 5v14M21 5v14M6 12h12M9 9l-3 3 3 3m6-6 3 3-3 3" />,
  eye: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  close: <path d="m5 5 14 14M5 19 19 5" />,
  chevron: <path d="m7 10 5 5 5-5" />,
  keyboard: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M6 9h1m3 0h1m3 0h1m3 0h1M6 13h1m3 0h1m3 0h1m3 0h1M8 16h8" />
    </>
  ),
  magnet: (
    <path d="M5 4v9a7 7 0 0 0 14 0V4h-5v9a2 2 0 0 1-4 0V4ZM5 8h5m4 0h5" />
  ),
  volume: (
    <path d="M3 9h4l5-5v16l-5-5H3Zm13-2a7 7 0 0 1 0 10m3-13a11 11 0 0 1 0 16" />
  ),
  film: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M7 3v18m10-18v18M3 8h4m10 0h4M3 16h4m10 0h4" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-5 0v6" />
    </>
  ),
};
export function Icon({
  name,
  size = 16,
  ...props
}: {
  name: string;
  size?: number;
  [key: string]: any;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name] ?? paths.grid}
    </svg>
  );
}
export function IconButton({
  icon,
  label,
  onClick,
  disabled,
  active,
  tooltip,
}: any) {
  const button = (
    <button
      type="button"
      className={"icon-button " + (active ? "active" : "")}
      title={tooltip ? undefined : label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon name={icon} />
    </button>
  );
  return tooltip ? <Tooltip text={tooltip}>{button}</Tooltip> : button;
}
