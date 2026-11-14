#!/usr/bin/env python3
"""Regenerate the BLIND-ESCROW demo screenshot.

This is the reproducible pipeline described in README.md:

  1. run the demo under a real PTY (``script -qec``) so the capture is a
     genuine terminal session, and keep the raw capture as
     ``docs/demo-capture.txt``;
  2. render that byte-exact capture to ``docs/demo-screenshot.png`` with
     Pillow on a dark background, stripping ANSI escape sequences;
  3. print the sha256 of the capture file so the README can quote it.

Usage:
    python3 scripts/capture-screenshot.py <repo-root>

``<repo-root>`` is the directory that contains the ``shielded-private-escrow``
entry directory.  The script is idempotent and re-runnable: it overwrites both
``docs/demo-capture.txt`` and ``docs/demo-screenshot.png``.
"""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:  # pragma: no cover
    sys.exit("Pillow is required: pip install pillow")

ENTRY_DIRNAME = "shielded-private-escrow"
FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
FONT_SIZE = 14
LINE_SPACING = 6
PADDING = 24
BACKGROUND = "#0d1117"
TITLE_COLOR = "#58a6ff"
STEP_COLOR = "#d2a8ff"
METRIC_COLOR = "#3fb950"
TEXT_COLOR = "#c9d1d9"
MUTED_COLOR = "#8b949e"

ANSI_RE = re.compile(r"\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])")


def find_entry_dir(repo_root: str) -> str:
    candidate = os.path.join(repo_root, ENTRY_DIRNAME)
    if os.path.isdir(candidate):
        return candidate
    # allow passing the entry directory itself
    if os.path.isfile(os.path.join(repo_root, "scripts", "demo.mjs")):
        return repo_root
    raise SystemExit(f"could not find {ENTRY_DIRNAME} under {repo_root}")


def capture_pty(entry_dir: str) -> str:
    """Run the demo under a real PTY and return the path of the capture."""
    if shutil.which("script") is None:
        raise SystemExit("the `script` binary is required to capture a real PTY session")
    capture_path = os.path.join(entry_dir, "docs", "demo-capture.txt")
    # `script -qec CMD FILE` runs CMD under a real pseudo-terminal and records
    # the session in FILE.  The session banner/footer that script(1) adds
    # carries a wall-clock timestamp, which would make the sha256 of the
    # capture change on every run; we strip those two banner lines so the
    # capture file is the byte-exact transcript of the run and its sha256 is
    # reproducible.  The PTY session itself is real and unmodified.
    raw_path = capture_path + ".raw"
    cmd = ["script", "-qec", "node scripts/demo.mjs", raw_path]
    proc = subprocess.run(cmd, cwd=entry_dir, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.stderr.write(proc.stdout or "")
        sys.stderr.write(proc.stderr or "")
        raise SystemExit(f"demo run failed with exit code {proc.returncode}")
    if not os.path.isfile(raw_path):
        raise SystemExit("the PTY capture file was not produced")

    with open(raw_path, "rb") as fh:
        raw = fh.read()
    os.remove(raw_path)

    # drop the "Script started on ..." / "Script done on ..." banner lines
    lines = raw.split(b"\n")
    kept = [
        ln for ln in lines
        if not ln.startswith(b"Script started on ") and not ln.startswith(b"Script done on ")
    ]
    body = b"\n".join(kept)
    with open(capture_path, "wb") as fh:
        fh.write(body)
    return capture_path


def strip_ansi(text: str) -> str:
    return ANSI_RE.sub("", text)


def read_capture(path: str) -> str:
    with open(path, "rb") as fh:
        raw = fh.read()
    return strip_ansi(raw.decode("utf-8", errors="replace"))


def colour_for(line: str) -> str:
    if line.startswith("==="):
        return TITLE_COLOR
    if line.startswith("[STEP"):
        return STEP_COLOR
    if line.startswith("  Metrics:"):
        return METRIC_COLOR
    if line.startswith("on-chain deployment:"):
        return MUTED_COLOR
    return TEXT_COLOR


def render_png(text: str, out_path: str) -> None:
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    while lines and lines[-1] == "":
        lines.pop()

    font = ImageFont.truetype(FONT_PATH, FONT_SIZE)
    # measure the widest line
    tmp = Image.new("RGB", (10, 10))
    draw = ImageDraw.Draw(tmp)
    bbox = draw.textbbox((0, 0), "M" * 100, font=font)
    char_w = (bbox[2] - bbox[0]) / 100.0
    line_h = (bbox[3] - bbox[1]) + LINE_SPACING

    widest = max((len(l) for l in lines), default=1)
    width = int(PADDING * 2 + char_w * max(widest, 60)) + 2
    height = int(PADDING * 2 + line_h * (len(lines) + 1)) + 2

    img = Image.new("RGB", (width, height), BACKGROUND)
    draw = ImageDraw.Draw(img)

    y = PADDING
    for line in lines:
        draw.text((PADDING, y), line, font=font, fill=colour_for(line))
        y += line_h

    img.save(out_path, "PNG")


def main() -> int:
    repo_root = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()
    repo_root = os.path.abspath(repo_root)
    entry_dir = find_entry_dir(repo_root)

    capture_path = capture_pty(entry_dir)
    text = read_capture(capture_path)

    png_path = os.path.join(entry_dir, "docs", "demo-screenshot.png")
    render_png(text, png_path)

    with open(capture_path, "rb") as fh:
        digest = hashlib.sha256(fh.read()).hexdigest()

    print(f"capture : {capture_path}")
    print(f"sha256  : {digest}")
    print(f"screenshot: {png_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
