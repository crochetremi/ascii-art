import { resolveCharColor, isTwinkleChar, getPaletteById } from './palettes.js';

export const TURBO_THRESHOLD = 1200; // Au-delà de 1200 caractères visibles -> Mode Turbo

/**
 * Pré-analyse l'ASCII art une seule fois (au changement de texte/palette/modèle)
 * au lieu de re-splitter et recalculer les couleurs à chaque frame.
 *
 * Produit :
 * - `runsByColor`: Map<color, Array<{ row, col, text }>> pour dessiner par lots (batching)
 * - `twinkleCells`: uniquement les cellules qui scintillent (sous-ensemble léger)
 * - `rainbowBuckets`: 24 groupes pré-assignés (row + col) % 24 pour la vague arc-en-ciel sans recalcul
 */
export function buildAsciiCache(rawText, presetId, paletteId) {
  const normalized = (rawText || '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const rowCount = lines.length;

  let maxCols = 0;
  let visibleCount = 0;

  const runsByColor = new Map();
  const twinkleCells = [];
  const rainbowBuckets = Array.from({ length: 24 }, () => []);

  for (let r = 0; r < rowCount; r++) {
    const line = lines[r];
    const chars = Array.from(line); // Gère correctement les emojis / Unicode sur 2 code units
    if (chars.length > maxCols) maxCols = chars.length;

    let runColor = null;
    let runStartCol = 0;
    let runText = '';

    const flushRun = () => {
      if (!runText) return;
      let list = runsByColor.get(runColor);
      if (!list) {
        list = [];
        runsByColor.set(runColor, list);
      }
      list.push({ row: r, col: runStartCol, text: runText });
      runText = '';
      runColor = null;
    };

    for (let c = 0; c < chars.length; c++) {
      const ch = chars[c];
      if (ch === ' ' || ch === '\t') {
        flushRun();
        continue;
      }

      visibleCount++;
      const color = resolveCharColor(ch, r, c, presetId, paletteId);
      const isSimpleAscii = ch.charCodeAt(0) < 128;

      // Batching des caractères ASCII contigus de même couleur (réduit drastiquement les appels fillText)
      if (isSimpleAscii && runColor === color) {
        runText += ch;
      } else {
        flushRun();
        if (isSimpleAscii) {
          runColor = color;
          runStartCol = c;
          runText = ch;
        } else {
          // Les symboles Unicode/emojis sont dessinés individuellement pour préserver l'alignement grille
          let list = runsByColor.get(color);
          if (!list) {
            list = [];
            runsByColor.set(color, list);
          }
          list.push({ row: r, col: c, text: ch });
        }
      }

      // Bucket arc-en-ciel (diagonale douce)
      const bucketIdx = (r + Math.floor(c * 0.5)) % 24;
      rainbowBuckets[bucketIdx].push({ row: r, col: c, ch });

      // Candidats au scintillement
      if (isTwinkleChar(ch)) {
        twinkleCells.push({
          row: r,
          col: c,
          ch,
          color,
          phase: ((r * 31 + c * 17) % 100) / 100 * Math.PI * 2,
        });
      }
    }
    flushRun();
  }

  // Si aucun symbole spécial dans un gros ASCII custom, on échantillonne max ~180 cellules pour le scintillement
  if (twinkleCells.length === 0 && visibleCount > 0) {
    const step = Math.max(1, Math.floor(visibleCount / 180));
    let seen = 0;
    for (let r = 0; r < rowCount; r++) {
      const chars = Array.from(lines[r]);
      for (let c = 0; c < chars.length; c++) {
        const ch = chars[c];
        if (ch === ' ' || ch === '\t') continue;
        if (seen % step === 0) {
          twinkleCells.push({
            row: r,
            col: c,
            ch,
            color: resolveCharColor(ch, r, c, presetId, paletteId),
            phase: ((r * 19 + c * 29) % 100) / 100 * Math.PI * 2,
          });
        }
        seen++;
      }
    }
  } else if (twinkleCells.length > 350) {
    // Plafonne les cellules scintillantes sur les très gros ASCII pour rester fluide
    const step = Math.ceil(twinkleCells.length / 350);
    const sampled = [];
    for (let i = 0; i < twinkleCells.length; i += step) {
      sampled.push(twinkleCells[i]);
    }
    twinkleCells.length = 0;
    twinkleCells.push(...sampled);
  }

  const palette = getPaletteById(paletteId);

  return {
    lines,
    rowCount,
    maxCols: Math.max(1, maxCols),
    visibleCount,
    isTurbo: visibleCount >= TURBO_THRESHOLD,
    runsByColor,
    twinkleCells,
    rainbowBuckets,
    messageColor: palette.messageColor,
    paletteColors: palette.colors,
  };
}
