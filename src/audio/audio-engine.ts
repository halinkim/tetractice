import { config } from '../core/state';

class AudioEngine {
  [key: string]: any;
  constructor() {
    this.context = null;
    this.master = null;
  }
  ensure() {
    if (!config.ui.audioEnabled) return false;
    if (!this.context) {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return false;
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') this.context.resume().catch(() => {});
    this.master.gain.value = config.visual.volume / 100 * 0.24;
    return true;
  }
  tone(frequency, duration, type = 'sine', gain = 0.5, slide = 0) {
    if (!this.ensure()) return;
    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    const amp = this.context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, frequency + slide), now + duration);
    amp.gain.setValueAtTime(0.0001, now);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), now + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(amp);
    amp.connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }
  noise(duration = 0.08, gain = 0.12, highpass = 500) {
    if (!this.ensure()) return;
    const length = Math.floor(this.context.sampleRate * duration);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const amp = this.context.createGain();
    filter.type = 'highpass';
    filter.frequency.value = highpass;
    amp.gain.setValueAtTime(gain, this.context.currentTime);
    amp.gain.exponentialRampToValueAtTime(0.0001, this.context.currentTime + duration);
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(amp);
    amp.connect(this.master);
    source.start();
  }
  play(name, value = 0) {
    if (!config.ui.audioEnabled || config.visual.volume <= 0) return;
    switch (name) {
      case 'move': this.tone(150, 0.025, 'square', 0.08, 20); break;
      case 'rotate': this.tone(260, 0.045, 'triangle', 0.12, 100); break;
      case 'hold': this.tone(210, 0.07, 'sine', 0.18, -55); break;
      case 'soft': this.tone(95, 0.018, 'square', 0.035); break;
      case 'drop': this.noise(0.065, 0.15, 350); this.tone(72, 0.08, 'triangle', 0.16, -20); break;
      case 'lock': this.tone(110, 0.04, 'square', 0.08, -15); break;
      case 'clear':
        this.tone(330 + value * 45, 0.11, 'triangle', 0.2, 170);
        if (value >= 4) this.tone(660, 0.16, 'sine', 0.12, 260);
        break;
      case 'tspin': this.tone(390, 0.14, 'sawtooth', 0.15, 340); break;
      case 'finesse': this.tone(115, 0.11, 'square', 0.11, -45); break;
      case 'start': this.tone(520, 0.12, 'triangle', 0.2, 300); break;
      case 'count': this.tone(310, 0.07, 'sine', 0.14, 40); break;
      case 'complete':
        this.tone(440, 0.2, 'triangle', 0.18, 220);
        setTimeout(() => this.tone(660, 0.26, 'triangle', 0.16, 220), 100);
        break;
      case 'topout': this.tone(190, 0.35, 'sawtooth', 0.12, -120); break;
      default: break;
    }
  }
}

export { AudioEngine };
