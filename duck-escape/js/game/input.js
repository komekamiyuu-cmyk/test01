/* ============================================================
   入力(キーボード / マウス / タッチ)
   ゲーム側は「move・look・fire…」だけを見ればよいようにする。
   ============================================================ */

export function createInput(canvas, ui) {
  const keys = new Set();
  const state = {
    move: { x: 0, y: 0 },        // x:右 y:前
    look: { dx: 0, dy: 0 },      // 視点移動(1フレーム分。読むとゼロに戻す)
    fire: false,
    dashEdge: false,
    swapEdge: false,
    pauseEdge: false,
    isTouch: matchMedia('(hover: none)').matches || 'ontouchstart' in window,
    pointerLocked: false,
    enabled: false,
  };

  /* ---------------- キーボード ---------------- */
  const KEYMAP = {
    KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
    KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  };

  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'Space') { state.fire = true; e.preventDefault(); }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') state.dashEdge = true;
    if (e.code === 'KeyQ' || e.code === 'KeyE' || e.code === 'Tab') { state.swapEdge = true; e.preventDefault(); }
    if (e.code === 'Digit1') state.pickWeapon = 0;
    if (e.code === 'Digit2') state.pickWeapon = 1;
    if (e.code === 'Digit3') state.pickWeapon = 2;
    if (e.code === 'KeyP' || e.code === 'Escape') state.pauseEdge = true;
  });
  addEventListener('keyup', (e) => {
    keys.delete(e.code);
    if (e.code === 'Space') state.fire = false;
  });
  addEventListener('blur', () => { keys.clear(); state.fire = false; });

  /* ---------------- マウス(視点と射撃) ---------------- */
  let mouseHeld = false;

  canvas.addEventListener('mousedown', (e) => {
    if (!state.enabled) return;
    if (e.button === 0) { state.fire = true; mouseHeld = true; }
    if (!state.isTouch && !state.pointerLocked && canvas.requestPointerLock) {
      const r = canvas.requestPointerLock();
      if (r && typeof r.catch === 'function') r.catch(() => {});
    }
  });
  addEventListener('mouseup', (e) => { if (e.button === 0) { state.fire = false; mouseHeld = false; } });

  addEventListener('mousemove', (e) => {
    if (state.pointerLocked) {
      state.look.dx += e.movementX || 0;
      state.look.dy += e.movementY || 0;
    } else if (mouseHeld) {
      state.look.dx += e.movementX || 0;
      state.look.dy += e.movementY || 0;
    }
  });

  document.addEventListener('pointerlockchange', () => {
    state.pointerLocked = document.pointerLockElement === canvas;
  });

  /* ---------------- タッチ ---------------- */
  const stick = ui.stick, knob = ui.knob;
  let stickId = null, stickBase = { x: 0, y: 0 };
  let lookId = null, lookPrev = { x: 0, y: 0 };

  if (stick) {
    stick.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      stickId = t.identifier;
      const r = stick.getBoundingClientRect();
      stickBase = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      e.preventDefault();
    }, { passive: false });
  }

  function moveStick(t) {
    const dx = t.clientX - stickBase.x, dy = t.clientY - stickBase.y;
    const max = 52;
    const d = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, d / max);
    state.move.x = (dx / d) * k;
    state.move.y = -(dy / d) * k;
    if (knob) knob.style.transform = `translate(${(dx / d) * k * max}px, ${(dy / d) * k * max}px)`;
  }

  function resetStick() {
    stickId = null;
    state.move.x = state.move.y = 0;
    if (knob) knob.style.transform = '';
  }

  addEventListener('touchstart', (e) => {
    if (!state.enabled) return;
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) continue;
      if (lookId === null && t.clientX > innerWidth * 0.35 && t.target === canvas) {
        lookId = t.identifier;
        lookPrev = { x: t.clientX, y: t.clientY };
      }
    }
  }, { passive: true });

  addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) { moveStick(t); e.preventDefault(); }
      else if (t.identifier === lookId) {
        state.look.dx += (t.clientX - lookPrev.x) * 2.2;
        state.look.dy += (t.clientY - lookPrev.y) * 2.2;
        lookPrev = { x: t.clientX, y: t.clientY };
      }
    }
  }, { passive: false });

  const endTouch = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) resetStick();
      if (t.identifier === lookId) lookId = null;
    }
  };
  addEventListener('touchend', endTouch);
  addEventListener('touchcancel', endTouch);

  /* ---------------- 画面上のボタン ---------------- */
  const hold = (el, on, off) => {
    if (!el) return;
    el.addEventListener('touchstart', (e) => { on(); e.preventDefault(); }, { passive: false });
    el.addEventListener('touchend', (e) => { off && off(); e.preventDefault(); }, { passive: false });
    el.addEventListener('mousedown', (e) => { on(); e.preventDefault(); });
    el.addEventListener('mouseup', () => off && off());
    el.addEventListener('mouseleave', () => off && off());
  };
  hold(ui.fire, () => { state.fire = true; }, () => { state.fire = false; });
  hold(ui.dash, () => { state.dashEdge = true; });
  hold(ui.swap, () => { state.swapEdge = true; });

  /* ---------------- 毎フレーム呼ぶ ---------------- */
  return {
    state,
    /** キーボードぶんの移動量を反映し、押しっぱなし系を確定する */
    sample() {
      if (!state.isTouch || keys.size) {
        let x = 0, y = 0;
        for (const code of keys) {
          const k = KEYMAP[code];
          if (k === 'up') y += 1;
          else if (k === 'down') y -= 1;
          else if (k === 'left') x -= 1;
          else if (k === 'right') x += 1;
        }
        if (x || y) {
          const l = Math.hypot(x, y);
          state.move.x = x / l; state.move.y = y / l;
        } else if (stickId === null) {
          state.move.x = 0; state.move.y = 0;
        }
      }
      return state;
    },
    /** 読み取ったら消える系(視点移動・1回押し) */
    consumeLook() {
      const l = { dx: state.look.dx, dy: state.look.dy };
      state.look.dx = state.look.dy = 0;
      return l;
    },
    consumeEdges() {
      const e = { dash: state.dashEdge, swap: state.swapEdge, pause: state.pauseEdge, pick: state.pickWeapon };
      state.dashEdge = state.swapEdge = state.pauseEdge = false;
      state.pickWeapon = undefined;
      return e;
    },
    setEnabled(v) {
      state.enabled = v;
      if (!v) {
        state.fire = false;
        resetStick();
        if (document.pointerLockElement) document.exitPointerLock();
      }
    },
  };
}
