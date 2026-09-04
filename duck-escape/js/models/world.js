/* ============================================================
   ステージ(夜の里)
   地面・塀・岩・木・灯籠・脱出用の鳥居を作る。
   当たり判定用の「障害物リスト」もここで一緒に返す。
   ============================================================ */

import { node, add } from '../engine/scene.js';
import { mat4, compose } from '../engine/math.js';
import { ARENA, PALETTE } from '../config.js';

/** 毎回だいたい同じ地形になるように、種から乱数を作る */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const trs = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
  const m = mat4();
  compose(m, { x, y, z }, { x: rx, y: ry, z: rz }, { x: sx, y: sy, z: sz });
  return m;
};

/** 草地のタイル。マスごとに少し色を変えて、のっぺり感をなくす */
function groundGeo(G, half, div) {
  const g = { positions: [], normals: [], colors: [], indices: [] };
  const step = (half * 2) / div;
  const base = PALETTE.ground, dark = PALETTE.groundDark, path = PALETTE.path;
  for (let i = 0; i < div; i++) {
    for (let j = 0; j < div; j++) {
      const x0 = -half + i * step, z0 = -half + j * step;
      const x1 = x0 + step, z1 = z0 + step;
      const cx = x0 + step / 2, cz = z0 + step / 2;
      const d = Math.hypot(cx, cz);
      const n = (Math.sin(cx * 0.7) + Math.cos(cz * 0.9) + Math.sin((cx + cz) * 0.31)) / 3;
      let col;
      if (d < 7.5) {
        // 中央は踏み固められた土
        const t = Math.max(0, Math.min(1, (7.5 - d) / 3));
        col = [base[0] + (path[0] - base[0]) * t, base[1] + (path[1] - base[1]) * t, base[2] + (path[2] - base[2]) * t];
      } else {
        const t = 0.5 + n * 0.32;
        col = [dark[0] + (base[0] - dark[0]) * t, dark[1] + (base[1] - dark[1]) * t, dark[2] + (base[2] - dark[2]) * t];
      }
      const b = g.positions.length / 3;
      for (const [px, pz] of [[x0, z1], [x1, z1], [x1, z0], [x0, z0]]) {
        g.positions.push(px, 0, pz);
        g.normals.push(0, 1, 0);
        g.colors.push(col[0], col[1], col[2]);
      }
      g.indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  }
  return G.finish(g);
}

/**
 * ステージを作る。
 * 返り値: { root, obstacles, gate, lanterns }
 */
export function createWorld(M, seed = 7) {
  const G = M.geo;
  const rng = makeRng(seed);
  const root = node({});
  const half = ARENA.half;
  const obstacles = [];

  // ---- 地面 ----
  add(root, node({ mesh: M.upload(groundGeo(G, half + 4, 44)), color: [1, 1, 1] }));

  // ---- 塀(4辺)と柱をまとめて1メッシュに ----
  const wallParts = [];
  const wallBox = G.box(1, 1, 1, true);
  const H = ARENA.wallH;
  for (const [dx, dz, ry] of [[0, -1, 0], [0, 1, 0], [-1, 0, Math.PI / 2], [1, 0, Math.PI / 2]]) {
    wallParts.push({ geo: wallBox, color: PALETTE.wall,
      matrix: trs(dx * half, 0, dz * half, 0, ry, 0, half * 2 + 1.2, H, 0.7) });
    wallParts.push({ geo: wallBox, color: [0.2, 0.16, 0.13],
      matrix: trs(dx * (half - 0.02), H, dz * (half - 0.02), 0, ry, 0, half * 2 + 1.6, 0.28, 1.3) });
  }
  const post = G.box(1, 1, 1, true);
  for (let i = -half; i <= half; i += 5) {
    for (const [x, z] of [[i, -half], [i, half], [-half, i], [half, i]]) {
      wallParts.push({ geo: post, color: PALETTE.wood, matrix: trs(x, 0, z, 0, 0, 0, 0.5, H + 0.5, 0.5) });
    }
  }
  add(root, node({ mesh: M.upload(G.merge(wallParts)) }));

  // ---- 岩・木・木箱(隠れる場所) ----
  const rockGeo = G.sphere(1, 9, 6);
  const trunkGeo = G.cylinder(0.75, 1, 1, 8, true);
  const leafGeo = G.cone(1, 1, 8, true);
  const crateGeo = G.box(1, 1, 1, true);
  const props = [];

  const place = (minR, maxR, count, fn) => {
    let tries = 0;
    for (let i = 0; i < count && tries < count * 40; tries++) {
      const a = rng() * Math.PI * 2;
      const d = minR + rng() * (maxR - minR);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (Math.abs(x) > half - 3 || Math.abs(z) > half - 3) continue;
      if (Math.hypot(x, z) < 6) continue;                       // 中央のスタート地点は空けておく
      if (obstacles.some(o => Math.hypot(o.x - x, o.z - z) < o.r + 3.2)) continue;
      fn(x, z, rng);
      i++;
    }
  };

  place(8, half - 5, 9, (x, z) => {                              // 岩
    const s = 1.1 + rng() * 0.9;
    obstacles.push({ x, z, r: s * 0.95 });
    props.push({ geo: rockGeo, color: PALETTE.rock, matrix: trs(x, s * 0.15, z, rng() * 0.3, rng() * 3, rng() * 0.3, s * 1.15, s * 0.85, s) });
    props.push({ geo: rockGeo, color: [0.28, 0.3, 0.36], matrix: trs(x + s * 0.6, s * 0.1, z - s * 0.4, 0, rng() * 3, 0, s * 0.5, s * 0.4, s * 0.5) });
  });

  place(9, half - 4, 10, (x, z) => {                             // 木
    const h = 3.4 + rng() * 2.2;
    obstacles.push({ x, z, r: 0.85 });
    props.push({ geo: trunkGeo, color: PALETTE.wood, matrix: trs(x, 0, z, 0, 0, 0, 0.42, h, 0.42) });
    for (let k = 0; k < 3; k++) {
      const s = 2.5 - k * 0.5;
      props.push({ geo: leafGeo, color: k === 0 ? PALETTE.leaf : [0.11, 0.3, 0.21],
        matrix: trs(x, h * 0.55 + k * 1.0, z, 0, rng() * 3, 0, s, 2.1, s) });
    }
  });

  place(10, half - 6, 7, (x, z) => {                             // 木箱
    const s = 1.2 + rng() * 0.5;
    obstacles.push({ x, z, r: s * 0.8 });
    props.push({ geo: crateGeo, color: [0.46, 0.32, 0.19], matrix: trs(x, 0, z, 0, rng() * 3, 0, s * 1.6, s * 1.5, s * 1.6) });
    props.push({ geo: crateGeo, color: [0.3, 0.2, 0.12], matrix: trs(x, s * 1.5, z, 0, rng() * 3, 0, s * 1.7, 0.16, s * 1.7) });
  });
  add(root, node({ mesh: M.upload(G.merge(props)) }));

  // ---- 灯籠(ぼんやり光って夜の雰囲気を出す) ----
  const lanterns = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.3;
    const d = half - 6;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const l = add(root, node({ x, z }));
    add(l, node({ mesh: M.boxB, color: [0.4, 0.4, 0.45], sx: 0.5, sy: 1.1, sz: 0.5 }));
    add(l, node({ mesh: M.boxB, color: [1, 0.76, 0.42], sx: 0.72, sy: 0.7, sz: 0.72, y: 1.1, emissive: 0.95 }));
    add(l, node({ mesh: M.boxB, color: [0.35, 0.35, 0.4], sx: 1.0, sy: 0.22, sz: 1.0, y: 1.8 }));
    add(l, node({ mesh: M.disc, color: [1, 0.7, 0.35], scale: 2.6, y: 0.05, transparent: true, opacity: 0.14, depthWrite: false, emissive: 1 }));
    obstacles.push({ x, z, r: 0.55 });
    lanterns.push(l);
  }

  // ---- 月 ----
  add(root, node({ mesh: M.sphere, color: [1, 0.97, 0.86], scale: 7, x: -34, y: 40, z: -70, emissive: 1 }));

  // ---- 脱出ゲート(鳥居) ----
  const gate = node({ x: 0, z: -(half - 3.5) });
  const T = PALETTE.torii;
  for (const s of [-1, 1]) {
    add(gate, node({ mesh: M.cylB, color: T, sx: 0.42, sz: 0.42, sy: 5.4, x: 2.6 * s }));
  }
  add(gate, node({ mesh: M.box, color: T, sx: 8.2, sy: 0.55, sz: 0.8, y: 5.6, rz: 0.02 }));
  add(gate, node({ mesh: M.box, color: [0.12, 0.1, 0.12], sx: 9.0, sy: 0.4, sz: 1.0, y: 6.1 }));
  add(gate, node({ mesh: M.box, color: T, sx: 1.0, sy: 0.8, sz: 0.6, y: 4.6 }));
  const gateGlow = add(gate, node({ mesh: M.disc, color: [1, 0.85, 0.4], scale: 3.4, y: 0.06,
    transparent: true, opacity: 0.0, depthWrite: false, emissive: 1 }));
  const gateLight = add(gate, node({ mesh: M.box, color: [1, 0.9, 0.5], sx: 5.2, sy: 5.4, sz: 0.1, y: 2.7,
    transparent: true, opacity: 0.0, depthWrite: false, emissive: 1 }));
  add(root, gate);
  obstacles.push({ x: gate.pos.x - 2.6, z: gate.pos.z, r: 0.5 });
  obstacles.push({ x: gate.pos.x + 2.6, z: gate.pos.z, r: 0.5 });

  return {
    root, obstacles, lanterns,
    gate: {
      node: gate, x: gate.pos.x, z: gate.pos.z, open: false,
      setOpen(v) { this.open = v; },
      update(t) {
        const p = this.open ? 0.35 + Math.sin(t * 3) * 0.12 : 0;
        gateGlow.opacity = p;
        gateLight.opacity = this.open ? 0.22 + Math.sin(t * 3) * 0.08 : 0;
      },
    },
  };
}
