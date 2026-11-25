import { getPaletteById } from './palettes.js';

function hexToRgbTuple(hex) {
  const clean = hex.replace('#', '');
  const n = parseInt(clean, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function escapePyTriple(str) {
  return (str || '').replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"');
}

export function generatePythonScript(state) {
  const palette = getPaletteById(state.palette);
  const rgbList = palette.colors.map(hexToRgbTuple);
  const delay = (0.28 - state.speed * 0.022).toFixed(3);
  const safeArt = escapePyTriple(state.ascii);
  const safeMsg = escapePyTriple(state.message);

  return `#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ASCII Studio — Script d'animation terminal autonome
100 % bibliothèque standard Python 3 (aucune installation requise).
"""

import math
import os
import sys
import time

ASCII_ART = r"""${safeArt}""".splitlines()
MESSAGE = """${safeMsg}"""
ANIMATION = "${state.animation}"
TYPEWRITER = ${state.typewriter ? 'True' : 'False'}
FRAME_DELAY = ${delay}
PALETTE = ${JSON.stringify(rgbList)}
TWINKLE_CHARS = set("★☆✦✨*o+♥♡✿❀❄♪")


def enable_ansi_windows():
    if os.name == "nt":
        os.system("")


def rgb(r, g, b):
    return f"\\033[38;2;{r};{g};{b}m"


RESET = "\\033[0m"
WHITE = "\\033[1;97m"


def rainbow_rgb(step):
    hue = (step % 24) / 24.0 * math.tau
    r = int((math.sin(hue) * 0.5 + 0.5) * 200 + 55)
    g = int((math.sin(hue + 2.094) * 0.5 + 0.5) * 200 + 55)
    b = int((math.sin(hue + 4.188) * 0.5 + 0.5) * 200 + 55)
    return r, g, b


def render_frame(frame_idx, elapsed):
    out = ["\\033[H"]
    total_rows = max(1, len(ASCII_ART))
    visible_rows = total_rows if ANIMATION != "reveal" else min(total_rows, frame_idx + 1)

    for r, line in enumerate(ASCII_ART):
        if r >= visible_rows:
            out.append("")
            continue
        row_buf = []
        for c, ch in enumerate(line):
            if ch == " ":
                row_buf.append(" ")
                continue
            if ANIMATION == "rainbow":
                cr, cg, cb = rainbow_rgb(r + c // 2 + frame_idx)
                row_buf.append(f"{rgb(cr, cg, cb)}{ch}")
            else:
                cr, cg, cb = PALETTE[(r + c) % len(PALETTE)]
                if ANIMATION in ("twinkle", "reveal") and ch in TWINKLE_CHARS:
                    if math.sin(elapsed * 4.0 + r * 0.7 + c * 0.5) > 0.65:
                        row_buf.append(f"{WHITE}{ch}{RESET}")
                        continue
                row_buf.append(f"{rgb(cr, cg, cb)}{ch}")
        out.append("".join(row_buf) + RESET)

    if MESSAGE:
        if TYPEWRITER:
            count = min(len(MESSAGE), int(elapsed * 12))
            shown = MESSAGE[:count]
        else:
            shown = MESSAGE
        out.append("")
        out.append(f"  {WHITE}{shown}{RESET}")

    sys.stdout.write("\\n".join(out) + "\\n")
    sys.stdout.flush()


def main():
    enable_ansi_windows()
    sys.stdout.write("\\033[2J\\033[?25l")
    start = time.time()
    frame = 0
    try:
        while True:
            render_frame(frame, time.time() - start)
            frame += 1
            time.sleep(FRAME_DELAY)
    except KeyboardInterrupt:
        pass
    finally:
        sys.stdout.write(f"{RESET}\\033[?25h\\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
`;
}

export async function copyTextSafe(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(ta);
  if (!ok) throw new Error('Copie impossible');
}

export function downloadPythonFile(state) {
  const code = generatePythonScript(state);
  const blob = new Blob([code], { type: 'text/x-python;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ascii-studio-${state.preset}.py`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
