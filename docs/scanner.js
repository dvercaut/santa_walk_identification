// Camera + QR-detectie.
// - Native BarcodeDetector waar beschikbaar en QR ondersteund (Android Chrome, macOS Chrome/Edge)
// - Anders ZXing-C++ WebAssembly (iOS Safari, Firefox, oudere/afwijkende toestellen)
// Alle bibliotheken staan lokaal in /vendor, dus geen afhankelijkheid van een CDN op de dag zelf.

const WASM_URL = new URL('./vendor/zxing/zxing_reader.wasm', import.meta.url).href;

async function createDetector() {
  if ('BarcodeDetector' in window) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      if (formats.includes('qr_code')) {
        return { detector: new window.BarcodeDetector({ formats: ['qr_code'] }), engine: 'native' };
      }
    } catch (_) { /* val terug op wasm */ }
  }
  await loadScript(new URL('./vendor/barcode-detector/ponyfill.js', import.meta.url).href);
  const api = window.BarcodeDetectionAPI;
  api.prepareZXingModule({
    overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? WASM_URL : prefix + path) },
    fireImmediately: true,
  });
  return { detector: new api.BarcodeDetector({ formats: ['qr_code'] }), engine: 'wasm' };
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Kon scanbibliotheek niet laden'));
    document.head.appendChild(s);
  });
}

export class QrScanner {
  /** @param {HTMLVideoElement} video  @param {(text:string)=>void} onCode */
  constructor(video, onCode) {
    this.video = video;
    this.onCode = onCode;
    this.stream = null;
    this.track = null;
    this.running = false;
    this.paused = false;   // true = camera loopt, maar er wordt niet gedecodeerd (wacht op bevestiging)
    this.engine = null;
    this._detectorPromise = null;
    this._timer = null;
    this._wakeLock = null;
    this.deviceId = localStorage.getItem('sw.cameraId') || null;

    // iOS Safari: zonder deze attributen speelt de video niet inline af.
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');
    video.muted = true;
    video.autoplay = true;
  }

  static supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext;
  }

  async listCameras() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(d => d.kind === 'videoinput');
  }

  async start(deviceId = this.deviceId) {
    this._detectorPromise ||= createDetector();
    await this._stopStream();

    const video = { width: { ideal: 1280 }, height: { ideal: 720 } };
    if (deviceId) video.deviceId = { exact: deviceId };
    else video.facingMode = { ideal: 'environment' };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
    } catch (e) {
      // Opgeslagen camera bestaat niet meer (ander toestel / browser) → terug naar standaard.
      if (deviceId && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) {
        localStorage.removeItem('sw.cameraId');
        this.deviceId = null;
        return this.start(null);
      }
      throw e;
    }

    this.track = this.stream.getVideoTracks()[0];
    this.deviceId = this.track.getSettings?.().deviceId || deviceId || null;
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => {});
    this._tuneTrack();

    const { detector, engine } = await this._detectorPromise;
    this.detector = detector;
    this.engine = engine;
    this.running = true;
    this._requestWakeLock();
    this._loop();
  }

  async switchTo(deviceId) {
    localStorage.setItem('sw.cameraId', deviceId);
    return this.start(deviceId);
  }

  async stop() {
    this.running = false;
    clearTimeout(this._timer);
    await this._stopStream();
    try { await this._wakeLock?.release(); } catch (_) {}
    this._wakeLock = null;
  }

  async _stopStream() {
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.track = null;
    this.video.srcObject = null;
  }

  // Continue autofocus waar mogelijk (Android); iOS doet dit zelf.
  _tuneTrack() {
    const caps = this.track?.getCapabilities?.() || {};
    if (caps.focusMode && caps.focusMode.includes('continuous')) {
      this.track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
    }
  }

  capabilities() {
    const caps = this.track?.getCapabilities?.() || {};
    return { torch: !!caps.torch, zoom: caps.zoom || null };
  }

  async setTorch(on) {
    await this.track?.applyConstraints({ advanced: [{ torch: !!on }] });
  }

  async setZoom(value) {
    await this.track?.applyConstraints({ advanced: [{ zoom: Number(value) }] });
  }

  async _requestWakeLock() {
    try { this._wakeLock = await navigator.wakeLock?.request('screen'); } catch (_) {}
  }

  async reacquireWakeLock() {
    if (this.running && (!this._wakeLock || this._wakeLock.released)) await this._requestWakeLock();
  }

  async _loop() {
    if (!this.running) return;
    const v = this.video;
    if (!this.paused && v.readyState >= 2 && v.videoWidth > 0 && document.visibilityState === 'visible') {
      try {
        const codes = await this.detector.detect(v);
        if (codes.length && this.running && !this.paused) this.onCode(codes[0].rawValue);
      } catch (_) { /* tijdelijke decodefout: volgende frame */ }
    }
    // ~8 fps: snel genoeg voor bandjes, spaart batterij en houdt oudere toestellen vlot.
    this._timer = setTimeout(() => this._loop(), 120);
  }
}
