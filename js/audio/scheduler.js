/* ============================================================
   再生スケジューラ(トランスポート)
   Web Audio の定石「先読みスケジューリング」:
   setInterval(25ms) で 0.12 秒先までの発音を正確な時刻で予約し、
   画面のプレイヘッドは requestAnimationFrame で追従させる。
   ============================================================ */

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12;

export class Transport {
  /**
   * @param {object} opts
   * @param {() => AudioContext} opts.getCtx    再生用コンテキストを用意して返す
   * @param {() => {bpm:number, steps:number}} opts.getSong
   * @param {(ctx, step:number, time:number, stepDur:number) => void} opts.scheduleStep 発音予約
   * @param {(step:number) => void} opts.onStep プレイヘッド描画(stepは-1で消灯)
   * @param {(playing:boolean) => void} opts.onStateChange
   */
  constructor(opts) {
    this.opts = opts;
    this.isPlaying = false;
    this._step = 0;
    this._nextTime = 0;
    this._timer = null;
    this._queue = [];
    this._drawnStep = -1;
  }

  stepDuration() { return (60 / this.opts.getSong().bpm) / 4; } // 16分音符

  start() {
    const ctx = this.opts.getCtx();
    this.isPlaying = true;
    this._step = 0;
    this._nextTime = ctx.currentTime + 0.06;
    this._queue = [];
    this._drawnStep = -1;
    this._timer = setInterval(() => this._tick(ctx), LOOKAHEAD_MS);
    requestAnimationFrame(() => this._draw(ctx));
    this.opts.onStateChange(true);
  }

  stop() {
    this.isPlaying = false;
    clearInterval(this._timer);
    this._queue = [];
    this._drawnStep = -1;
    this.opts.onStep(-1);
    this.opts.onStateChange(false);
  }

  toggle() { this.isPlaying ? this.stop() : this.start(); }

  _tick(ctx) {
    const song = this.opts.getSong();
    while (this._nextTime < ctx.currentTime + SCHEDULE_AHEAD) {
      this.opts.scheduleStep(ctx, this._step, this._nextTime, this.stepDuration());
      this._queue.push({ step: this._step, time: this._nextTime });
      this._nextTime += this.stepDuration();
      this._step = (this._step + 1) % song.steps;
    }
  }

  _draw(ctx) {
    if (!this.isPlaying) return;
    const now = ctx.currentTime;
    let step = this._drawnStep;
    while (this._queue.length && this._queue[0].time <= now) {
      step = this._queue.shift().step;
    }
    if (step !== this._drawnStep) {
      this.opts.onStep(step);
      this._drawnStep = step;
    }
    requestAnimationFrame(() => this._draw(ctx));
  }
}
