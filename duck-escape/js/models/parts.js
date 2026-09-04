/* ============================================================
   モデル作りの小道具
   ・色を覚えておいて「点滅(被弾)」させる仕組み
   ・頭の上のHPバー
   ============================================================ */

import { node, add } from '../engine/scene.js';

/** 色を記録しつつノードを作る(あとで点滅させるため) */
export function skinNode(bag, opts) {
  const n = node(opts);
  n._base = [n.color[0], n.color[1], n.color[2]];
  n.color = [n.color[0], n.color[1], n.color[2]];
  bag.push(n);
  return n;
}

/** amount=0で元の色、1で真っ白(ダメージ表現) */
export function setFlash(bag, amount, tint = [1, 1, 1]) {
  const a = Math.max(0, Math.min(1, amount));
  for (const n of bag) {
    for (let i = 0; i < 3; i++) n.color[i] = n._base[i] + (tint[i] - n._base[i]) * a;
    n.emissive = a * 0.85;
  }
}

/** 頭上に浮かぶHPバー(板2枚)。カメラの方を向かせて使う */
export function healthBar(M, width = 1.6) {
  const root = node({});
  // 板(XZ平面)を立てて、カメラの方を向く「看板」にする
  const back = add(root, node({ mesh: M.plane, color: [0.05, 0.05, 0.09], sx: width, sz: 0.24, rx: Math.PI / 2, emissive: 0.9 }));
  const fill = add(root, node({ mesh: M.plane, color: [1, 0.35, 0.3], sx: width - 0.1, sz: 0.15, rx: Math.PI / 2, z: 0.012, emissive: 1 }));
  return {
    root, back, fill,
    set(ratio, color) {
      const w = Math.max(0, ratio) * (width - 0.1);
      fill.scale.x = w;
      fill.pos.x = -(width - 0.1) / 2 + w / 2;
      if (color) fill.color = color;
    },
  };
}
