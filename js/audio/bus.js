/* ============================================================
   オーディオバス
   マスター(コンプレッサーで音割れ防止)+ トラックごとのチャンネル。
   リアルタイム再生(AudioContext)と WAV 書き出し
   (OfflineAudioContext)の両方で同じ関数を使う。

   チャンネル: 楽器が createChannel() を持てばそれを使い、
   リバーブ等の楽器固有エフェクトをトラック内に閉じ込める。
   持たなければ素通し。楽器の noteOn() には channel を渡す。
   ============================================================ */

/** リバーブ用のインパルス応答(ノイズ減衰)を作る */
export function makeImpulse(ctx, seconds, curve) {
  const sr = ctx.sampleRate;
  const buf = ctx.createBuffer(2, Math.floor(sr * seconds), sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, curve);
    }
  }
  return buf;
}

/**
 * バスを構築する。
 * @returns {{ channels: {trackId: channel}, sync(song): void }}
 *   channel は最低限 { input: AudioNode } を持ち、
 *   楽器固有チャンネルは update(params) を持つことがある。
 */
export function createBus(ctx, instruments, song) {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 6;
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(comp);
  comp.connect(ctx.destination);

  const trackGains = {};
  const channels = {};
  for (const inst of instruments) {
    const g = ctx.createGain();
    g.connect(master);
    trackGains[inst.id] = g;
    const params = song.tracks[inst.id].params;
    channels[inst.id] = inst.createChannel
      ? inst.createChannel(ctx, g, params)
      : { input: g };
  }

  return {
    channels,
    sync(songNow) {
      for (const inst of instruments) {
        const tr = songNow.tracks[inst.id];
        trackGains[inst.id].gain.value = tr.mute ? 0 : tr.vol;
        const ch = channels[inst.id];
        if (ch.update) ch.update(tr.params);
      }
    },
  };
}
