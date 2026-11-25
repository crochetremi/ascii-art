import { RAINBOW_LUT } from './palettes.js';

const MONO_FONT = '"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

function createOffscreen(width, height) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Moteur de rendu terminal haute performance.
 *
 * Optimisations clés pour les gros ASCII custom :
 * 1. Cache du décor terminal (fond + fenêtre + barre macOS) dans un canvas offscreen.
 * 2. Cache du rendu ASCII statique dans un canvas offscreen :
 *    - En mode `pulse`, `twinkle` ou `reveal`, on blit l'image statique en 1 seul `drawImage()`
 *      au lieu de redessiner 10 000+ caractères à chaque frame !
 * 3. Suppression automatique de `shadowBlur` en Mode Turbo (gain x10 à x20 sur Canvas 2D).
 * 4. Groupement des appels `fillText` par couleur (Color Batching) et par segments contigus.
 */
export class TerminalRenderer {
  constructor() {
    this.bgCanvas = null;
    this.bgKey = '';

    this.asciiLayer = null;
    this.asciiLayerKey = '';
    this.layout = null;
  }

  invalidate() {
    this.bgKey = '';
    this.asciiLayerKey = '';
  }

  computeLayout(width, height, cache) {
    const isPortrait = height > width;
    const padX = isPortrait ? Math.round(width * 0.06) : Math.round(width * 0.055);
    const padY = isPortrait ? Math.round(height * 0.07) : Math.round(height * 0.075);

    const winX = padX;
    const winY = padY;
    const winW = width - padX * 2;
    const winH = height - padY * 2;
    const titleBarH = isPortrait ? 46 : 40;
    const innerPad = isPortrait ? 24 : 26;
    const promptH = isPortrait ? 34 : 30;
    const msgAreaH = isPortrait ? 76 : 58;

    const artAreaX = winX + innerPad;
    const artAreaY = winY + titleBarH + promptH + 10;
    const artAreaW = Math.max(80, winW - innerPad * 2);
    const artAreaH = Math.max(80, winH - titleBarH - promptH - msgAreaH - 28);

    // Calcul précis de la taille de police pour que l'ASCII ne déborde jamais
    const charAspect = 0.61;
    const lineFactor = 1.18;
    const maxFontByW = artAreaW / (cache.maxCols * charAspect);
    const maxFontByH = artAreaH / (Math.max(1, cache.rowCount) * lineFactor);
    const maxCap = isPortrait ? 30 : 28;
    const fontSize = Math.max(4, Math.min(maxCap, Math.floor(Math.min(maxFontByW, maxFontByH))));

    const charW = fontSize * charAspect;
    const lineH = fontSize * lineFactor;
    const totalArtW = cache.maxCols * charW;
    const totalArtH = cache.rowCount * lineH;

    const originX = Math.round(artAreaX + (artAreaW - totalArtW) / 2);
    const originY = Math.round(artAreaY + (artAreaH - totalArtH) / 2);

    return {
      width,
      height,
      isPortrait,
      winX,
      winY,
      winW,
      winH,
      titleBarH,
      innerPad,
      artAreaX,
      artAreaY,
      artAreaW,
      artAreaH,
      fontSize,
      charW,
      lineH,
      totalArtW,
      totalArtH,
      originX,
      originY,
      msgY: winY + winH - Math.round(msgAreaH * 0.52),
    };
  }

