import React, {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
export const ControlGestures = createContext({
  start: () => {},
  end: () => {},
});
export const FONT_CHOICES = [
  { key: "skin", family: "Noto Sans SC", label: "模板字体" },
  { key: "smiley", family: "Smiley Sans", label: "得意黑" },
  { key: "wenkai", family: "LXGW WenKai", label: "霞鹜文楷" },
  { key: "noto-serif", family: "Noto Serif SC", label: "思源宋体 · 衬线" },
  {
    key: "serif",
    family: "Instrument Serif, Noto Serif SC",
    label: "经典衬线",
  },
  {
    key: "archivo",
    family: "Archivo, Noto Sans SC",
    label: "Archivo · 无衬线",
  },
  { key: "inter", family: "Inter, Noto Sans SC", label: "Inter · 无衬线" },
];
export function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  defaultValue = 0,
  onReset,
  unit = "",
  hint,
}: any) {
  const gesture = useContext(ControlGestures);
  const cleanup = useRef<() => void>();
  useEffect(() => () => cleanup.current?.(), []);
  const begin = () => {
    cleanup.current?.();
    gesture.start();
    const end = () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      gesture.end();
      cleanup.current = undefined;
    };
    window.addEventListener("pointerup", end, { once: true });
    window.addEventListener("pointercancel", end, { once: true });
    cleanup.current = end;
  };
  const v = value ?? defaultValue;
  return (
    <div className="slider-control">
      <div className="control-heading">
        <label>{label}</label>
        <div>
          <input
            aria-label={label + "数值"}
            type="number"
            min={min}
            max={max}
            step={step}
            value={Number.isFinite(v) ? v : ""}
            onChange={(e) => {
              if (e.target.value !== "")
                onChange(Math.min(max, Math.max(min, +e.target.value)));
            }}
          />
          {unit && <span>{unit}</span>}
          <button
            className="control-reset"
            aria-label={"重置" + label}
            title="恢复默认"
            onClick={() => (onReset ? onReset() : onChange(defaultValue))}
          >
            <Icon name="undo" size={12} />
          </button>
        </div>
      </div>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={v}
        onPointerDown={begin}
        onChange={(e) => onChange(+e.target.value)}
        style={
          {
            "--fill": `${Math.max(0, Math.min(100, ((v - min) / Math.max(1e-9, max - min)) * 100))}%`,
          } as any
        }
      />
      {hint && <small className="hint">{hint}</small>}
    </div>
  );
}
export function FontPicker({
  value,
  onChange,
  label = "字体",
  mode = "tune",
}: any) {
  const [open, setOpen] = useState(false),
    [box, setBox] = useState({ left: 0, top: 0, width: 260 });
  const anchor = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null);
  const choices = FONT_CHOICES.filter(
    (f) => mode === "family" || f.key !== "inter",
  );
  const normalized =
    (mode === "family"
      ? choices.find(
          (f) => f.family === value || f.family.split(",")[0] === value,
        )
      : choices.find((f) => f.key === value)) || choices[0];
  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const r = anchor.current!.getBoundingClientRect();
      const width = Math.max(250, r.width);
      const height = Math.min(340, innerHeight - 32);
      setBox({
        left: Math.max(8, Math.min(r.left, innerWidth - width - 8)),
        top:
          r.bottom + height + 6 > innerHeight
            ? Math.max(8, r.top - height - 6)
            : r.bottom + 6,
        width,
      });
    };
    position();
    const close = (e: PointerEvent) => {
      if (
        !anchor.current?.contains(e.target as Node) &&
        !menu.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        anchor.current?.focus();
      }
    };
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", key, true);
    };
  }, [open]);
  return (
    <div className="font-control">
      <label>{label}</label>
      <button
        ref={anchor}
        className="font-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        style={{ fontFamily: normalized.family }}
      >
        {normalized.label}
        <Icon name="chevron" size={14} />
      </button>
      {open &&
        createPortal(
          <div
            className="font-menu"
            ref={menu}
            style={{ position: "fixed", ...box }}
            role="listbox"
            aria-label={label + "选项"}
          >
            {choices.map((f, n) => (
              <button
                key={f.key}
                role="option"
                aria-selected={f.key === normalized.key}
                style={{ fontFamily: f.family }}
                onClick={() => {
                  onChange(
                    mode === "family"
                      ? f.key === "skin"
                        ? ""
                        : f.family
                      : f.key,
                  );
                  setOpen(false);
                  anchor.current?.focus();
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    (
                      menu.current?.children[
                        (n +
                          (e.key === "ArrowDown" ? 1 : -1) +
                          choices.length) %
                          choices.length
                      ] as HTMLElement
                    )?.focus();
                  }
                }}
              >
                <span>{f.label}</span>
                <small style={{ fontFamily: f.family }}>字 Aa</small>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
export const COLORS = [
  "#ffffff",
  "#e7e0d0",
  "#a4acbb",
  "#24262c",
  "#72a5fa",
  "#36bdd2",
  "#54c6a0",
  "#f2c35a",
  "#f0905f",
  "#ea7ba5",
  "#aa87ef",
  "#e55569",
];
export function ColorSwatches({
  label,
  value = "#ffffff",
  onChange,
  colors = COLORS,
}: any) {
  return (
    <div className="color-control">
      <div className="control-heading">
        <label>{label}</label>
        <label className="custom-color" title="自选颜色">
          <input
            aria-label={label + "自选颜色"}
            type="color"
            value={/^#[a-f\d]{6}$/i.test(value) ? value : "#ffffff"}
            onChange={(e) => onChange(e.target.value)}
          />
          <span style={{ background: value }} />
          <small>{value.toUpperCase()}</small>
        </label>
      </div>
      <div className="swatch-grid">
        {colors.map((c) => (
          <button
            key={c}
            aria-label={label + " " + c}
            aria-pressed={c.toLowerCase() === value.toLowerCase()}
            style={{ background: c }}
            onClick={() => onChange(c)}
          />
        ))}
      </div>
    </div>
  );
}
export const PALETTES = [
  {
    name: "冷灰",
    skin: "slate",
    accent: 220,
    neutral: 225,
    colors: ["#1d242e", "#8da8d0"],
  },
  {
    name: "靛蓝",
    skin: "abyss",
    accent: 252,
    neutral: 232,
    colors: ["#141830", "#8f82ec"],
  },
  {
    name: "海蓝",
    skin: "abyss",
    accent: 205,
    neutral: 220,
    colors: ["#10293d", "#63bafa"],
  },
  {
    name: "松绿",
    skin: "abyss",
    accent: 160,
    neutral: 175,
    colors: ["#112b29", "#6ccfb1"],
  },
  {
    name: "暖橙",
    skin: "ember",
    accent: 25,
    neutral: 30,
    colors: ["#34221c", "#f3a86c"],
  },
  {
    name: "玫瑰",
    skin: "ember",
    accent: 340,
    neutral: 320,
    colors: ["#352432", "#e799be"],
  },
  {
    name: "纸白",
    skin: "paper",
    accent: 210,
    neutral: 45,
    colors: ["#f3efe7", "#5497c8"],
  },
  {
    name: "薄荷",
    skin: "paper",
    accent: 155,
    neutral: 140,
    colors: ["#e8f0e9", "#4d9d7c"],
  },
];
export function PalettePicker({ tune = {}, onChange }: any) {
  return (
    <div className="color-control">
      <div className="control-heading">
        <label>配色预设</label>
      </div>
      <div className="palette-grid">
        {PALETTES.map((p) => (
          <button
            key={p.name}
            title={p.name}
            aria-label={"配色 " + p.name}
            aria-pressed={
              tune.skin === p.skin &&
              tune.accentHue === p.accent &&
              tune.neutralHue === p.neutral
            }
            onClick={() =>
              onChange({
                skin: p.skin,
                accentHue: p.accent,
                neutralHue: p.neutral,
              })
            }
          >
            <span
              style={{
                background: `linear-gradient(135deg,${p.colors[0]},${p.colors[1]})`,
              }}
            />
            <small>{p.name}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
