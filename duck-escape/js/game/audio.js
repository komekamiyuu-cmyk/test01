/* ============================================================
   効果音とBGM(すべてWeb Audioでその場で合成。音声ファイル不要)
   最初のタップ/クリックで AudioContext を起こす。
   ============================================================ */

export function createAudio() {
  let ctx = null, master = null, musicGain = null;
  let enabled = true;
  let nextBeat = 0, beat = 0, playingBgm = false, tension = 0;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { enabled = false; return null; }
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.75;
      master.connect(ctx.destination);
      musicGain = ctx.createGain();
      musicGain.gain.value = 0.22;
      musicGain.connect(master);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /** 短い音を鳴らすための共通部品 */
  function tone(freq, dur, type = 'square', vol = 0.2, at = 0, slideTo = null, dest = null) {
    const t0 = ctx.currentTime + at;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(dest || master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  function noise(dur, vol = 0.25, filterFreq = 1800, at = 0, sweep = null) {
    const t0 = ctx.currentTime + at;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(filterFreq, t0);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(80, sweep), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t0);
  }

  const SFX = {
    pistol() { tone(680, 0.09, 'square', 0.16, 0, 180); noise(0.13, 0.3, 3200, 0, 600); },
    machinegun() { tone(520, 0.06, 'square', 0.1, 0, 160); noise(0.08, 0.22, 2600, 0, 700); },
    shuriken() { noise(0.22, 0.16, 5200, 0, 900); tone(1500, 0.12, 'triangle', 0.05, 0, 700); },
    hitOni() { noise(0.12, 0.28, 900, 0, 200); tone(150, 0.12, 'square', 0.12, 0, 70); },
    oniDown() { tone(180, 0.6, 'sawtooth', 0.2, 0, 45); noise(0.5, 0.25, 700, 0, 120); },
    oniRoar() { tone(110, 0.5, 'sawtooth', 0.16, 0, 70); tone(163, 0.45, 'square', 0.06, 0.02, 90); },
    oniSwing() { noise(0.3, 0.22, 1400, 0, 300); },
    oniFire() { tone(420, 0.35, 'sine', 0.12, 0, 120); tone(630, 0.3, 'triangle', 0.06, 0.02, 200); },
    hurt() { tone(880, 0.16, 'square', 0.18, 0, 220); tone(560, 0.3, 'sawtooth', 0.1, 0.05, 130); },
    quack() { tone(720, 0.11, 'sawtooth', 0.16, 0, 420); tone(520, 0.13, 'sawtooth', 0.13, 0.1, 300); },
    pickup() { [660, 880, 1320].forEach((f, i) => tone(f, 0.12, 'triangle', 0.14, i * 0.05)); },
    heal() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.18, 'sine', 0.16, i * 0.06)); },
    empty() { tone(180, 0.07, 'square', 0.08); },
    dash() { noise(0.2, 0.14, 2600, 0, 400); },
    roundStart() { [392, 523, 659].forEach((f, i) => tone(f, 0.3, 'square', 0.14, i * 0.12)); },
    clear() { [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.42, 'triangle', 0.18, i * 0.13)); },
    gameover() { [440, 370, 294, 220].forEach((f, i) => tone(f, 0.5, 'sawtooth', 0.16, i * 0.18)); },
    gate() { [659, 988, 1318].forEach((f, i) => tone(f, 0.7, 'sine', 0.15, i * 0.1)); },
  };

  return {
    unlock() { ensure(); },
    play(name) {
      if (!enabled) return;
      if (!ensure()) return;
      const fn = SFX[name];
      if (fn) { try { fn(); } catch (e) { /* 音が出せなくてもゲームは続行 */ } }
    },
    /** 緊張度(0〜1)。鬼が近いほどBGMが速く・強くなる */
    setTension(v) { tension = Math.max(0, Math.min(1, v)); },
    startBgm() {
      if (!ensure()) return;
      playingBgm = true;
      nextBeat = ctx.currentTime + 0.1;
      beat = 0;
    },
    stopBgm() { playingBgm = false; },
    /** 毎フレーム呼ぶ。少し先の拍を予約していく方式 */
    update() {
      if (!playingBgm || !ctx) return;
      const bpm = 96 + tension * 34;
      const spb = 60 / bpm / 2;                       // 8分音符
      while (nextBeat < ctx.currentTime + 0.2) {
        const t = nextBeat - ctx.currentTime;
        const b = beat % 16;
        // 和太鼓っぽいキック
        if (b % 4 === 0) { tone(70, 0.22, 'sine', 0.5, t, 40, musicGain); }
        if (b === 6 || b === 14) { tone(58, 0.2, 'sine', 0.38, t, 36, musicGain); }
        // ベース(和風の音階)
        const scale = [0, 3, 5, 7, 10];
        if (b % 2 === 0) {
          const n = scale[(beat / 2 + Math.floor(beat / 16)) % scale.length];
          tone(110 * Math.pow(2, n / 12), spb * 1.6, 'triangle', 0.22 + tension * 0.1, t, null, musicGain);
        }
        // 笛(緊張が高いときだけ)
        if (tension > 0.5 && b % 8 === 3) {
          tone(587 * Math.pow(2, ((beat % 5) - 2) / 12), 0.4, 'sine', 0.1, t, null, musicGain);
        }
        beat++;
        nextBeat += spb;
      }
    },
    setEnabled(v) { enabled = v; if (master) master.gain.value = v ? 0.75 : 0; },
  };
}