  ensureBgCache(width, height, command, layout) {
    const key = `${width}x${height}|${command}`;
    if (this.bgKey === key && this.bgCanvas) return;

    this.bgCanvas = createOffscreen(width, height);
    const ctx = this.bgCanvas.getContext('2d');

    // Fond dégradé
    const bgGrad = ctx.createLinearGradient(0, 0, width, height);
    bgGrad.addColorStop(0, '#0f172a');
    bgGrad.addColorStop(0.5, '#131029');
    bgGrad.addColorStop(1, '#090d16');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // Halo décoratif subtil
    const rad = ctx.createRadialGradient(
      width * 0.5,
      height * 0.45,
      20,
      width * 0.5,
      height * 0.45,
      Math.max(width, height) * 0.55
    );
    rad.addColorStop(0, 'rgba(124, 58, 237, 0.18)');
    rad.addColorStop(1, 'rgba(124, 58, 237, 0)');
    ctx.fillStyle = rad;
    ctx.fillRect(0, 0, width, height);

    // Fenêtre terminal
    const { winX, winY, winW, winH, titleBarH, innerPad } = layout;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 32;
    ctx.shadowOffsetY = 14;
    drawRoundedRect(ctx, winX, winY, winW, winH, 16);
    ctx.fillStyle = '#0b101d';
    ctx.fill();
    ctx.restore();

    drawRoundedRect(ctx, winX, winY, winW, winH, 16);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Barre de titre
    ctx.save();
    drawRoundedRect(ctx, winX, winY, winW, winH, 16);
    ctx.clip();
    ctx.fillStyle = '#141b2d';
    ctx.fillRect(winX, winY, winW, titleBarH);
    ctx.restore();

    // Pastilles macOS
    const dotY = winY + titleBarH / 2;
    const dotStart = winX + 20;
    const dotColors = ['#ef4444', '#f59e0b', '#22c55e'];
    dotColors.forEach((col, i) => {
      ctx.beginPath();
      ctx.arc(dotStart + i * 20, dotY, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
    });

    // Titre de la fenêtre
    ctx.font = `600 ${layout.isPortrait ? 14 : 13}px ${MONO_FONT}`;
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('terminal — bash', winX + winW / 2, dotY);

    // Invite de commande
    ctx.textAlign = 'left';
    const promptY = winY + titleBarH + 22;
    ctx.font = `600 ${layout.isPortrait ? 15 : 14}px ${MONO_FONT}`;
    ctx.fillStyle = '#4ade80';
    ctx.fillText('➜', winX + innerPad, promptY);
    ctx.fillStyle = '#38bdf8';
    ctx.fillText('~', winX + innerPad + 18, promptY);
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(command || 'python3 ascii_art.py', winX + innerPad + 36, promptY);

    this.bgKey = key;
  }

  /**
   * Pré-rend l'ASCII statique une seule fois dans un canvas offscreen.
   */
  ensureAsciiLayer(cache, layout, cacheSignature) {
    const key = `${layout.width}x${layout.height}|${cacheSignature}`;
    if (this.asciiLayerKey === key && this.asciiLayer) return;

    this.asciiLayer = createOffscreen(layout.width, layout.height);
    const ctx = this.asciiLayer.getContext('2d');
    ctx.font = `600 ${layout.fontSize}px ${MONO_FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    const useGlow = !cache.isTurbo && layout.fontSize >= 10;

    for (const [color, runs] of cache.runsByColor.entries()) {
      ctx.fillStyle = color;
      if (useGlow) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
      } else {
        ctx.shadowBlur = 0;
      }

      for (let i = 0; i < runs.length; i++) {
        const run = runs[i];
        const x = layout.originX + run.col * layout.charW;
        const y = layout.originY + run.row * layout.lineH;
        ctx.fillText(run.text, x, y);
      }
    }

    ctx.shadowBlur = 0;
    this.asciiLayerKey = key;
  }

  /**
   * Rend une frame complète à l'instant `elapsedSec`.
   */
  renderFrame(ctx, width, height, state, cache, cacheSignature, elapsedSec) {
    const layout = this.computeLayout(width, height, cache);
    this.ensureBgCache(width, height, state.command, layout);
    this.ensureAsciiLayer(cache, layout, cacheSignature);

    // 1. Blit du fond terminal (1 seul appel GPU)
    ctx.drawImage(this.bgCanvas, 0, 0);

    const speedMul = 0.4 + state.speed * 0.25;
    const t = elapsedSec * speedMul;

    // 2. Rendu de l'ASCII art selon le mode d'animation
    if (state.animation === 'pulse') {
      const alpha = 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(t * 2.4));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(this.asciiLayer, 0, 0);
      ctx.restore();
    } else if (state.animation === 'reveal') {
      const revealDuration = Math.max(0.8, 3.2 / speedMul);
      const progress = Math.min(1, elapsedSec / revealDuration);
      const visibleRows = Math.ceil(progress * cache.rowCount);
      const clipH = Math.min(height, layout.originY + visibleRows * layout.lineH + 4);

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, width, clipH);
      ctx.clip();
      ctx.drawImage(this.asciiLayer, 0, 0);
      this.drawTwinkleOverlay(ctx, cache, layout, t, visibleRows);
      ctx.restore();
    } else if (state.animation === 'rainbow') {
      this.drawRainbowFrame(ctx, cache, layout, t);
    } else {
      // 'twinkle' : 1 blit statique + surcouche légère sur les cellules scintillantes uniquement
      ctx.drawImage(this.asciiLayer, 0, 0);
      this.drawTwinkleOverlay(ctx, cache, layout, t, cache.rowCount);
    }

    // 3. Message personnalisé (avec ou sans effet machine à écrire)
    if (state.message) {
      this.drawMessage(ctx, state, cache, layout, elapsedSec, speedMul);
    }
  }

  drawTwinkleOverlay(ctx, cache, layout, t, maxRow) {
    const cells = cache.twinkleCells;
    if (!cells.length) return;

    ctx.save();
    ctx.font = `700 ${layout.fontSize}px ${MONO_FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const useGlow = !cache.isTurbo && layout.fontSize >= 10;

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (cell.row >= maxRow) continue;

      const wave = Math.sin(t * 3.8 + cell.phase);
      if (wave < 0.45) continue;

      const x = layout.originX + cell.col * layout.charW;
      const y = layout.originY + cell.row * layout.lineH;

      // Effet d'éclat blanc/lumineux par-dessus la couche statique
      ctx.globalAlpha = (wave - 0.45) / 0.55;
      ctx.fillStyle = '#ffffff';
      if (useGlow) {
        ctx.shadowColor = cell.color;
        ctx.shadowBlur = 12;
      }
      ctx.fillText(cell.ch, x, y);
    }
    ctx.restore();
  }

  drawRainbowFrame(ctx, cache, layout, t) {
    const shift = Math.floor(t * 6) % 24;
    ctx.save();
    ctx.font = `600 ${layout.fontSize}px ${MONO_FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.shadowBlur = 0;

    // 24 changements de fillStyle maximum pour TOUT le dessin, même avec 20 000 caractères !
    for (let b = 0; b < 24; b++) {
      const bucket = cache.rainbowBuckets[b];
      if (!bucket.length) continue;

      ctx.fillStyle = RAINBOW_LUT[(b + shift) % 24];
      for (let i = 0; i < bucket.length; i++) {
        const cell = bucket[i];
        ctx.fillText(
          cell.ch,
          layout.originX + cell.col * layout.charW,
          layout.originY + cell.row * layout.lineH
        );
      }
    }
    ctx.restore();
  }

  drawMessage(ctx, state, cache, layout, elapsedSec, speedMul) {
    const chars = Array.from(state.message);
    let shown = state.message;
    let showCursor = false;

    if (state.typewriter) {
      const charsPerSec = 10 * speedMul;
      const count = Math.min(chars.length, Math.floor(elapsedSec * charsPerSec));
      shown = chars.slice(0, count).join('');
      showCursor = Math.floor(elapsedSec * 2.5) % 2 === 0;
    }

    const msgFontSize = layout.isPortrait ? 20 : 18;
    ctx.save();
    ctx.font = `600 ${msgFontSize}px ${MONO_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = cache.messageColor;
    ctx.fillText(shown + (showCursor ? ' ▌' : ''), layout.winX + layout.winW / 2, layout.msgY);
    ctx.restore();
  }
}
