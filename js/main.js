import { PRESETS, SYMBOLS, ANIMATIONS, getPresetById } from './presets.js';
import { PALETTES } from './palettes.js';
import { buildAsciiCache } from './ascii-cache.js';
import { TerminalRenderer } from './renderer.js';
import { generatePythonScript, copyTextSafe, downloadPythonFile } from './python-export.js';
import { createVideoExporter } from './video-export.js';

const initialPreset = PRESETS[0];

const state = {
  preset: initialPreset.id,
  command: initialPreset.command,
  ascii: initialPreset.art,
  message: initialPreset.message,
  typewriter: true,
  palette: 'auto',
  animation: 'twinkle',
  speed: 5,
  format: 'standard',
  duration: 8,
  activeTab: 'preview',
  isPlaying: true,
};

let cache = null;
let cacheSignature = '';
let elapsedSec = 0;
let lastRafTs = 0;
let lastFrameDrawTs = 0;
let pythonDirty = true;

const PREVIEW_FPS = 30;
const FRAME_MS = 1000 / PREVIEW_FPS;

const renderer = new TerminalRenderer();
const exporter = createVideoExporter();

// DOM
const el = {
  presetGrid: document.getElementById('presetGrid'),
  symbolsBar: document.getElementById('symbolsBar'),
  asciiInput: document.getElementById('asciiInput'),
  asciiStats: document.getElementById('asciiStats'),
  clearAsciiBtn: document.getElementById('clearAsciiBtn'),
  turboBadge: document.getElementById('turboBadge'),
  messageInput: document.getElementById('messageInput'),
  typewriterToggle: document.getElementById('typewriterToggle'),
  paletteGrid: document.getElementById('paletteGrid'),
  animGrid: document.getElementById('animGrid'),
  speedRange: document.getElementById('speedRange'),
  speedValue: document.getElementById('speedValue'),
  playPauseBtn: document.getElementById('playPauseBtn'),
  restartBtn: document.getElementById('restartBtn'),
  resLabel: document.getElementById('resLabel'),
  exportVideoBtn: document.getElementById('exportVideoBtn'),
  cancelExportBtn: document.getElementById('cancelExportBtn'),
  progressWrap: document.getElementById('progressWrap'),
  progressFill: document.getElementById('progressFill'),
  progressText: document.getElementById('progressText'),
  previewCanvas: document.getElementById('previewCanvas'),
  pythonCodeOutput: document.getElementById('pythonCodeOutput'),
  copyPyBtn: document.getElementById('copyPyBtn'),
  copyCodeTabBtn: document.getElementById('copyCodeTabBtn'),
  downloadPyBtn: document.getElementById('downloadPyBtn'),
  toast: document.getElementById('toast'),
};

const previewCtx = el.previewCanvas.getContext('2d', { alpha: false });

let toastTimer = null;
function showToast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2600);
}

function debounce(fn, waitMs) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), waitMs);
  };
}

function rebuildCache() {
  cache = buildAsciiCache(state.ascii, state.preset, state.palette);
  cacheSignature = `${state.preset}|${state.palette}|${state.ascii.length}|${cache.visibleCount}|${cache.rowCount}`;
  el.asciiStats.textContent = `${cache.rowCount} lig. · ${cache.maxCols} col. · ${cache.visibleCount} car.`;
  el.turboBadge.hidden = !cache.isTurbo;
  pythonDirty = true;
  if (state.activeTab === 'code') {
    refreshPythonTab();
  }
  configurePreviewCanvas();
}

function configurePreviewCanvas() {
  const isTikTok = state.format === 'tiktok';
  const baseW = isTikTok ? 450 : 800;
  const baseH = isTikTok ? 800 : 450;
  // Réduit le DPR en Mode Turbo pour soulager le GPU sur écrans 4K/Retina
  const maxDpr = cache && cache.isTurbo ? 1.25 : 1.75;
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);

  const targetW = Math.round(baseW * dpr);
  const targetH = Math.round(baseH * dpr);

  if (el.previewCanvas.width !== targetW || el.previewCanvas.height !== targetH) {
    el.previewCanvas.width = targetW;
    el.previewCanvas.height = targetH;
    el.previewCanvas.style.aspectRatio = isTikTok ? '9 / 16' : '16 / 9';
    renderer.invalidate();
  }

  el.resLabel.textContent = isTikTok ? '720×1280 · 30 FPS' : '1280×720 · 30 FPS';
  drawPreviewOnce();
}

