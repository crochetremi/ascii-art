export const PALETTES = [
  {
    id: 'auto',
    label: 'Auto (Modèle)',
    colors: ['#4ade80', '#facc15', '#f43f5e', '#38bdf8', '#c084fc'],
    messageColor: '#f8fafc',
  },
  {
    id: 'noel',
    label: 'Noël',
    colors: ['#22c55e', '#ef4444', '#facc15', '#f8fafc', '#38bdf8'],
    messageColor: '#fde047',
  },
  {
    id: 'romantique',
    label: 'Romantique',
    colors: ['#fb7185', '#f43f5e', '#f9a8d4', '#fda4af', '#fef08a'],
    messageColor: '#fbcfe8',
  },
  {
    id: 'pastel',
    label: 'Pastel',
    colors: ['#a5b4fc', '#f9a8d4', '#99f6e4', '#fde68a', '#c4b5fd'],
    messageColor: '#e0e7ff',
  },
  {
    id: 'cyber',
    label: 'Néon Cyber',
    colors: ['#22d3ee', '#e879f9', '#818cf8', '#f472b6', '#34d399'],
    messageColor: '#67e8f9',
  },
  {
    id: 'rainbow',
    label: 'Arc-en-ciel',
    colors: ['#f87171', '#fb923c', '#facc15', '#4ade80', '#38bdf8', '#c084fc'],
    messageColor: '#f8fafc',
  },
  {
    id: 'matrix',
    label: 'Vert Matrix',
    colors: ['#22c55e', '#4ade80', '#86efac', '#16a34a', '#bbf7d0'],
    messageColor: '#86efac',
  },
];

// Pré-calcul de 24 couleurs HSL arc-en-ciel (évite de construire des strings hsl() à chaque frame)
export const RAINBOW_LUT = Array.from({ length: 24 }, (_, i) => {
  const hue = Math.round((i / 24) * 360);
  return `hsl(${hue}, 90%, 68%)`;
});

const TWINKLE_CHARS = new Set(['★', '☆', '✦', '✨', '*', 'o', '+', '♥', '♡', '✿', '❀', '❄', '♪']);

export function getPaletteById(id) {
  return PALETTES.find((p) => p.id === id) || PALETTES[0];
}

export function isTwinkleChar(ch) {
  return TWINKLE_CHARS.has(ch);
}

/**
 * Calcule la couleur de base d'un caractère UNE SEULE FOIS lors du parsing.
 */
export function resolveCharColor(ch, row, col, presetId, paletteId) {
  const palette = getPaletteById(paletteId);

  if (paletteId === 'auto') {
    if (presetId === 'sapin') {
      if (ch === '★' || ch === '☆') return '#facc15';
      if (ch === '*') return '#f43f5e';
      if (ch === 'o') return '#38bdf8';
      if (ch === '+') return '#facc15';
      if (ch === '|' || ch === '[' || ch === ']') return '#b45309';
      return '#4ade80';
    }
    if (presetId === 'chat') {
      if (ch === '♥' || ch === '♡') return '#fb7185';
      if (ch === '✦' || ch === '★') return '#facc15';
      if (ch === '^' || ch === 'o') return '#f9a8d4';
      return '#e2e8f0';
    }
    if (presetId === 'coeur') {
      return (row + col) % 3 === 0 ? '#fda4af' : '#f43f5e';
    }
    if (presetId === 'bouquet') {
      if (ch === '✿') return '#f472b6';
      if (ch === '❀') return '#facc15';
      if (ch === '♥') return '#fb7185';
      if (ch === '/' || ch === '\\' || ch === '|') return '#4ade80';
      return '#cbd5e1';
    }
  }

  const colors = palette.colors;
  return colors[(row + col) % colors.length];
}
