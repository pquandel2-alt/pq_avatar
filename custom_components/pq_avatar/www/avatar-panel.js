// @ts-check
// =====================================================================
//  Avatar Panel Card v1.3.0
//  Visuelles AI-Panel für Tablets (Fully Kiosk Browser).
//  Wake Word → animierter Avatar durchläuft idle/listening/thinking/speaking.
//
//  Eigenständige Karte: fährt ihre EIGENE Assist-Pipeline über die
//  HA-WebSocket-API (assist_pipeline/run), streamt Mikrofon-Audio als
//  16-kHz-PCM und spielt das TTS-Audio selbst ab — nur so liefert ein
//  WebAudio-AnalyserNode die Amplitude für den Lippensync.
//
//  Wake Word wird serverseitig von HA erkannt (start_stage: "wake_word",
//  openWakeWord-Add-on). Ohne Wake Word: Tippen startet bei "stt".
// =====================================================================

/** @typedef {'idle'|'listening'|'thinking'|'speaking'} AvatarState */

const STATUS_TEXT = {
  idle: 'Bereit',
  listening: 'Ich höre …',
  thinking: 'Denke nach …',
  speaking: 'Antwort',
};

// =====================================================================
//  Haupt-Card
// =====================================================================
class AvatarPanelCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._started = false; // Mikro/Pipeline laufen (nach User-Geste)
    this._state = /** @type {AvatarState} */ ('idle');

    // Audio-Capture (Mikrofon → Pipeline)
    this._micCtx = null;
    this._micStream = null;
    this._micNode = null;
    this._sttHandlerId = null; // Binär-Handler der aktiven Pipeline-Run

    // Audio-Playback (TTS → Lippensync)
    this._playCtx = null;
    this._analyser = null;
    this._mouthRaf = null;
    this._mouth = 0;

    // Pipeline
    this._unsub = null;
    this._restartTimer = null;
    this._convId = null; // Folge-Konversation
  }

  // ----- Lebenszyklus -------------------------------------------------
  disconnectedCallback() {
    this._teardown();
  }

  /** @param {LovelaceCardConfig} config */
  setConfig(config) {
    this._config = {
      wake_word: true, // false → Tippen startet bei STT
      continue_conversation: false, // conversation_id über Turns halten
      greeting: 'Sag „Ok Nabu“', // Text im Idle-Overlay
      pipeline_id: undefined, // leer = bevorzugte Pipeline
      language: undefined,
      debug: false,
      ...config,
    };
    this._renderShell();
  }

  /** @param {HomeAssistant} hass */
  set hass(hass) {
    this._hass = hass;
  }

  getCardSize() {
    return 10;
  }

  static getConfigElement() {
    return document.createElement('avatar-panel-card-editor');
  }

  static getStubConfig() {
    return { wake_word: true, continue_conversation: false };
  }

  // ----- Start (braucht User-Geste für Mic + AudioContext) ------------
  async _start() {
    if (this._started || !this._hass) return;
    this._started = true;
    this._setOverlay(false);

    try {
      await this._startMic();
    } catch (err) {
      this._started = false;
      this._setOverlay(true, '⚠️ Kein Mikrofon-Zugriff. In Fully Kiosk „Microphone Access“ (PLUS) erlauben und HTTPS nutzen.');
      this._log('getUserMedia fehlgeschlagen', err);
      return;
    }

    // Playback-Kontext für TTS + Lippensync
    this._playCtx = new AudioContext();
    this._analyser = this._playCtx.createAnalyser();
    this._analyser.fftSize = 1024;

    this._startPipeline();
  }

  async _startMic() {
    this._micStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    // Erzwinge 16 kHz — dann ist kein manuelles Downsampling nötig.
    this._micCtx = new AudioContext({ sampleRate: 16000 });
    const src = this._micCtx.createMediaStreamSource(this._micStream);
    // ScriptProcessor: deprecated, aber überall verfügbar & ausreichend.
    const node = this._micCtx.createScriptProcessor(2048, 1, 1);
    node.onaudioprocess = (e) => this._onAudio(e.inputBuffer.getChannelData(0));
    src.connect(node);
    node.connect(this._micCtx.destination); // nötig, damit der Node feuert
    this._micNode = node;
  }

  /** Float32 (16 kHz mono) → Int16-PCM → Binär-Frame an HA. */
  _onAudio(float32) {
    const id = this._sttHandlerId;
    if (id == null) return;
    const sock = this._hass?.connection?.socket;
    if (!sock || sock.readyState !== 1) return;

    const pcm = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    const frame = new Uint8Array(pcm.byteLength + 1);
    frame[0] = id; // erstes Byte = Handler-ID
    frame.set(new Uint8Array(pcm.buffer), 1);
    sock.send(frame);
  }

  // ----- Assist-Pipeline ---------------------------------------------
  _startPipeline() {
    if (!this._hass || !this._started) return;
    if (this._unsub) {
      this._unsub();
      this._unsub = null;
    }
    this._sttHandlerId = null;

    const wake = this._config.wake_word !== false;
    /** @type {Record<string, any>} */
    const msg = {
      type: 'assist_pipeline/run',
      start_stage: wake ? 'wake_word' : 'stt',
      end_stage: 'tts',
      input: { sample_rate: 16000 },
    };
    if (this._config.pipeline_id) msg.pipeline = this._config.pipeline_id;
    if (this._config.language) msg.conversation_engine_language = this._config.language;
    if (wake) msg.wake_word_settings = { timeout: 300 };
    if (this._config.continue_conversation && this._convId) msg.conversation_id = this._convId;

    this._hass.connection
      .subscribeMessage((ev) => this._onPipelineEvent(ev), msg)
      .then((unsub) => {
        this._unsub = unsub;
      })
      .catch((err) => {
        this._log('Pipeline-Start fehlgeschlagen', err);
        this._scheduleRestart(2000);
      });
  }

  _onPipelineEvent(ev) {
    this._log('event', ev.type, ev.data);
    switch (ev.type) {
      case 'run-start':
        this._sttHandlerId = ev.data?.runner_data?.stt_binary_handler_id ?? null;
        break;
      case 'wake_word-end':
        this._setState('listening');
        break;
      case 'stt-start':
      case 'stt-vad-start':
        this._setState('listening');
        break;
      case 'stt-end':
        this._setTranscript(ev.data?.stt_output?.text || '');
        break;
      case 'intent-start':
        this._setState('thinking');
        break;
      case 'intent-end': {
        const out = ev.data?.intent_output;
        this._convId = out?.conversation_id || this._convId;
        const reply = out?.response?.speech?.plain?.speech;
        if (reply) this._setTranscript(reply);
        break;
      }
      case 'tts-end': {
        const url = ev.data?.tts_output?.url;
        if (url) this._playTts(url);
        else this._scheduleRestart(200);
        break;
      }
      case 'run-end':
        // Wenn keine TTS-Wiedergabe lief → direkt neu starten.
        if (this._state !== 'speaking') this._scheduleRestart(200);
        break;
      case 'error':
        this._log('Pipeline-Fehler', ev.data);
        this._setTranscript(ev.data?.message || '');
        this._scheduleRestart(1500);
        break;
    }
  }

  _scheduleRestart(delay) {
    if (!this._started) return;
    clearTimeout(this._restartTimer);
    this._restartTimer = setTimeout(() => {
      this._setState('idle');
      this._setTranscript('');
      this._startPipeline();
    }, delay);
  }

  // ----- TTS-Wiedergabe + Lippensync ----------------------------------
  _playTts(url) {
    this._setState('speaking');
    const audio = /** @type {HTMLAudioElement} */ (this.shadowRoot.getElementById('tts'));
    if (!audio || !this._playCtx || !this._analyser) {
      this._scheduleRestart(200);
      return;
    }

    // Audio-Element einmalig durch den Analyser routen.
    if (!this._srcNode) {
      this._srcNode = this._playCtx.createMediaElementSource(audio);
      this._srcNode.connect(this._analyser);
      this._analyser.connect(this._playCtx.destination);
    }
    if (this._playCtx.state === 'suspended') this._playCtx.resume();

    audio.src = url; // gleiche Origin wie HA → CORS-frei für den Analyser
    audio.onended = () => {
      this._stopLipSync();
      this._scheduleRestart(150);
    };
    audio.onerror = () => {
      this._stopLipSync();
      this._scheduleRestart(300);
    };
    audio.play().catch((err) => {
      // Autoplay blockiert → Hinweis, danach weiter.
      this._log('Autoplay blockiert', err);
      this._setOverlay(true, '🔊 Audio-Autoplay in Fully Kiosk aktivieren.');
      this._scheduleRestart(500);
    });

    this._startLipSync();
  }

  _startLipSync() {
    const buf = new Float32Array(this._analyser.fftSize);
    const tick = () => {
      this._analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      // RMS → Mundöffnung, mit Attack/Release-Glättung.
      const target = Math.min(1, rms * 3.2);
      this._mouth += (target - this._mouth) * (target > this._mouth ? 0.6 : 0.25);
      this._setMouth(this._mouth);
      this._mouthRaf = requestAnimationFrame(tick);
    };
    this._mouthRaf = requestAnimationFrame(tick);
  }

  _stopLipSync() {
    if (this._mouthRaf) cancelAnimationFrame(this._mouthRaf);
    this._mouthRaf = null;
    this._mouth = 0;
    this._setMouth(0);
  }

  // ----- UI ----------------------------------------------------------
  /** @param {AvatarState} state */
  _setState(state) {
    this._state = state;
    const stage = this.shadowRoot.getElementById('stage');
    if (stage) stage.className = `stage state-${state}`;
    const status = this.shadowRoot.getElementById('status');
    if (status) status.textContent = STATUS_TEXT[state];
    if (state !== 'speaking') this._stopLipSync();
  }

  _setMouth(v) {
    /** @type {HTMLElement} */ (this.shadowRoot.host).style.setProperty('--mouth', String(v));
  }

  _setTranscript(text) {
    const el = this.shadowRoot.getElementById('transcript');
    if (el) el.textContent = text || '';
  }

  _setOverlay(show, text) {
    const ov = this.shadowRoot.getElementById('overlay');
    if (!ov) return;
    ov.style.display = show ? 'flex' : 'none';
    if (text) {
      const t = this.shadowRoot.getElementById('overlayText');
      if (t) t.textContent = text;
    }
  }

  _teardown() {
    clearTimeout(this._restartTimer);
    this._stopLipSync();
    if (this._unsub) {
      this._unsub();
      this._unsub = null;
    }
    if (this._micNode) this._micNode.disconnect();
    if (this._micStream) this._micStream.getTracks().forEach((t) => t.stop());
    if (this._micCtx) this._micCtx.close();
    if (this._playCtx) this._playCtx.close();
    this._started = false;
    this._sttHandlerId = null;
  }

  _log(...args) {
    if (this._config.debug) console.log('[avatar-panel]', ...args);
  }

  _renderShell() {
    const greeting = this._config.greeting || '';
    // Silhouette (Kopf + Hals + Schultern) — auch für Clip & Punkt-Test genutzt.
    const BUST =
      'M120,30 C156,30 180,58 181,98 C182,128 171,160 150,180 ' +
      'C145,187 141,193 140,200 L145,216 C150,226 178,230 198,238 ' +
      'C218,246 230,260 234,280 L6,280 C10,260 22,246 42,238 ' +
      'C62,230 90,226 95,216 L100,200 C99,193 95,187 90,180 ' +
      'C69,160 58,128 59,98 C60,58 84,30 120,30 Z';
    this.shadowRoot.innerHTML = `
      <style>
        :host { --mouth: 0; display:block; width:100%; height:100%; }
        .root {
          position:relative; width:100%; min-height:320px; height:100%;
          display:flex; flex-direction:column; align-items:center; justify-content:center;
          gap:18px; padding:24px; box-sizing:border-box;
          background: radial-gradient(120% 120% at 50% 30%, rgba(40,52,74,0.55), rgba(12,16,26,0.85));
          border:1px solid rgba(255,255,255,0.12); border-radius:24px; overflow:hidden;
          color:#fff; font-family: system-ui, sans-serif;
        }

        /* ---- Avatar-Bühne ---- */
        .stage { position:relative; width:240px; height:280px; }
        .ring {
          position:absolute; left:50%; top:108px; width:200px; height:200px;
          margin:-100px 0 0 -100px; border-radius:50%;
          border:2px solid var(--accent, #5ad1ff);
          opacity:0; transform:scale(0.9); pointer-events:none;
        }
        .halo {
          position:absolute; left:50%; top:108px; width:248px; height:248px;
          margin:-124px 0 0 -124px; border-radius:50%;
          background: radial-gradient(circle, var(--glow, rgba(90,209,255,0.30)) 0%, transparent 66%);
          transition: background .4s ease; pointer-events:none;
        }
        .avatar { position:relative; width:100%; height:100%; display:block;
          transform-origin:center bottom; }

        /* Hologramm-Farben folgen dem Zustand (--accent) */
        .stroke    { stroke: var(--accent); fill:none; }
        .wire      { stroke: var(--accent); fill:none; stroke-width:0.5; opacity:0.45; }
        .holo-fill { fill: var(--accent); }
        .face-fill { fill: var(--accent); }
        .feat-line { stroke: var(--accent); fill:none; }
        .glow      { filter: drop-shadow(0 0 3px var(--accent)); }

        /* Leuchtende Datenpunkte (prozedural), funkeln zeitversetzt */
        .dot  { fill: var(--accent); animation: twinkle 3.2s ease-in-out infinite; }
        @keyframes twinkle { 0%,100%{opacity:.22;} 50%{opacity:.85;} }

        .scan { animation: scanmove 4s linear infinite; }
        @keyframes scanmove { 0%{transform:translateY(-80px);opacity:0;} 10%{opacity:.8;}
                              90%{opacity:.8;} 100%{transform:translateY(150px);opacity:0;} }
        .iris { fill: var(--accent); animation: eyepulse 3s ease-in-out infinite; }
        @keyframes eyepulse { 0%,100%{opacity:.95;} 50%{opacity:.55;} }

        /* Mund / Lippensync über --mouth */
        .mouth-open { transform-box: fill-box; transform-origin:center; transform: scaleY(var(--mouth)); }
        .lip-lower  { transform: translateY(calc(var(--mouth) * 7px)); transition: transform .04s linear; }

        /* ---- Zustände ---- */
        .state-idle      { --accent:#7fd4e8; --glow:rgba(127,212,232,0.30); }
        .state-listening { --accent:#33e1ff; --glow:rgba(51,225,255,0.48); }
        .state-thinking  { --accent:#ffce4d; --glow:rgba(255,206,77,0.42); }
        .state-speaking  { --accent:#46e39a; --glow:rgba(70,227,154,0.46); }

        .state-idle .avatar { animation: breathe 5s ease-in-out infinite; }
        @keyframes breathe { 0%,100%{transform:scale(1);} 50%{transform:scale(1.015);} }

        .state-listening .ring { animation: pulse 1.6s ease-out infinite; }
        @keyframes pulse { 0%{opacity:.7;transform:scale(0.9);} 100%{opacity:0;transform:scale(1.2);} }

        .state-thinking .ring { opacity:.85; animation: spin 1.1s linear infinite;
          border-color: transparent; border-top-color: var(--accent); }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* ---- Text ---- */
        #status { font-size:20px; font-weight:600; letter-spacing:.3px; opacity:.9; }
        #transcript {
          max-width:560px; text-align:center; font-size:15px; line-height:1.4;
          color:rgba(255,255,255,0.72); min-height:1.4em; padding:0 12px;
        }

        /* ---- Start-/Fehler-Overlay ---- */
        #overlay {
          position:absolute; inset:0; display:flex; flex-direction:column; gap:14px;
          align-items:center; justify-content:center; cursor:pointer;
          background:rgba(8,11,18,0.7); backdrop-filter:blur(4px); text-align:center; padding:24px;
        }
        #overlay .mic { font-size:54px; }
        #overlayText { font-size:17px; max-width:420px; color:rgba(255,255,255,0.85); }
        audio { display:none; }
      </style>

      <div class="root">
        <div class="stage state-idle" id="stage">
          <div class="halo"></div>
          <div class="ring"></div>
          <svg class="avatar" viewBox="0 0 240 280" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <clipPath id="bustclip"><path d="${BUST}"/></clipPath>
            </defs>

            <!-- Projektor-Basis -->
            <g class="glow"><ellipse class="holo-fill" opacity="0.20" cx="120" cy="272" rx="80" ry="7"/></g>

            <!-- Silhouette (Kopf + Hals + Schultern) -->
            <path class="face-fill" opacity="0.06" d="${BUST}"/>
            <g class="glow"><path class="stroke" stroke-width="1.4" d="${BUST}"/></g>

            <!-- Mesh + Datenpunkte (prozedural in _buildHolo erzeugt) -->
            <g id="mesh" class="wire" clip-path="url(#bustclip)"></g>
            <g id="dots" clip-path="url(#bustclip)"></g>

            <!-- Scanlinie -->
            <g clip-path="url(#bustclip)">
              <line class="scan stroke glow" x1="18" y1="120" x2="222" y2="120" stroke-width="1.4" opacity="0.6"/>
            </g>

            <!-- Gesichtszüge -->
            <g class="features glow">
              <path class="feat-line" stroke-width="1.3" d="M86,95 Q100,89 114,96"/>
              <path class="feat-line" stroke-width="1.3" d="M126,96 Q140,89 154,95"/>
              <path class="feat-line" stroke-width="1.1" d="M88,107 Q100,99 112,107 Q100,113 88,107 Z"/>
              <path class="feat-line" stroke-width="1.1" d="M128,107 Q140,99 152,107 Q140,113 128,107 Z"/>
              <circle class="iris" cx="100" cy="107" r="3"/>
              <circle class="iris" cx="140" cy="107" r="3"/>
              <path class="feat-line" stroke-width="1.1"
                    d="M120,108 L115,150 Q120,156 125,150 M112,150 Q116,154 120,153 M128,150 Q124,154 120,153"/>
              <ellipse class="mouth-open" cx="120" cy="174" rx="13" ry="4.5" fill="#05151c"/>
              <path class="feat-line" stroke-width="1.3" d="M104,172 Q112,167 120,170 Q128,167 136,172"/>
              <path class="feat-line lip-lower" stroke-width="1.3" d="M105,176 Q120,186 135,176"/>
              <path class="feat-line" stroke-width="0.7" opacity="0.45" d="M150,120 Q156,150 134,182"/>
              <path class="feat-line" stroke-width="0.7" opacity="0.45" d="M90,120 Q84,150 106,182"/>
            </g>
          </svg>
        </div>
        <div id="status">${STATUS_TEXT.idle}</div>
        <div id="transcript"></div>

        <div id="overlay">
          <div class="mic">🎙️</div>
          <div id="overlayText">${greeting}<br><small>Zum Aktivieren tippen</small></div>
        </div>
        <audio id="tts" crossorigin="anonymous"></audio>
      </div>
    `;

    const overlay = this.shadowRoot.getElementById('overlay');
    overlay?.addEventListener('click', () => this._start());

    this._buildHolo(BUST);
  }

  /** Erzeugt Mesh-Linien (3D-Andeutung) und leuchtende Datenpunkte in der Silhouette. */
  _buildHolo(bustD) {
    const mesh = this.shadowRoot.getElementById('mesh');
    const dots = this.shadowRoot.getElementById('dots');
    if (!mesh || !dots) return;

    // Längs- (gewölbt) und Querlinien deuten die Kopfwölbung an.
    let m = '';
    for (let x = 56; x <= 184; x += 7) {
      const bow = (x - 120) * 0.16;
      m += `<path d="M${x},42 Q${(x + bow).toFixed(1)},152 ${x},262"/>`;
    }
    for (let y = 44; y <= 262; y += 7) {
      const bulge = 7 * Math.sin(Math.min(Math.PI, ((y - 40) / 220) * Math.PI));
      m += `<path d="M14,${y} Q120,${(y + bulge).toFixed(1)} 226,${y}"/>`;
    }
    mesh.innerHTML = m;

    // Datenpunkte nur innerhalb der Silhouette (Point-in-Path via Canvas).
    let ctx = null;
    try {
      ctx = document.createElement('canvas').getContext('2d');
    } catch {
      ctx = null;
    }
    const P2D = window.Path2D;
    const path = ctx && P2D ? new P2D(bustD) : null;
    let d = '';
    for (let i = 0; i < 520; i++) {
      const x = 6 + Math.random() * 228;
      const y = 30 + Math.random() * 250;
      if (path && !ctx.isPointInPath(path, x, y)) continue;
      const r = (0.5 + Math.random() * 1.0).toFixed(2);
      const delay = (Math.random() * 3.2).toFixed(2);
      d += `<circle class="dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" style="animation-delay:${delay}s"/>`;
    }
    dots.innerHTML = d;
  }
}

