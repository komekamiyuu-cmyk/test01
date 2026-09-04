/* ============================================================
   HUD と画面まわり(DOMの書き換えだけを担当)
   ゲーム本体は「表示のこまかい事情」を知らなくてよいようにする。
   ============================================================ */

import { PLAYER, WEAPONS } from './config.js';

const $ = (id) => document.getElementById(id);

export function createHud() {
  const el = {
    hud: $('hud'), hearts: $('hearts'), dashFill: $('dashFill'),
    round: $('roundLabel'), oniBars: $('oniBars'), score: $('score'),
    weaponIcon: $('weaponIcon'), weaponName: $('weaponName'), weaponAmmo: $('weaponAmmo'),
    weaponList: $('weaponList'), toast: $('toast'), flash: $('damageFlash'),
    title: $('titleScreen'), pause: $('pauseScreen'), result: $('resultScreen'),
    touch: $('touchUI'), crosshair: $('crosshair'),
    resultTitle: $('resultTitle'), resultText: $('resultText'), resultIcon: $('resultIcon'),
    finalScore: $('finalScore'), finalBest: $('finalBest'), best: $('bestScore'),
  };

  let toastTimer = 0, flashTimer = 0;
  let lastHp = -1, lastScore = -1, lastAmmoKey = '';

  const hud = {
    el,

    setHp(hp) {
      if (hp === lastHp) return;
      lastHp = hp;
      let s = '';
      for (let i = 0; i < PLAYER.maxHp; i++) s += `<span class="${i < hp ? '' : 'heart-off'}">❤️</span>`;
      el.hearts.innerHTML = s;
    },

    setDash(ratio) { el.dashFill.style.width = `${Math.round(ratio * 100)}%`; },

    setScore(v) {
      const n = Math.round(v);
      if (n === lastScore) return;
      lastScore = n;
      el.score.textContent = n.toLocaleString('ja-JP');
    },

    setRound(text) { el.round.textContent = text; },

    /** 鬼のHPバーを作り直す(ラウンド開始時) */
    buildOniBars(onis) {
      el.oniBars.innerHTML = onis.map((o, i) =>
        `<div class="oni-row ${o.def.id}" data-i="${i}">
           <span class="nm">${o.def.name}</span>
           <div class="oni-bar"><i style="width:100%"></i></div>
         </div>`).join('');
    },

    updateOniBars(onis) {
      const rows = el.oniBars.children;
      for (let i = 0; i < rows.length && i < onis.length; i++) {
        const o = onis[i];
        const fill = rows[i].querySelector('i');
        fill.style.width = `${Math.max(0, (o.hp / o.maxHp) * 100)}%`;
        rows[i].classList.toggle('dead', o.dead);
      }
    },

    setWeapon(id, ammo) {
      const key = id + ':' + ammo;
      if (key === lastAmmoKey) return;
      lastAmmoKey = key;
      const w = WEAPONS[id];
      el.weaponIcon.textContent = w ? w.icon : '❔';
      el.weaponName.textContent = w ? w.name : '素手';
      el.weaponAmmo.textContent = `×${ammo}`;
      el.weaponAmmo.classList.toggle('empty', ammo <= 0);
    },

    setWeaponList(ammoMap, current) {
      el.weaponList.innerHTML = Object.keys(WEAPONS)
        .filter(id => ammoMap[id] > 0 || id === current)
        .map(id => `<span class="weapon-chip ${id === current ? 'on' : ''}">${WEAPONS[id].icon} ${ammoMap[id]}</span>`)
        .join('');
    },

    toast(text, ms = 1600) {
      el.toast.innerHTML = text;
      el.toast.classList.add('show');
      toastTimer = ms / 1000;
    },

    damageFlash() { el.flash.classList.add('on'); flashTimer = 0.12; },

    update(dt) {
      if (toastTimer > 0) {
        toastTimer -= dt;
        if (toastTimer <= 0) el.toast.classList.remove('show');
      }
      if (flashTimer > 0) {
        flashTimer -= dt;
        if (flashTimer <= 0) el.flash.classList.remove('on');
      }
    },

    /** name: title / pause / result / game */
    showScreen(name, isTouch) {
      el.title.classList.toggle('hidden', name !== 'title');
      el.pause.classList.toggle('hidden', name !== 'pause');
      el.result.classList.toggle('hidden', name !== 'result');
      el.hud.classList.toggle('hidden', name !== 'game');
      el.touch.classList.toggle('hidden', !(isTouch && name === 'game'));
      el.crosshair.classList.toggle('hidden', !!isTouch);
    },

    showResult(win, score, best, detail) {
      el.resultIcon.textContent = win ? '🎉' : '💀';
      el.resultTitle.textContent = win ? '逃げきった!' : 'つかまってしまった…';
      el.resultText.innerHTML = detail;
      el.finalScore.textContent = Math.round(score).toLocaleString('ja-JP');
      el.finalBest.textContent = Math.round(best).toLocaleString('ja-JP');
    },

    setBest(v) { el.best.textContent = Math.round(v).toLocaleString('ja-JP'); },
  };

  return hud;
}