function drawPreviewOnce() {
  if (!cache) return;
  renderer.renderFrame(
    previewCtx,
    el.previewCanvas.width,
    el.previewCanvas.height,
    state,
    cache,
    cacheSignature,
    elapsedSec
  );
}

function refreshPythonTab() {
  if (!pythonDirty) return;
  el.pythonCodeOutput.textContent = generatePythonScript(state);
  pythonDirty = false;
}

function renderUIControls() {
  // Modèles
  el.presetGrid.innerHTML = PRESETS.map(
    (p) =>
      `<button class="chip-btn ${p.id === state.preset ? 'active' : ''}" data-preset="${p.id}" type="button">${p.label}</button>`
  ).join('');

  // Symboles
  SYMBOLS.forEach((sym) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sym-btn';
    btn.textContent = sym;
    btn.title = `Insérer ${sym}`;
    btn.addEventListener('click', () => insertSymbol(sym));
    el.symbolsBar.appendChild(btn);
  });

  // Palettes
  el.paletteGrid.innerHTML = PALETTES.map(
    (p) => `
      <button class="palette-btn ${p.id === state.palette ? 'active' : ''}" data-palette="${p.id}" type="button">
        <span class="swatches">${p.colors
          .slice(0, 3)
          .map((c) => `<span class="swatch" style="background:${c}"></span>`)
          .join('')}</span>
        <span>${p.label}</span>
      </button>`
  ).join('');

  // Animations
  el.animGrid.innerHTML = ANIMATIONS.map(
    (a) =>
      `<button class="chip-btn ${a.id === state.animation ? 'active' : ''}" data-anim="${a.id}" type="button">${a.label}</button>`
  ).join('');

  el.asciiInput.value = state.ascii;
  el.messageInput.value = state.message;
  el.speedRange.value = String(state.speed);
  el.speedValue.textContent = `${state.speed}/10`;
}

function insertSymbol(sym) {
  const ta = el.asciiInput;
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? ta.value.length;
  ta.value = ta.value.slice(0, start) + sym + ta.value.slice(end);
  ta.focus();
  ta.setSelectionRange(start + sym.length, start + sym.length);
  state.ascii = ta.value;
  rebuildCache();
}