customElements.define('avatar-panel-card', AvatarPanelCard);

// =====================================================================
//  Visueller Editor
// =====================================================================
class AvatarPanelCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._pipelines = [];
    this._rendered = false;
  }

  /** @param {LovelaceCardConfig} config */
  setConfig(config) {
    this._config = {
      wake_word: true,
      continue_conversation: false,
      greeting: 'Sag „Ok Nabu“',
      debug: false,
      ...config,
    };
    this._render();
  }

  /** @param {HomeAssistant} hass */
  set hass(hass) {
    this._hass = hass;
    if (!this._rendered) this._render();
    if (!this._pipelines.length && hass) this._loadPipelines();
  }

  _loadPipelines() {
    this._hass
      .callWS({ type: 'assist_pipeline/pipeline/list' })
      .then((res) => {
        this._pipelines = res?.pipelines || [];
        this._render();
      })
      .catch(() => {});
  }

  _emit() {
    this.dispatchEvent(
      new CustomEvent('config-changed', {
        detail: { config: this._config },
        bubbles: true,
        composed: true,
      })
    );
  }

  _update(key, value) {
    const cfg = { ...this._config };
    if (value === '' || value === undefined) delete cfg[key];
    else cfg[key] = value;
    this._config = cfg;
    this._emit();
  }

  _render() {
    this._rendered = true;
    const c = this._config;
    const root = this.shadowRoot;
    const pipeOpts = [['', 'Bevorzugte Pipeline']].concat(
      this._pipelines.map((p) => [p.id, p.name])
    );

    root.innerHTML = `
      <style>
        .editor{display:flex;flex-direction:column;gap:14px;padding:8px 0;}
        .field{display:flex;flex-direction:column;gap:5px;}
        label{font-size:13px;font-weight:500;color:var(--primary-text-color,#212121);}
        .hint{font-size:11px;color:var(--secondary-text-color,#727272);}
        input[type=text],select{
          padding:9px 11px;border-radius:8px;border:1px solid var(--divider-color,#e0e0e0);
          background:var(--card-background-color,#fff);color:var(--primary-text-color,#212121);
          font-size:13px;outline:none;box-sizing:border-box;width:100%;}
        .toggle-row{display:flex;align-items:center;justify-content:space-between;padding:4px 0;}
        .toggle-row label{flex:1;}
        .section{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;
          color:var(--secondary-text-color,#727272);margin-top:6px;
          border-bottom:1px solid var(--divider-color,#e0e0e0);padding-bottom:4px;}
      </style>
      <div class="editor">
        <div class="section">Pipeline</div>
        <div class="field">
          <label>Assist-Pipeline (mit NVIDIA-Conversation)</label>
          <select id="pipeline_id">
            ${pipeOpts
              .map(
                ([v, l]) =>
                  `<option value="${v}" ${(c.pipeline_id || '') === v ? 'selected' : ''}>${l}</option>`
              )
              .join('')}
          </select>
          <span class="hint">Pipeline in Einstellungen → Sprachassistenten anlegen.</span>
        </div>

        <div class="section">Verhalten</div>
        <div class="toggle-row">
          <label>Wake Word nutzen (sonst: Tippen startet)</label>
          <input type="checkbox" id="wake_word" ${c.wake_word !== false ? 'checked' : ''} />
        </div>
        <div class="toggle-row">
          <label>Folge-Konversation merken</label>
          <input type="checkbox" id="continue_conversation" ${c.continue_conversation ? 'checked' : ''} />
        </div>
        <div class="toggle-row">
          <label>Debug-Log (Konsole)</label>
          <input type="checkbox" id="debug" ${c.debug ? 'checked' : ''} />
        </div>

        <div class="section">Text</div>
        <div class="field">
          <label>Begrüßung im Start-Overlay</label>
          <input type="text" id="greeting" value="${c.greeting || ''}" placeholder="Sag „Ok Nabu“" />
        </div>
      </div>
    `;

    root.getElementById('pipeline_id')?.addEventListener('change', (e) =>
      this._update('pipeline_id', (/** @type {HTMLSelectElement} */ (e.target)).value)
    );
    ['wake_word', 'continue_conversation', 'debug'].forEach((id) => {
      root.getElementById(id)?.addEventListener('change', (e) =>
        this._update(id, (/** @type {HTMLInputElement} */ (e.target)).checked)
      );
    });
    root.getElementById('greeting')?.addEventListener('change', (e) =>
      this._update('greeting', (/** @type {HTMLInputElement} */ (e.target)).value)
    );
  }
}

