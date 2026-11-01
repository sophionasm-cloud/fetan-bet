/* Shared tiny WebAudio synth — all sounds are generated at runtime (no sampled audio). */
(function () {
  class SoundEngine {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.enabled = true;
      this.musicEnabled = true;
      this.musicTimer = null;
      this.musicStep = 0;
      this.musicStyle = 'road';
    }

    init() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.6;
      this.master.connect(this.ctx.destination);
    }

    setEnabled(on) {
      this.enabled = !!on;
      if (this.master) this.master.gain.value = on ? 0.6 : 0;
      if (!on) this.stopMusic();
      else if (this.musicEnabled) this.startMusic(this.musicStyle);
    }

    setMusic(on) {
      this.musicEnabled = !!on;
      if (!on) this.stopMusic();
      else this.startMusic(this.musicStyle);
    }

    tone({ freq = 440, dur = 0.15, type = 'sine', gain = 0.18, slide = 0, delay = 0 }) {
      if (!this.enabled) return;
      this.init();
      if (!this.ctx) return;
      const t0 = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, slide), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }

    noise({ dur = 0.2, gain = 0.12, freq = 1200, delay = 0 }) {
      if (!this.enabled) return;
      this.init();
      if (!this.ctx) return;
      const t0 = this.ctx.currentTime + delay;
      const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = freq;
      filter.Q.value = 0.7;
      const g = this.ctx.createGain();
      g.gain.value = gain;
      src.connect(filter).connect(g).connect(this.master);
      src.start(t0);
    }

    click() { this.tone({ freq: 560, dur: 0.06, type: 'triangle', gain: 0.1, slide: 700 }); }
    pop() { this.tone({ freq: 340, dur: 0.08, type: 'sine', gain: 0.12, slide: 620 }); }
    hop() {
      this.tone({ freq: 320, dur: 0.12, type: 'triangle', gain: 0.13, slide: 640 });
      this.noise({ dur: 0.05, gain: 0.03, freq: 2200 });
    }
    tick() { this.tone({ freq: 900, dur: 0.04, type: 'square', gain: 0.05 }); }
    coin() {
      this.tone({ freq: 880, dur: 0.09, type: 'triangle', gain: 0.12 });
      this.tone({ freq: 1320, dur: 0.12, type: 'triangle', gain: 0.1, delay: 0.07 });
    }
    cash() {
      [523, 659, 784, 1046].forEach((f, i) => this.tone({ freq: f, dur: 0.16, type: 'triangle', gain: 0.12, delay: i * 0.07 }));
      this.noise({ dur: 0.25, gain: 0.04, freq: 3200 });
    }
    crash() {
      this.noise({ dur: 0.45, gain: 0.2, freq: 420 });
      this.tone({ freq: 160, dur: 0.35, type: 'sawtooth', gain: 0.14, slide: 50 });
    }
    win() {
      [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone({ freq: f, dur: 0.22, type: 'triangle', gain: 0.13, delay: i * 0.1 }));
      this.noise({ dur: 0.5, gain: 0.05, freq: 3600 });
    }
    lose() {
      [392, 330, 262].forEach((f, i) => this.tone({ freq: f, dur: 0.25, type: 'sine', gain: 0.13, delay: i * 0.14 }));
    }
    kick() {
      this.tone({ freq: 110, dur: 0.16, type: 'sine', gain: 0.22, slide: 50 });
      this.noise({ dur: 0.09, gain: 0.12, freq: 900 });
    }
    whistle() {
      this.tone({ freq: 1800, dur: 0.12, type: 'sine', gain: 0.06, slide: 2100 });
      this.tone({ freq: 2100, dur: 0.16, type: 'sine', gain: 0.05, slide: 1700, delay: 0.1 });
    }
    save() {
      this.noise({ dur: 0.2, gain: 0.15, freq: 600 });
      this.tone({ freq: 220, dur: 0.2, type: 'triangle', gain: 0.12, slide: 120 });
    }
    goal() {
      this.noise({ dur: 0.7, gain: 0.08, freq: 2600 });
      [392, 523, 659, 784].forEach((f, i) => this.tone({ freq: f, dur: 0.25, type: 'triangle', gain: 0.12, delay: i * 0.09 }));
    }
    crowd() {
      this.noise({ dur: 1.1, gain: 0.05, freq: 1600 });
      this.noise({ dur: 0.8, gain: 0.03, freq: 800 });
    }

    startMusic(style = 'road') {
      if (!this.enabled || !this.musicEnabled) return;
      this.init();
      if (!this.ctx) return;
      this.musicStyle = style;
      if (this.musicTimer) return;
      const chords = style === 'penalty'
        ? [[196, 247, 294], [220, 277, 330], [174, 220, 262], [196, 247, 294]]
        : [[130.8, 155.6, 196], [116.5, 146.8, 174.6], [98, 123.5, 146.8], [110, 138.6, 164.8]];
      const bass = style === 'penalty' ? [98, 110, 87, 98] : [65.4, 58.3, 49, 55];
      this.musicStep = 0;
      const playBar = () => {
        if (!this.enabled || !this.musicEnabled) return;
        const i = this.musicStep % chords.length;
        chords[i].forEach((f, k) => {
          this.tone({ freq: f, dur: 3.2, type: 'sine', gain: 0.022, delay: k * 0.03 });
          this.tone({ freq: f * 2, dur: 2.4, type: 'triangle', gain: 0.008, delay: 0.4 + k * 0.12 });
        });
        this.tone({ freq: bass[i], dur: 2.8, type: 'sine', gain: 0.03 });
        this.musicStep++;
      };
      playBar();
      this.musicTimer = setInterval(playBar, 3200);
    }

    stopMusic() {
      if (this.musicTimer) {
        clearInterval(this.musicTimer);
        this.musicTimer = null;
      }
    }
  }

  window.Sound = new SoundEngine();
})();