function bindEvents() {
  // Presets
  el.presetGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-preset]');
    if (!btn) return;
    const preset = getPresetById(btn.dataset.preset);
    state.preset = preset.id;
    state.command = preset.command;
    state.ascii = preset.art;
    state.message = preset.message;
    el.asciiInput.value = state.ascii;
    el.messageInput.value = state.message;
    el.presetGrid.querySelectorAll('.chip-btn').forEach((b) => b.classList.toggle('active', b === btn));
    elapsedSec = 0;
    rebuildCache();
  });

  // Éditeur ASCII avec debounce 140ms (évite les freezes au collage de gros ASCII)
  const onAsciiChange = debounce(() => {
    state.ascii = el.asciiInput.value;
    rebuildCache();
  }, 140);
  el.asciiInput.addEventListener('input', onAsciiChange);

  el.clearAsciiBtn.addEventListener('click', () => {
    el.asciiInput.value = '';
    state.ascii = '';
    rebuildCache();
  });

  // Message & machine à écrire
  const onMessageChange = debounce(() => {
    state.message = el.messageInput.value;
    pythonDirty = true;
    if (state.activeTab === 'code') refreshPythonTab();
    drawPreviewOnce();
  }, 100);
  el.messageInput.addEventListener('input', onMessageChange);

  el.typewriterToggle.addEventListener('change', () => {
    state.typewriter = el.typewriterToggle.checked;
    elapsedSec = 0;
    pythonDirty = true;
    if (state.activeTab === 'code') refreshPythonTab();
    drawPreviewOnce();
  });

  // Palettes
  el.paletteGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-palette]');
    if (!btn) return;
    state.palette = btn.dataset.palette;
    el.paletteGrid.querySelectorAll('.palette-btn').forEach((b) => b.classList.toggle('active', b === btn));
    rebuildCache();
  });

  // Animations
  el.animGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-anim]');
    if (!btn) return;
    state.animation = btn.dataset.anim;
    el.animGrid.querySelectorAll('.chip-btn').forEach((b) => b.classList.toggle('active', b === btn));
    elapsedSec = 0;
    pythonDirty = true;
    if (state.activeTab === 'code') refreshPythonTab();
    drawPreviewOnce();
  });

  // Vitesse
  el.speedRange.addEventListener('input', () => {
    state.speed = Number(el.speedRange.value);
    el.speedValue.textContent = `${state.speed}/10`;
    pythonDirty = true;
    if (state.activeTab === 'code') refreshPythonTab();
  });

  // Onglets Aperçu / Code Python (génération paresseuse du code)
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeTab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
      document.getElementById('previewTab').classList.toggle('active', state.activeTab === 'preview');
      document.getElementById('codeTab').classList.toggle('active', state.activeTab === 'code');
      if (state.activeTab === 'code') {
        refreshPythonTab();
      } else {
        drawPreviewOnce();
      }
    });
  });

  // Format Standard / TikTok
  document.querySelectorAll('[data-format]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.format = btn.dataset.format;
      document.querySelectorAll('[data-format]').forEach((b) => b.classList.toggle('active', b === btn));
      configurePreviewCanvas();
    });
  });

  // Durée
  document.getElementById('durationGroup').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-duration]');
    if (!btn) return;
    state.duration = Number(btn.dataset.duration);
    document.querySelectorAll('[data-duration]').forEach((b) => b.classList.toggle('active', b === btn));
  });

  // Lecture / Pause / Recommencer
  el.playPauseBtn.addEventListener('click', () => {
    state.isPlaying = !state.isPlaying;
    el.playPauseBtn.textContent = state.isPlaying ? '⏸' : '▶';
    if (state.isPlaying) lastRafTs = performance.now();
  });

  el.restartBtn.addEventListener('click', () => {
    elapsedSec = 0;
    drawPreviewOnce();
  });

  // Copie & Téléchargement Python
  const handleCopyPy = async () => {
    try {
      await copyTextSafe(generatePythonScript(state));
      showToast('Script Python copié !');
    } catch {
      showToast('Impossible de copier automatiquement.');
    }
  };
  el.copyPyBtn.addEventListener('click', handleCopyPy);
  el.copyCodeTabBtn.addEventListener('click', handleCopyPy);

  el.downloadPyBtn.addEventListener('click', () => {
    downloadPythonFile(state);
    showToast(`Téléchargement de ascii-studio-${state.preset}.py`);
  });

  // Export vidéo HD
  el.exportVideoBtn.addEventListener('click', async () => {
    el.exportVideoBtn.disabled = true;
    el.cancelExportBtn.hidden = false;
    el.progressWrap.hidden = false;
    el.progressFill.style.width = '0%';
    el.progressText.textContent = 'Rendu en cours… 0%';

    try {
      const res = await exporter.exportVideo({
        state,
        cache,
        cacheSignature,
        onProgress: (pct, label) => {
          el.progressFill.style.width = `${pct}%`;
          el.progressText.textContent = label || `Encodage MP4… ${pct}%`;
        },
      });
      if (res.cancelled) {
        showToast('Export vidéo annulé.');
      } else {
        showToast(`MP4 prêt (${res.engine}) : ${res.filename}`);
      }
    } catch (err) {
      showToast(`Erreur export : ${err.message}`);
    } finally {
      el.exportVideoBtn.disabled = false;
      el.cancelExportBtn.hidden = true;
      el.progressWrap.hidden = true;
    }
  });

  el.cancelExportBtn.addEventListener('click', () => exporter.cancel());
}

// Boucle d'animation plafonnée à 30 FPS et mise en pause automatique si onglet caché
function tick(now) {
  requestAnimationFrame(tick);
  if (document.hidden || state.activeTab !== 'preview' || !state.isPlaying) {
    lastRafTs = now;
    return;
  }
  if (!lastRafTs) lastRafTs = now;
  const dt = (now - lastRafTs) / 1000;
  lastRafTs = now;
  elapsedSec += Math.min(dt, 0.1);

  if (now - lastFrameDrawTs >= FRAME_MS) {
    lastFrameDrawTs = now;
    drawPreviewOnce();
  }
}

renderUIControls();
bindEvents();
rebuildCache();
requestAnimationFrame(tick);
