#!/usr/bin/env python3
"""Share the existing three model slots with package, including queued cancellation."""
import fcntl
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time


def main():
    root = Path(tempfile.gettempdir()) / f'codex-package-branch-slots-{os.getuid()}'
    root.mkdir(parents=True, exist_ok=True)
    while True:
        for index in range(3):
            with (root / f'{index}.lock').open('a+') as slot:
                try:
                    fcntl.flock(slot, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    continue
                return subprocess.call(sys.argv[1:])
        time.sleep(.1)


if __name__ == '__main__':
    raise SystemExit(main())
