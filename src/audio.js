/**
 * 星际穿越 · Web Audio 原生宇宙音效引擎
 * ------------------------------------------------------------------
 * 全部声音均由 Web Audio API 实时合成，不依赖任何外部音频文件：
 *  - 深空低频轰鸣（多层正弦 + 布朗噪声 + 卷积混响）
 *  - 时空弯曲相位调制（LFO 调制滤波器与声像）
 *  - 曲速推进器（锯齿波 + 带通噪声，随速度改变音高）
 *  - 量子相位撕裂（随机高频噪声爆裂与金属泛音）
 *  - 出洞清澈和声（大三和弦 + 长混响）
 */

const TAU = Math.PI * 2;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

export class CosmicAudio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.volume = 0.7;
    this.muted = false;
    this.stage = 1;
    this.inside = 0;
    this.warp = 0;
    this.boost = false;
    this.brake = false;
    this.speed = 0;

    this._quantumCooldown = 0;
    this._lastStage = 0;
    this._started = false;
    this._disposed = false;

    // 平滑状态
    this._sm = {
      drone: 0.34,
      rumble: 0.24,
      pad: 0.06,
      engine: 0.05,
      engineFilter: 420,
      whine: 0,
      shear: 0,
      pan: 0,
    };
  }

  async init() {
    if (this.ready || this._disposed) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      console.warn('[audio] Web Audio API 不可用');
      return;
    }
    this.ctx = new AC({ latencyHint: 'interactive' });

    // ---- 主输出链 ----
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume * 0.85;

    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -20;
    this.compressor.knee.value = 22;
    this.compressor.ratio.value = 4.2;
    this.compressor.attack.value = 0.012;
    this.compressor.release.value = 0.28;

    this.master.connect(this.compressor);
    this.compressor.connect(this.ctx.destination);

    // ---- 程序化卷积混响 ----
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this._makeImpulse(3.6, 2.6);
    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = 0.46;
    this.reverb.connect(this.reverbGain);
    this.reverbGain.connect(this.master);

    this.wetSend = this.ctx.createGain();
    this.wetSend.gain.value = 0.5;
    this.wetSend.connect(this.reverb);

    // ---- 布朗噪声缓冲 ----
    this.noiseBuffer = this._makeNoise(4.0, 'brown');
    this.whiteBuffer = this._makeNoise(2.5, 'white');

    this._buildDrone();
    this._buildShear();
    this._buildEngine();
    this._buildPad();

    this.ready = true;
    await this.ctx.resume().catch(() => {});
    this._setLinkState('stable');
  }

  _makeNoise(seconds, type) {
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buffer = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      if (type === 'brown') {
        let last = 0;
        for (let i = 0; i < len; i++) {
          const white = Math.random() * 2 - 1;
          last = (last + 0.02 * white) / 1.02;
          data[i] = last * 3.2;
        }
      } else {
        for (let i = 0; i < len; i++) {
          data[i] = (Math.random() * 2 - 1) * 0.9;
        }
      }
    }
    // 首尾淡入淡出，避免循环爆音
    const fade = Math.floor(sr * 0.08);
    for (let ch = 0; ch < 2; ch++) {
      const d = buffer.getChannelData(ch);
      for (let i = 0; i < fade; i++) {
        const g = i / fade;
        d[i] *= g;
        d[len - 1 - i] *= g;
      }
    }
    return buffer;
  }

  _makeImpulse(seconds, decay) {
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const impulse = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const env = Math.pow(1 - t, decay);
        // 稀疏早期反射 + 扩散尾音
        const early = i < sr * 0.09 && Math.random() > 0.996 ? 0.9 : 0.0;
        data[i] = ((Math.random() * 2 - 1) * 0.55 + early) * env;
      }
    }
    return impulse;
  }

  _buildDrone() {
    const ctx = this.ctx;
    this.droneBus = ctx.createGain();
    this.droneBus.gain.value = this._sm.drone;

    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 210;
    this.droneFilter.Q.value = 1.1;

    this.droneBus.connect(this.droneFilter);
    this.droneFilter.connect(this.master);

    // 三层低频正弦
    const freqs = [34.5, 51.9, 77.3, 103.8];
    this.droneOscs = freqs.map((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = i === 3 ? 'triangle' : 'sine';
      osc.frequency.value = f;
      osc.detune.value = (i - 1.5) * 4.5;

      const g = ctx.createGain();
      g.gain.value = i === 0 ? 0.36 : i === 1 ? 0.2 : i === 2 ? 0.12 : 0.035;
      osc.connect(g);
      g.connect(this.droneBus);

      // 缓慢失谐 LFO，形成“时空呼吸”
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.035 + i * 0.013;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 2.4 + i * 0.8;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.detune);
      lfo.start();

      osc.start();
      return osc;
    });

    // 布朗噪声低频轰鸣
    this.rumble = ctx.createBufferSource();
    this.rumble.buffer = this.noiseBuffer;
    this.rumble.loop = true;

    this.rumbleFilter = ctx.createBiquadFilter();
    this.rumbleFilter.type = 'lowpass';
    this.rumbleFilter.frequency.value = 135;
    this.rumbleFilter.Q.value = 0.8;

    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = this._sm.rumble;

    this.rumble.connect(this.rumbleFilter);
    this.rumbleFilter.connect(this.rumbleGain);
    this.rumbleGain.connect(this.master);
    this.rumbleGain.connect(this.wetSend);
    this.rumble.start();

    // 亚低频颤动
    this.subOsc = ctx.createOscillator();
    this.subOsc.type = 'sine';
    this.subOsc.frequency.value = 21.5;
    this.subGain = ctx.createGain();
    this.subGain.gain.value = 0.12;
    this.subOsc.connect(this.subGain);
    this.subGain.connect(this.master);
    this.subOsc.start();
  }

  _buildShear() {
    const ctx = this.ctx;

    // 引力剪切低频震荡：两个接近的频率产生拍频
    this.shearGain = ctx.createGain();
    this.shearGain.gain.value = 0.0;
    this.shearFilter = ctx.createBiquadFilter();
    this.shearFilter.type = 'bandpass';
    this.shearFilter.frequency.value = 90;
    this.shearFilter.Q.value = 2.2;
    this.shearGain.connect(this.shearFilter);
    this.shearFilter.connect(this.master);
    this.shearGain.connect(this.wetSend);

    this.shearOscA = ctx.createOscillator();
    this.shearOscA.type = 'sine';
    this.shearOscA.frequency.value = 43.2;

    this.shearOscB = ctx.createOscillator();
    this.shearOscB.type = 'triangle';
    this.shearOscB.frequency.value = 46.8;

    this.shearOscA.connect(this.shearGain);
    this.shearOscB.connect(this.shearGain);
    this.shearOscA.start();
    this.shearOscB.start();

    // 极慢 LFO，控制剪切声像与音量
    this.shearLfo = ctx.createOscillator();
    this.shearLfo.frequency.value = 0.085;
    this.shearLfoGain = ctx.createGain();
    this.shearLfoGain.gain.value = 0.035;
    this.shearLfo.connect(this.shearLfoGain);
    this.shearLfoGain.connect(this.shearGain.gain);
    this.shearLfo.start();
  }

  _buildEngine() {
    const ctx = this.ctx;

    this.engineBus = ctx.createGain();
    this.engineBus.gain.value = 0.0;

    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 420;
    this.engineFilter.Q.value = 3.2;

    this.enginePan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;

    this.engineBus.connect(this.engineFilter);
    if (this.enginePan) {
      this.engineFilter.connect(this.enginePan);
      this.enginePan.connect(this.master);
    } else {
      this.engineFilter.connect(this.master);
    }
    this.engineBus.connect(this.wetSend);

    // 锯齿推进器
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 52;
    this.engineOsc.detune.value = -8;
    this.engineOscGain = ctx.createGain();
    this.engineOscGain.gain.value = 0.28;
    this.engineOsc.connect(this.engineOscGain);
    this.engineOscGain.connect(this.engineBus);
    this.engineOsc.start();

    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = 'square';
    this.engineOsc2.frequency.value = 77.5;
    this.engineOsc2Gain = ctx.createGain();
    this.engineOsc2Gain.gain.value = 0.06;
    this.engineOsc2.connect(this.engineOsc2Gain);
    this.engineOsc2Gain.connect(this.engineBus);
    this.engineOsc2.start();

    // 推进器噪声喷流
    this.engineNoise = ctx.createBufferSource();
    this.engineNoise.buffer = this.whiteBuffer;
    this.engineNoise.loop = true;
    this.engineNoiseFilter = ctx.createBiquadFilter();
    this.engineNoiseFilter.type = 'bandpass';
    this.engineNoiseFilter.frequency.value = 620;
    this.engineNoiseFilter.Q.value = 1.4;
    this.engineNoiseGain = ctx.createGain();
    this.engineNoiseGain.gain.value = 0.1;
    this.engineNoise.connect(this.engineNoiseFilter);
    this.engineNoiseFilter.connect(this.engineNoiseGain);
    this.engineNoiseGain.connect(this.engineBus);
    this.engineNoise.start();

    // 高频涡轮啸叫
    this.whine = ctx.createOscillator();
    this.whine.type = 'sine';
    this.whine.frequency.value = 880;
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0.0;
    this.whine.connect(this.whineGain);
    this.whineGain.connect(this.master);
    this.whineGain.connect(this.wetSend);
    this.whine.start();
  }

  _buildPad() {
    const ctx = this.ctx;

    this.padBus = ctx.createGain();
    this.padBus.gain.value = this._sm.pad;

    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 700;
    this.padFilter.Q.value = 0.7;

    this.padBus.connect(this.padFilter);
    this.padFilter.connect(this.master);
    this.padFilter.connect(this.wetSend);

    this.padOscs = [110, 164.81, 220, 329.63].map((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = i % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.value = f;
      osc.detune.value = (i - 1.5) * 6;

      const g = ctx.createGain();
      g.gain.value = i === 3 ? 0.1 : 0.18;
      osc.connect(g);
      g.connect(this.padBus);

      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + i * 0.017;
      const lg = ctx.createGain();
      lg.gain.value = 5;
      lfo.connect(lg);
      lg.connect(osc.detune);
      lfo.start();

      osc.start();
      return osc;
    });
  }

  _setLinkState(state) {
    this.linkState = state;
  }

  setVolume(value) {
    this.volume = clamp(value, 0, 1);
    if (!this.ready) return;
    this._ramp(this.master.gain, this.muted ? 0 : this.volume * 0.85, 0.12);
  }

  setMuted(muted) {
    this.muted = muted;
    if (!this.ready) return;
    this._ramp(this.master.gain, muted ? 0 : this.volume * 0.85, 0.25);
  }

  async resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume().catch(() => {});
    }
  }

  _ramp(param, value, time = 0.2) {
    if (!param) return;
    const now = this.ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setTargetAtTime(value, now, Math.max(0.01, time * 0.45));
  }

  update({ dt = 0.016, stage = 1, inside = 0, warp = 0, boost = false, brake = false, speed = 0 } = {}) {
    if (!this.ready) return;
    if (this.ctx.state === 'suspended') return;

    const t = this.ctx.currentTime;
    this.stage = stage;
    this.inside = inside;
    this.warp = warp;
    this.boost = boost;
    this.brake = brake;
    this.speed = speed;

    const insideSmooth = clamp(inside, 0, 1);
    const boostSmooth = boost ? 1 : 0;
    const brakeSmooth = brake ? 1 : 0;

    // 深空轰鸣：进入喉部时增强，出洞后回归平静
    const droneTarget = stage === 3 ? 0.24 : lerp(0.3, 0.58, insideSmooth);
    this._ramp(this.droneBus.gain, droneTarget, 0.6);
    this._ramp(this.rumbleGain.gain, stage === 3 ? 0.18 : lerp(0.22, 0.45, insideSmooth), 0.7);
    this._ramp(this.subGain.gain, stage === 3 ? 0.07 : lerp(0.1, 0.2, insideSmooth), 0.8);
    this._ramp(this.droneFilter.frequency, lerp(190, 420, insideSmooth) + boostSmooth * 90, 0.4);

    // 引力剪切
    const shearTarget = insideSmooth * 0.16 + (stage === 2 ? 0.08 : 0.0);
    this._ramp(this.shearGain.gain, shearTarget, 0.35);
    this._ramp(this.shearFilter.frequency, 72 + insideSmooth * 82, 0.5);

    // 引擎
    const throttle = clamp(speed, 0, 1);
    const engineTarget = brakeSmooth
      ? 0.045
      : lerp(0.12, 0.34, throttle) + boostSmooth * 0.24 + insideSmooth * 0.08;
    this._ramp(this.engineBus.gain, engineTarget, 0.12);
    this._ramp(this.engineFilter.frequency, 380 + throttle * 2200 + boostSmooth * 1600, 0.12);
    this._ramp(this.engineOsc.frequency, 48 + throttle * 74 + boostSmooth * 58, 0.15);
    this._ramp(this.engineOsc2.frequency, 71 + throttle * 96 + boostSmooth * 82, 0.15);
    this._ramp(this.engineNoiseFilter.frequency, 520 + throttle * 1900 + boostSmooth * 1700, 0.12);
    this._ramp(this.whineGain.gain, boostSmooth * 0.032 + insideSmooth * 0.012, 0.2);
    this._ramp(this.whine.frequency, 820 + throttle * 1100 + boostSmooth * 1500, 0.25);
    if (this.enginePan) {
      this._ramp(this.enginePan.pan, Math.sin(t * 0.17) * 0.18 * insideSmooth, 0.4);
    }

    // 高维和声铺底
    this._ramp(this.padBus.gain, stage === 3 ? 0.12 : lerp(0.04, 0.1, insideSmooth), 1.2);
    this._ramp(this.padFilter.frequency, stage === 3 ? 1500 : lerp(520, 940, insideSmooth), 1.0);

    // 量子撕裂随机事件
    this._quantumCooldown -= dt;
    if (this._quantumCooldown <= 0) {
      const intensity = clamp(insideSmooth * 0.8 + boostSmooth * 0.6 + (stage === 2 ? 0.25 : 0), 0, 1);
      if (intensity > 0.12 && Math.random() < dt * (1.1 + intensity * 7.5)) {
        this._quantumBurst(intensity);
        this._quantumCooldown = lerp(0.55, 0.12, intensity) * (0.7 + Math.random() * 0.7);
      } else {
        this._quantumCooldown = 0.2;
      }
    }

    // 阶段切换事件
    if (stage !== this._lastStage) {
      if (this._lastStage !== 0) this._onStageChange(stage);
      this._lastStage = stage;
    }
  }

  _quantumBurst(intensity = 0.6) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const panValue = Math.random() * 2 - 1;

    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) pan.pan.value = panValue;

    const bus = ctx.createGain();
    bus.gain.value = 0.14 + intensity * 0.2;

    if (pan) {
      bus.connect(pan);
      pan.connect(this.master);
      pan.connect(this.wetSend);
    } else {
      bus.connect(this.master);
      bus.connect(this.wetSend);
    }

    // 高频噪声撕裂
    const src = ctx.createBufferSource();
    src.buffer = this.whiteBuffer;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 2.4;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1200 + Math.random() * 5200;
    bp.Q.value = 3 + Math.random() * 14;

    const env = ctx.createGain();
    const dur = 0.08 + Math.random() * 0.35;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.8 + intensity * 0.5, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(bp);
    bp.connect(env);
    env.connect(bus);
    src.start(t);
    src.stop(t + dur + 0.05);

    // 金属泛音
    const ping = ctx.createOscillator();
    ping.type = Math.random() > 0.5 ? 'sine' : 'triangle';
    const baseFreq = 700 + Math.random() * 2400;
    ping.frequency.setValueAtTime(baseFreq, t);
    ping.frequency.exponentialRampToValueAtTime(baseFreq * 0.45, t + dur * 0.8);

    const pingGain = ctx.createGain();
    pingGain.gain.setValueAtTime(0.0001, t);
    pingGain.gain.exponentialRampToValueAtTime(0.12 * intensity, t + 0.005);
    pingGain.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.4);

    ping.connect(pingGain);
    pingGain.connect(bus);
    ping.start(t);
    ping.stop(t + dur * 1.5 + 0.05);
  }

  _onStageChange(stage) {
    if (stage === 2) {
      this._riser();
      this._impact(0.65, 0.55);
    } else if (stage === 3) {
      this._emergenceChime();
      this._impact(0.5, 0.35);
    }
  }

  _riser() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(48, t);
    osc.frequency.exponentialRampToValueAtTime(520, t + 3.2);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(120, t);
    filter.frequency.exponentialRampToValueAtTime(3400, t + 3.2);
    filter.Q.value = 4;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.11, t + 2.7);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 3.4);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    gain.connect(this.wetSend);
    osc.start(t);
    osc.stop(t + 3.5);
  }

  _impact(gainValue = 0.5, duration = 0.4) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(74, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + duration * 1.6);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(gainValue, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration * 2.2);

    osc.connect(gain);
    gain.connect(this.master);
    gain.connect(this.wetSend);
    osc.start(t);
    osc.stop(t + duration * 2.4);
  }

  _emergenceChime() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const notes = [261.63, 392.0, 523.25, 659.25, 783.99];

    notes.forEach((freq, i) => {
      const start = t + i * 0.16 + 0.15;

      const osc = ctx.createOscillator();
      osc.type = i % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.value = freq;

      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.value = freq * 2.003;

      const gain = ctx.createGain();
      const peak = i === 0 ? 0.12 : 0.075 / (1 + i * 0.16);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.35);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 4.8);

      osc.connect(gain);
      osc2.connect(gain);
      gain.connect(this.master);
      gain.connect(this.wetSend);

      osc.start(start);
      osc2.start(start);
      osc.stop(start + 5.0);
      osc2.stop(start + 5.0);
    });

    // 清澈的高频空气感
    const air = ctx.createBufferSource();
    air.buffer = this.whiteBuffer;
    air.loop = true;
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = 'highpass';
    airFilter.frequency.value = 6200;
    const airGain = ctx.createGain();
    airGain.gain.setValueAtTime(0.0001, t);
    airGain.gain.exponentialRampToValueAtTime(0.012, t + 1.4);
    airGain.gain.exponentialRampToValueAtTime(0.0001, t + 6.0);
    air.connect(airFilter);
    airFilter.connect(airGain);
    airGain.connect(this.master);
    airGain.connect(this.wetSend);
    air.start(t);
    air.stop(t + 6.2);
  }

  // 手动触发：曲速爆发时的一声音浪
  boostBurst() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this.whiteBuffer;
    src.loop = true;
    src.playbackRate.setValueAtTime(0.6, t);
    src.playbackRate.exponentialRampToValueAtTime(2.4, t + 0.8);

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(280, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + 0.9);
    bp.Q.value = 1.6;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.25);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);

    src.connect(bp);
    bp.connect(gain);
    gain.connect(this.master);
    gain.connect(this.wetSend);
    src.start(t);
    src.stop(t + 2.0);
  }

  dispose() {
    this._disposed = true;
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.ready = false;
  }
}
