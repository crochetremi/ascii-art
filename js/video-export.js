import { TerminalRenderer } from './renderer.js';

function pickSupportedMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = [
    { mime: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4' },
    { mime: 'video/mp4', ext: 'mp4' },
    { mime: 'video/webm;codecs=vp9', ext: 'webm' },
    { mime: 'video/webm;codecs=vp8', ext: 'webm' },
    { mime: 'video/webm', ext: 'webm' },
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c.mime)) return c;
  }
  return { mime: '', ext: 'webm' };
}

export function createVideoExporter() {
  let cancelled = false;
  let activeRecorder = null;

  function cancel() {
    cancelled = true;
    if (activeRecorder && activeRecorder.state !== 'inactive') {
      try {
        activeRecorder.stop();
      } catch {
        // Ignore stop errors
      }
    }
  }

  async function exportVideo({ state, cache, cacheSignature, onProgress }) {
    cancelled = false;
    const format = pickSupportedMime();
    if (!format) {
      throw new Error('MediaRecorder non supporté par ce navigateur.');
    }

    const isTikTok = state.format === 'tiktok';
    const width = isTikTok ? 720 : 1280;
    const height = isTikTok ? 1280 : 720;
    const fps = 30;
    const durationSec = state.duration;

    // Maintien dans le DOM hors-écran pour compatibilité Firefox
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.style.position = 'fixed';
    canvas.style.left = '-99999px';
    canvas.style.top = '0';
    canvas.style.pointerEvents = 'none';
    document.body.appendChild(canvas);

    const ctx = canvas.getContext('2d', { alpha: false });
    const renderer = new TerminalRenderer();

    const captureFn = canvas.captureStream || canvas.mozCaptureStream;
    if (!captureFn) {
      document.body.removeChild(canvas);
      throw new Error('captureStream non supporté par ce navigateur.');
    }

    const stream = captureFn.call(canvas, fps);
    const options = format.mime
      ? { mimeType: format.mime, videoBitsPerSecond: 5_000_000 }
      : { videoBitsPerSecond: 5_000_000 };

    const recorder = new MediaRecorder(stream, options);
    activeRecorder = recorder;
    const chunks = [];

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunks.push(ev.data);
    };

    const finished = new Promise((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = (err) => reject(err.error || new Error('Erreur d’enregistrement'));
    });

    recorder.start(250);

    const startTime = performance.now();
    const frameInterval = 1000 / fps;
    let lastDraw = 0;

    try {
      await new Promise((resolve) => {
        function step(now) {
          if (cancelled) {
            resolve();
            return;
          }
          const elapsedSec = (now - startTime) / 1000;
          if (elapsedSec >= durationSec) {
            renderer.renderFrame(ctx, width, height, state, cache, cacheSignature, durationSec);
            onProgress(100);
            resolve();
            return;
          }
          if (now - lastDraw >= frameInterval - 1) {
            lastDraw = now;
            renderer.renderFrame(ctx, width, height, state, cache, cacheSignature, elapsedSec);
            onProgress(Math.min(99, Math.round((elapsedSec / durationSec) * 100)));
          }
          requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
      });

      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
      await finished;

      if (cancelled) {
        return { cancelled: true };
      }

      const blob = new Blob(chunks, { type: format.mime || 'video/webm' });
      const url = URL.createObjectURL(blob);
      const filename = `ascii-studio-${state.preset}-${state.format}.${format.ext}`;

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);

      return { cancelled: false, filename };
    } finally {
      activeRecorder = null;
      stream.getTracks().forEach((t) => t.stop());
      if (canvas.parentNode) document.body.removeChild(canvas);
    }
  }

  return { exportVideo, cancel };
}
