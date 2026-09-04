/* ============================================================
   共有メッシュ(基本形)をGPUに1度だけ送っておく置き場
   キャラや背景はこれを拡大・回転して組み立てる。
   ============================================================ */

import * as G from '../engine/geometry.js';

export function createMeshes(renderer) {
  const up = (geo) => renderer.upload(geo);
  return {
    box:     up(G.box(1, 1, 1)),
    boxB:    up(G.box(1, 1, 1, true)),          // 底が原点の箱
    sphere:  up(G.sphere(1, 18, 13)),
    sphereLo:up(G.sphere(1, 10, 7)),
    cyl:     up(G.cylinder(1, 1, 1, 16)),
    cylB:    up(G.cylinder(1, 1, 1, 16, true)),
    cone:    up(G.cone(1, 1, 16)),
    coneB:   up(G.cone(1, 1, 16, true)),
    disc:    up(G.disc(1, 22)),
    plane:   up(G.plane(1, 1)),
    star:    up(G.star(4, 1, 0.3, 0.12)),
    upload:  up,
    geo: G,
  };
}
