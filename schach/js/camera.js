// Kamera + einfache Bewegungserkennung.
// Idee: Die App schickt nicht ständig Bilder an die KI (teuer und langsam), sondern
// erkennt lokal, wann sich etwas auf dem Brett bewegt hat (Hand über dem Brett) und
// wann das Bild danach wieder ruhig ist. Erst dann wird ein Vorher-/Nachher-Bildpaar
// zur Auswertung an Claude geschickt.

export class BoardCamera {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.small = document.createElement("canvas");
    this.small.width = 64;
    this.small.height = 48;
    this.sctx = this.small.getContext("2d", { willReadFrequently: true });
    this.prev = null;
    this.timer = null;
    this.baseline = null; // letztes ruhiges Bild (Blob) – "vorher"
    this.state = "idle"; // idle | moving | settling
    this.lastMotionAt = 0;
    this.sawMotion = false;
    this.onStable = () => {}; // (beforeBlob, afterBlob) => void
    this.onMotion = () => {}; // (level 0..1) => void
    this.onStateChange = () => {};
    this.armed = false; // nur wenn die App gerade einen Zug erwartet
    this.facing = "environment";
  }

  get running() {
    return !!this.stream;
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Dieser Browser erlaubt keinen Kamerazugriff. Öffne die Seite über https:// (z. B. GitHub Pages) in Chrome oder Safari.");
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: this.facing }, width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false,
    });
    this.video.srcObject = this.stream;
    this.video.setAttribute("playsinline", "");
    this.video.muted = true;
    await this.video.play();
    await new Promise((r) => (this.video.readyState >= 2 ? r() : this.video.addEventListener("loadeddata", r, { once: true })));
    this.baseline = await this.capture();
    this.prev = null;
    this.timer = setInterval(() => this._tick(), 250);
  }

  async switchCamera() {
    this.facing = this.facing === "environment" ? "user" : "environment";
    if (this.running) {
      this.stop();
      await this.start();
    }
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  /** Aktuelles Kamerabild als JPEG-Blob (max. 1024 px Kantenlänge). */
  async capture(maxSide = 1024) {
    const v = this.video;
    const w = v.videoWidth, h = v.videoHeight;
    if (!w || !h) throw new Error("Kein Kamerabild verfügbar.");
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
    return await new Promise((r) => c.toBlob(r, "image/jpeg", 0.82));
  }

  /** Neues Referenzbild setzen (z. B. nach einem erkannten Zug). */
  async resetBaseline() {
    if (!this.running) return;
    this.baseline = await this.capture();
  }

  _tick() {
    const v = this.video;
    if (!v.videoWidth) return;
    this.sctx.drawImage(v, 0, 0, 64, 48);
    const { data } = this.sctx.getImageData(0, 0, 64, 48);
    const gray = new Uint8Array(64 * 48);
    for (let i = 0; i < gray.length; i++) gray[i] = (data[i * 4] * 3 + data[i * 4 + 1] * 6 + data[i * 4 + 2]) / 10;
    let level = 0;
    if (this.prev) {
      let changed = 0;
      for (let i = 0; i < gray.length; i++) if (Math.abs(gray[i] - this.prev[i]) > 22) changed++;
      level = changed / gray.length;
    }
    this.prev = gray;
    this.onMotion(level);

    const now = performance.now();
    const MOVING = 0.035; // Anteil geänderter Pixel, ab dem "Bewegung" gilt
    if (level > MOVING) {
      this.lastMotionAt = now;
      if (this.state !== "moving") this._setState("moving");
      this.sawMotion = true;
    } else if (this.state === "moving" && now - this.lastMotionAt > 400) {
      this._setState("settling");
    } else if (this.state === "settling" && now - this.lastMotionAt > 1400) {
      this._setState("idle");
      if (this.sawMotion) {
        this.sawMotion = false;
        this._emitStable();
      }
    }
  }

  async _emitStable() {
    const after = await this.capture();
    const before = this.baseline;
    if (this.armed && before) this.onStable(before, after);
    else this.baseline = after; // Bewegung ohne erwarteten Zug: neues Referenzbild
  }

  _setState(s) {
    this.state = s;
    this.onStateChange(s);
  }
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
