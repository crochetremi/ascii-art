import { TerminalRenderer } from './renderer.js';

const MP4_MUXER_CDN = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5/+esm';
const H264_WASM_CDN = 'https://cdn.jsdelivr.net/npm/h264-mp4-encoder@1.0.12/embuild/dist/h264-mp4-encoder.web.js';

let hmeLoadPromise = null;

function yieldFrame() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * Charge le script UMD h264-mp4-encoder une seule fois (OpenH264 en WASM, sans SharedArrayBuffer).
 */
function loadH264WasmScript() {
  if (window.HME && typeof window.HME.createH264MP4Encoder === 'function') {
    return Promise.resolve(window.HME);
  }
  if (hmeLoadPromise) return hmeLoadPromise;

  hmeLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = H264_WASM_CDN;
    script.async = true;
    script.onload = () => {
      if (window.HME && typeof window.HME.createH264MP4Encoder === 'function') {
        resolve(window.HME);
      } else {
        hmeLoadPromise = null;
        reject(new Error('Encodeur H.264 WASM introuvable après chargement.'));
      }
    };
    script.onerror = () => {
      hmeLoadPromise = null;
      reject(new Error('Impossible de charger l’encodeur MP4 WASM (vérifie la connexion).'));
    };
    document.head.appendChild(script);
  });

  return hmeLoadPromise;
}

/**
 * Vérifie si WebCodecs VideoEncoder supporte H.264 dans ce navigateur/contexte.
 */
async function findSupportedWebCodecsConfig(width, height, fps) {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    return null;
  }
  const codecs = [
    'avc1.42001f', // Baseline 3.1 (ultra compatible TikTok/iOS/Android)
    'avc1.4d002a', // Main 4.2
    'avc1.640028', // High 4.0
    'avc1.42E01E', // Constrained Baseline 3.0
  ];

  for (const codec of codecs) {
    const config = {
      codec,
      width,
      height,
      bitrate: 5_000_000,
      framerate: fps,
      avc: { format: 'avc' },
    };
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      if (support && support.supported) {
        return config;
      }
    } catch {
      // Essaie le codec suivant
    }
  }
  return null;
}

/**
 * Vérifie si MediaRecorder supporte nativement video/mp4 (H.264).
 */
