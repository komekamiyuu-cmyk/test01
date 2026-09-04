/* ============================================================
   ジオメトリ生成
   キャラも背景も、この基本形(箱・球・円柱・円錐・板・星)の
   組み合わせだけで作る。頂点ごとに色を持たせられる。
   ============================================================ */

import { mat4, normalMatrix } from './math.js';

/** 空のジオメトリ(位置・法線・色・インデックス) */
function emptyGeo() {
  return { positions: [], normals: [], colors: [], indices: [] };
}

function pushVert(g, px, py, pz, nx, ny, nz) {
  g.positions.push(px, py, pz);
  g.normals.push(nx, ny, nz);
  g.colors.push(1, 1, 1);
}

/** 配列を型付き配列に固める(GPUに渡せる形)。頂点が多いときは32bitインデックス */
export function finish(g) {
  const vertCount = g.positions.length / 3;
  const Idx = vertCount > 65535 ? Uint32Array : Uint16Array;
  return {
    positions: new Float32Array(g.positions),
    normals: new Float32Array(g.normals),
    colors: new Float32Array(g.colors),
    indices: new Idx(g.indices),
  };
}

/* ---------------- 基本形 ---------------- */

/** 直方体。中心は原点(bottom:true なら底面が y=0) */
export function box(w = 1, h = 1, d = 1, bottom = false) {
  const g = emptyGeo();
  const x = w / 2, z = d / 2;
  const y0 = bottom ? 0 : -h / 2, y1 = bottom ? h : h / 2;
  const faces = [
    // [法線, 4頂点(反時計回り)]
    [[0, 0, 1],  [[-x, y0, z], [x, y0, z], [x, y1, z], [-x, y1, z]]],
    [[0, 0, -1], [[x, y0, -z], [-x, y0, -z], [-x, y1, -z], [x, y1, -z]]],
    [[1, 0, 0],  [[x, y0, z], [x, y0, -z], [x, y1, -z], [x, y1, z]]],
    [[-1, 0, 0], [[-x, y0, -z], [-x, y0, z], [-x, y1, z], [-x, y1, -z]]],
    [[0, 1, 0],  [[-x, y1, z], [x, y1, z], [x, y1, -z], [-x, y1, -z]]],
    [[0, -1, 0], [[-x, y0, -z], [x, y0, -z], [x, y0, z], [-x, y0, z]]],
  ];
  for (const [n, quad] of faces) {
    const base = g.positions.length / 3;
    for (const p of quad) pushVert(g, p[0], p[1], p[2], n[0], n[1], n[2]);
    g.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return finish(g);
}

/** 球(半径r)。segは横の分割、ringsは縦の分割 */
export function sphere(r = 1, seg = 16, rings = 12) {
  const g = emptyGeo();
  for (let iy = 0; iy <= rings; iy++) {
    const v = iy / rings, phi = v * Math.PI;
    for (let ix = 0; ix <= seg; ix++) {
      const u = ix / seg, theta = u * Math.PI * 2;
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.cos(phi);
      const nz = -Math.sin(phi) * Math.sin(theta);
      pushVert(g, nx * r, ny * r, nz * r, nx, ny, nz);
    }
  }
  for (let iy = 0; iy < rings; iy++) {
    for (let ix = 0; ix < seg; ix++) {
      const a = iy * (seg + 1) + ix, b = a + seg + 1;
      g.indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return finish(g);
}

/** 円柱/円錐。rTop=0 なら円錐。中心は原点(bottom:true なら底面が y=0) */
export function cylinder(rTop = 1, rBottom = 1, h = 1, seg = 14, bottom = false) {
  const g = emptyGeo();
  const y1 = bottom ? h : h / 2, y0 = bottom ? 0 : -h / 2;
  const slope = (rBottom - rTop) / h;

  for (let i = 0; i <= seg; i++) {
    const t = (i / seg) * Math.PI * 2;
    const cx = Math.cos(t), cz = -Math.sin(t);
    const nl = Math.hypot(1, slope) || 1;
    const nx = cx / nl, nz = cz / nl, ny = slope / nl;
    pushVert(g, cx * rTop, y1, cz * rTop, nx, ny, nz);
    pushVert(g, cx * rBottom, y0, cz * rBottom, nx, ny, nz);
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2;
    g.indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
  }
  // ふた(上下)
  for (const [rr, yy, ny] of [[rTop, y1, 1], [rBottom, y0, -1]]) {
    if (rr <= 0.0001) continue;
    const center = g.positions.length / 3;
    pushVert(g, 0, yy, 0, 0, ny, 0);
    for (let i = 0; i <= seg; i++) {
      const t = (i / seg) * Math.PI * 2;
      pushVert(g, Math.cos(t) * rr, yy, -Math.sin(t) * rr, 0, ny, 0);
    }
    for (let i = 0; i < seg; i++) {
      if (ny > 0) g.indices.push(center, center + 1 + i, center + 2 + i);
      else g.indices.push(center, center + 2 + i, center + 1 + i);
    }
  }
  return finish(g);
}

export const cone = (r = 1, h = 1, seg = 14, bottom = false) => cylinder(0, r, h, seg, bottom);

/** XZ平面の板(上向き)。地面や影に使う */
export function plane(w = 1, d = 1) {
  const x = w / 2, z = d / 2;
  return {
    positions: new Float32Array([-x, 0, z, x, 0, z, x, 0, -z, -x, 0, -z]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
    colors: new Float32Array(12).fill(1),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  };
}

/** XZ平面の円盤(上向き)。丸い影に使う */
export function disc(r = 1, seg = 18) {
  const g = emptyGeo();
  pushVert(g, 0, 0, 0, 0, 1, 0);
  for (let i = 0; i <= seg; i++) {
    const t = (i / seg) * Math.PI * 2;
    pushVert(g, Math.cos(t) * r, 0, -Math.sin(t) * r, 0, 1, 0);
  }
  for (let i = 0; i < seg; i++) g.indices.push(0, 1 + i, 2 + i);
  return finish(g);
}

/** 手裏剣用の星形(厚みつき)。XY平面に立てた板を回して使う */
export function star(points = 4, outer = 1, inner = 0.34, thick = 0.12) {
  const g = emptyGeo();
  const n = points * 2;
  const ring = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    ring.push([Math.cos(t) * r, Math.sin(t) * r]);
  }
  const hz = thick / 2;
  // 表と裏
  for (const [z, nz] of [[hz, 1], [-hz, -1]]) {
    const center = g.positions.length / 3;
    pushVert(g, 0, 0, z, 0, 0, nz);
    for (const [x, y] of ring) pushVert(g, x, y, z, 0, 0, nz);
    for (let i = 0; i < n; i++) {
      const a = center + 1 + i, b = center + 1 + ((i + 1) % n);
      if (nz > 0) g.indices.push(center, a, b);
      else g.indices.push(center, b, a);
    }
  }
  // 側面
  for (let i = 0; i < n; i++) {
    const [x0, y0] = ring[i], [x1, y1] = ring[(i + 1) % n];
    let nx = y1 - y0, ny = -(x1 - x0);
    const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
    const base = g.positions.length / 3;
    pushVert(g, x0, y0, hz, nx, ny, 0);
    pushVert(g, x1, y1, hz, nx, ny, 0);
    pushVert(g, x1, y1, -hz, nx, ny, 0);
    pushVert(g, x0, y0, -hz, nx, ny, 0);
    g.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  return finish(g);
}

/* ---------------- 色づけ・合成 ---------------- */

/** ジオメトリ全体を1色に塗る(頂点カラー) */
export function paint(geo, rgb) {
  const c = geo.colors;
  for (let i = 0; i < c.length; i += 3) { c[i] = rgb[0]; c[i + 1] = rgb[1]; c[i + 2] = rgb[2]; }
  return geo;
}

/** 高さで色を変えるグラデーション(地面や空に使う) */
export function paintByHeight(geo, lowColor, highColor, y0, y1) {
  const p = geo.positions, c = geo.colors;
  for (let i = 0; i < c.length; i += 3) {
    const t = Math.max(0, Math.min(1, (p[i + 1] - y0) / (y1 - y0 || 1)));
    for (let k = 0; k < 3; k++) c[i + k] = lowColor[k] + (highColor[k] - lowColor[k]) * t;
  }
  return geo;
}

const _nm = new Float32Array(9);

/**
 * 複数のジオメトリを1つに合成する(描画回数を減らすため)。
 * parts: [{ geo, matrix, color }]
 */
export function merge(parts) {
  const g = emptyGeo();
  for (const part of parts) {
    const { geo, matrix, color } = part;
    const m = matrix || mat4();
    normalMatrix(_nm, m);
    const base = g.positions.length / 3;
    const p = geo.positions, nrm = geo.normals, col = geo.colors;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      g.positions.push(
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14]
      );
      const nx = nrm[i], ny = nrm[i + 1], nz = nrm[i + 2];
      let tx = _nm[0] * nx + _nm[3] * ny + _nm[6] * nz;
      let ty = _nm[1] * nx + _nm[4] * ny + _nm[7] * nz;
      let tz = _nm[2] * nx + _nm[5] * ny + _nm[8] * nz;
      const l = Math.hypot(tx, ty, tz) || 1;
      g.normals.push(tx / l, ty / l, tz / l);
      if (color) g.colors.push(color[0], color[1], color[2]);
      else g.colors.push(col[i], col[i + 1], col[i + 2]);
    }
    for (const idx of geo.indices) g.indices.push(base + idx);
  }
  return finish(g);
}