customElements.define('avatar-panel-card-editor', AvatarPanelCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'avatar-panel-card',
  name: 'Avatar Panel Card',
  description: 'Sprechender AI-Avatar fürs Tablet — Wake Word, Assist-Pipeline, Lippensync (idle/listening/thinking/speaking).',
  preview: true,
});

// =====================================================================
//  Panel-Wrapper — macht den Avatar zur Vollbild-„App" (Sidebar-Eintrag).
//  Von der Integration via panel_custom registriert (webcomponent
//  "avatar-panel-app"). HA setzt hass/narrow/route/panel als Properties.
// =====================================================================
class AvatarPanelApp extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._card = null;
  }

  set hass(hass) {
    this._hass = hass;
    this._ensure();
    if (this._card) this._card.hass = hass;
  }

  set panel(panel) {
    this._panel = panel;
    this._ensure();
  }

  set narrow(_v) {}
  set route(_v) {}

  _ensure() {
    if (this._card || !this._hass) return;

    const opts = (this._panel && this._panel.config && this._panel.config.options) || {};

    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; width:100%; height:100%; }
        .wrap {
          position:fixed; inset:0;
          display:flex; align-items:center; justify-content:center;
          background:#070b12;
        }
        avatar-panel-card { width:100%; height:100%; }
      </style>
      <div class="wrap"></div>
    `;

    const card = /** @type {any} */ (document.createElement('avatar-panel-card'));
    card.setConfig({
      type: 'custom:avatar-panel-card',
      greeting: opts.greeting,
      wake_word: opts.wake_word !== false,
      pipeline_id: opts.pipeline_id || undefined,
    });
    card.hass = this._hass;
    this.shadowRoot.querySelector('.wrap').appendChild(card);
    this._card = card;
  }
}

if (!customElements.get('avatar-panel-app')) {
  customElements.define('avatar-panel-app', AvatarPanelApp);
}