function pickNativeMp4Mime() {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = [
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4;codecs=avc1.42001E',
    'video/mp4;codecs=avc1',
    'video/mp4',
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return null;
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

  /**
   * Niveau 1 : WebCodecs (VideoEncoder H.264) + mp4-muxer
   * Rapide (hors temps réel), zéro drop de frame, fastStart MP4 prêt pour TikTok.
   */
  async function exportWithWebCodecs({ canvas, ctx, renderer, width, height, fps, state, cache, cacheSignature, onProgress }) {
    const config = await findSupportedWebCodecsConfig(width, height, fps);
    if (!config) return null;

    onProgress(1, 'Chargement du muxer MP4…');
    const { Muxer, ArrayBufferTarget } = await import(MP4_MUXER_CDN);

    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      video: { codec: 'avc', width, height },
      fastStart: 'in-memory',
    });

    let encoderError = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (err) => {
        encoderError = err;
      },
    });
    encoder.configure(config);

    const totalFrames = Math.round(state.duration * fps);
    const frameDurationUs = Math.round(1_000_000 / fps);

    try {
      for (let i = 0; i < totalFrames; i++) {
        if (cancelled) {
          encoder.close();
          return { cancelled: true };
        }
        if (encoderError) throw encoderError;

        const elapsedSec = i / fps;
        renderer.renderFrame(ctx, width, height, state, cache, cacheSignature, elapsedSec);

        const frame = new VideoFrame(canvas, {
          timestamp: i * frameDurationUs,
          duration: frameDurationUs,
        });
        const keyFrame = i % fps === 0;
        encoder.encode(frame, { keyFrame });
        frame.close();

        // Évite de saturer la file d'encodage GPU
        if (encoder.encodeQueueSize > 8) {
          await encoder.flush();
        }

        if (i % 3 === 0 || i === totalFrames - 1) {
          const pct = Math.min(99, Math.round(((i + 1) / totalFrames) * 100));
          onProgress(pct, `Encodage MP4 (WebCodecs)… ${pct}%`);
          await yieldFrame();
        }
      }

      await encoder.flush();
      encoder.close();
      muxer.finalize();

      const blob = new Blob([target.buffer], { type: 'video/mp4' });
      return { cancelled: false, blob, engine: 'WebCodecs MP4' };
    } catch (err) {
      try {
        encoder.close();
      } catch {
        // ignore
      }
      throw err;
    }
  }

  /**
   * Niveau 2 : MediaRecorder natif MP4 (Safari, Chrome/Edge récents)
   */
  async function exportWithNativeMp4Recorder({ canvas, ctx, renderer, width, height, fps, state, cache, cacheSignature, onProgress }) {
    const mime = pickNativeMp4Mime();
    if (!mime) return null;

    const captureFn = canvas.captureStream || canvas.mozCaptureStream;
    if (!captureFn) return null;

    const stream = captureFn.call(canvas, fps);
    const recorder = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: 5_000_000,
    });
    activeRecorder = recorder;
    const chunks = [];

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunks.push(ev.data);
    };

    const finished = new Promise((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = (err) => reject(err.error || new Error('Erreur MediaRecorder MP4'));
    });

    recorder.start(250);
    const startTime = performance.now();
    const frameInterval = 1000 / fps;
    const durationSec = state.duration;
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
            onProgress(100, 'Finalisation MP4… 100%');
            resolve();
            return;
          }
          if (now - lastDraw >= frameInterval - 1) {
            lastDraw = now;
            renderer.renderFrame(ctx, width, height, state, cache, cacheSignature, elapsedSec);
            const pct = Math.min(99, Math.round((elapsedSec / durationSec) * 100));
            onProgress(pct, `Enregistrement MP4… ${pct}%`);
          }
          requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
      });

      if (recorder.state !== 'inactive') recorder.stop();
      await finished;

      if (cancelled) return { cancelled: true };

      const blob = new Blob(chunks, { type: 'video/mp4' });
      return { cancelled: false, blob, engine: 'MP4 natif' };
    } finally {
      activeRecorder = null;
      stream.getTracks().forEach((t) => t.stop());
    }
  }

  /**
   * Niveau 3 : Encodeur H.264 WASM (OpenH264 -> vrai .mp4)
   * Fonctionne sur Firefox Linux, HTTP non sécurisé, sans SharedArrayBuffer.
   */
  async function exportWithWasmH264({ ctx, renderer, width, height, fps, state, cache, cacheSignature, onProgress }) {
    onProgress(2, 'Chargement de l’encodeur MP4 (WASM)…');
    const HME = await loadH264WasmScript();
    if (cancelled) return { cancelled: true };

    const encoder = await HME.createH264MP4Encoder();
    encoder.width = width;
    encoder.height = height;
    encoder.frameRate = fps;
    encoder.quantizationParameter = 22;
    encoder.groupOfPictures = fps;
    encoder.initialize();

    const totalFrames = Math.round(state.duration * fps);

    try {
      for (let i = 0; i < totalFrames; i++) {
        if (cancelled) {
          encoder.delete();
          return { cancelled: true };
        }

        const elapsedSec = i / fps;
        renderer.renderFrame(ctx, width, height, state, cache, cacheSignature, elapsedSec);

        const imageData = ctx.getImageData(0, 0, width, height);
        encoder.addFrameRgba(imageData.data);

        const pct = Math.min(99, Math.round(((i + 1) / totalFrames) * 100));
        onProgress(pct, `Encodage MP4 (H.264)… ${pct}%`);
        await yieldFrame();
      }

      onProgress(99, 'Finalisation du fichier MP4…');
      encoder.finalize();
      const uint8Array = encoder.FS.readFile(encoder.outputFilename);
      const blob = new Blob([uint8Array], { type: 'video/mp4' });
      encoder.delete();

      return { cancelled: false, blob, engine: 'H.264 WASM' };
    } catch (err) {
      try {
        encoder.delete();
      } catch {
        // ignore
      }
      throw err;
    }
  }

  async function exportVideo({ state, cache, cacheSignature, onProgress }) {
    cancelled = false;

    const isTikTok = state.format === 'tiktok';
    const width = isTikTok ? 720 : 1280;
    const height = isTikTok ? 1280 : 720;
    const fps = 30;

    // Maintien dans le DOM hors-écran pour compatibilité Firefox
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.style.position = 'fixed';
    canvas.style.left = '-99999px';
    canvas.style.top = '0';
    canvas.style.pointerEvents = 'none';
    document.body.appendChild(canvas);

    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    const renderer = new TerminalRenderer();
    const params = { canvas, ctx, renderer, width, height, fps, state, cache, cacheSignature, onProgress };

    try {
      let result = null;

      // 1. WebCodecs H.264 + mp4-muxer (le plus rapide & propre en HTTPS)
      try {
        result = await exportWithWebCodecs(params);
      } catch (err) {
        console.warn('[ASCII Studio] WebCodecs MP4 indisponible, passage au niveau suivant :', err);
      }

      // 2. MediaRecorder natif MP4 (Safari / Chrome récent)
      if (!result && !cancelled) {
        try {
          result = await exportWithNativeMp4Recorder(params);
        } catch (err) {
          console.warn('[ASCII Studio] MediaRecorder MP4 indisponible, passage au niveau suivant :', err);
        }
      }

      // 3. Encodeur WASM H.264 universel (Firefox Linux / HTTP)
      if (!result && !cancelled) {
        result = await exportWithWasmH264(params);
      }

      if (!result || result.cancelled) {
        return { cancelled: true };
      }

      onProgress(100, 'Terminé ! 100%');
      const filename = `ascii-studio-${state.preset}-${state.format}.mp4`;
      triggerDownload(result.blob, filename);

      return { cancelled: false, filename, engine: result.engine };
    } finally {
      activeRecorder = null;
      if (canvas.parentNode) document.body.removeChild(canvas);
    }
  }

  return { exportVideo, cancel };
}
