"""Single source for how this repo (and visualization) invokes `codex exec`.

Settings come from ``config/codex.json``; env vars override them:

- ``CODEX_BIN`` (legacy aliases: ROUGHCUT_CODEX_BIN, EDITOR_PLAN_CODEX_BIN,
  CODEX_BINARY, EDITOR_CODEX_BIN, EDITOR_CODEX_BINARY)
- ``CODEX_MODEL`` (legacy alias: WORKBENCH_CODEX_MODEL)
- ``CODEX_REASONING_EFFORT``

Every call site builds its argv with :func:`exec_command`, so the model and
reasoning effort are always explicit and never depend on ~/.codex/config.toml.
"""
from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / ".devin" / "codex.local.json"
DEFAULTS = {
    "binary": "codex",
    "fallbackBinaries": [],
    "model": None,
    "reasoningEffort": None,
}
BINARY_ENV = ("CODEX_BIN", "ROUGHCUT_CODEX_BIN", "EDITOR_PLAN_CODEX_BIN", "CODEX_BINARY", "EDITOR_CODEX_BIN", "EDITOR_CODEX_BINARY")
MODEL_ENV = ("CODEX_MODEL", "WORKBENCH_CODEX_MODEL")
EFFORT_ENV = ("CODEX_REASONING_EFFORT",)
EFFORTS = {"minimal", "low", "medium", "high", "xhigh", "ultra"}
APPROVALS = {"never", "auto", None}


def load_config(path=None):
    value = dict(DEFAULTS)
    try:
        value.update(json.loads(Path(path or CONFIG_PATH).read_text(encoding="utf-8")))
    except (OSError, ValueError):
        pass
    return value


def _env(names):
    for name in names:
        if os.environ.get(name):
            return os.environ[name]
    return None


def codex_binary(config=None):
    override = _env(BINARY_ENV)
    if override:
        return override
    config = config or load_config()
    for candidate in [config.get("binary"), *config.get("fallbackBinaries", [])]:
        if candidate and Path(candidate).is_file():
            return candidate
    return shutil.which("codex")


def codex_model(config=None):
    return _env(MODEL_ENV) or (config or load_config())["model"]


def codex_reasoning_effort(config=None):
    effort = _env(EFFORT_ENV) or (config or load_config())["reasoningEffort"]
    if effort is not None and effort not in EFFORTS:
        raise ValueError(f"unknown codex reasoning effort: {effort}")
    return effort


def model_args(model=None, effort=None, config=None):
    config = config or load_config()
    model = model or codex_model(config)
    effort = effort or codex_reasoning_effort(config)
    return (["--model", model] if model else []) + (["-c", f'model_reasoning_effort="{effort}"'] if effort else [])


def exec_command(*args, approval="never", binary=None, model=None, effort=None):
    """Return argv for ``codex exec`` with explicit model/effort.

    approval="never": top-level ``--ask-for-approval never`` (exec itself no longer
    accepts ``-a`` since 0.146); approval="auto": ``exec --approve-for-me``.
    """
    if approval not in APPROVALS:
        raise ValueError(f"unknown approval mode: {approval}")
    config = load_config()
    binary = binary or codex_binary(config)
    if not binary:
        raise FileNotFoundError("未找到 Codex CLI（检查 config/codex.json 或 CODEX_BIN）")
    command = [str(binary)]
    if approval == "never":
        command += ["--ask-for-approval", "never"]
    command.append("exec")
    if approval == "auto":
        command.append("--approve-for-me")
    command += model_args(model, effort, config)
    return command + [str(a) for a in args]


if __name__ == "__main__":  # `python3 tools/codex_cli.py` prints the resolved settings
    cfg = load_config()
    print(json.dumps({"binary": codex_binary(cfg), "model": codex_model(cfg),
                      "reasoningEffort": codex_reasoning_effort(cfg)}, ensure_ascii=False))
