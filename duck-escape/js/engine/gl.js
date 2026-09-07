/* ============================================================
   ちいさな3Dレンダラ(素のWebGL)
   ・シェーダは1本だけ(頂点カラー + 平行光源 + リムライト + フォグ)
   ・描画リストを受け取り、不透明→半透明の順に描く
   外部ライブラリを使わないので、オフラインでもそのまま動く。
   ============================================================ */

import { normalMatrix } from './math.js';

const VERT = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec3 aColor;

uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uModel;
uniform mat3 uNormalMat;

varying vec3 vNormal;
varying vec3 vColor;
varying vec3 vWorld;

void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorld  = world.xyz;
  vNormal = uNormalMat * aNormal;
  vColor  = aColor;
  gl_Position = uProj * uView * world;
}`;

const FRAG = `
precision mediump float;

uniform vec3  uTint;      // 個体ごとの色
uniform float uEmissive;  // 1.0 に近いほど「自分で光る」(弾・炎など)
uniform float uOpacity;
uniform vec3  uLightDir;
uniform vec3  uLightColor;
uniform vec3  uAmbient;
uniform vec3  uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3  uCamPos;

varying vec3 vNormal;
varying vec3 vColor;
varying vec3 vWorld;

void main() {
  vec3 base = vColor * uTint;
  vec3 n = normalize(vNormal);

  // やわらかい陰影(半ランバート)。トゥーン寄りの見た目にする
  float d = dot(n, uLightDir) * 0.5 + 0.5;
  d = smoothstep(0.15, 0.95, d) * 0.85 + 0.15;
  vec3 lit = base * (uAmbient + uLightColor * d);

  // 輪郭をうっすら光らせて立体感を出す
  vec3 viewDir = normalize(uCamPos - vWorld);
  float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0) * 0.4;
  lit += vec3(0.42, 0.55, 0.95) * rim;

  lit = mix(lit, base * 1.15, uEmissive);

  float dist = length(uCamPos - vWorld);
  float fog = clamp((dist - uFogNear) / max(uFogFar - uFogNear, 0.001), 0.0, 1.0);
  fog *= (1.0 - uEmissive * 0.7);

  gl_FragColor = vec4(mix(lit, uFogColor, fog), uOpacity);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('シェーダのコンパイルに失敗: ' + gl.getShaderInfoLog(sh));
  }
  return sh;
}

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl', { antialias: true, alpha: false, powerPreference: 'high-performance' })
          || canvas.getContext('experimental-webgl');
  if (!gl) throw new Error('WebGLが使えません');

  const uint32 = !!gl.getExtension('OES_element_index_uint');

  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error('シェーダのリンクに失敗: ' + gl.getProgramInfoLog(prog));
  }
  gl.useProgram(prog);

  const A = {
    position: gl.getAttribLocation(prog, 'aPosition'),
    normal:   gl.getAttribLocation(prog, 'aNormal'),
    color:    gl.getAttribLocation(prog, 'aColor'),
  };
  const U = {};
  for (const name of ['uProj', 'uView', 'uModel', 'uNormalMat', 'uTint', 'uEmissive', 'uOpacity',
                      'uLightDir', 'uLightColor', 'uAmbient', 'uFogColor', 'uFogNear', 'uFogFar', 'uCamPos']) {
    U[name] = gl.getUniformLocation(prog, name);
  }

  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const normalMat = new Float32Array(9);

  const light = {
    dir: [-0.42, 0.82, 0.38],       // 月あかりの向き
    color: [0.95, 0.94, 1.0],
    ambient: [0.34, 0.36, 0.5],
  };
  const fog = { color: [0.055, 0.07, 0.16], near: 34, far: 88 };

  /** ジオメトリをGPUに送って、描ける形(mesh)にする */
  function upload(geo) {
    const mk = (data, target) => {
      const b = gl.createBuffer();
      gl.bindBuffer(target, b);
      gl.bufferData(target, data, gl.STATIC_DRAW);
      return b;
    };
    let indices = geo.indices;
    if (indices instanceof Uint32Array && !uint32) indices = new Uint16Array(indices); // 古い端末向けの保険
    return {
      pos: mk(geo.positions, gl.ARRAY_BUFFER),
      nrm: mk(geo.normals, gl.ARRAY_BUFFER),
      col: mk(geo.colors, gl.ARRAY_BUFFER),
      idx: mk(indices, gl.ELEMENT_ARRAY_BUFFER),
      count: indices.length,
      type: indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
    };
  }

  // 描画解像度の倍率。重い端末では main.js が下げる(1.0 = そのまま)
  let quality = 1;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * quality;
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return canvas.clientWidth / Math.max(canvas.clientHeight, 1);
  }

  let lastMesh = null;
  function bindMesh(mesh) {
    if (lastMesh === mesh) return;
    lastMesh = mesh;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.pos);
    gl.vertexAttribPointer(A.position, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.nrm);
    gl.vertexAttribPointer(A.normal, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.col);
    gl.vertexAttribPointer(A.color, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.idx);
  }

  /**
   * 1フレーム描画する。
   * camera: { proj, view, pos }
   * list:   [{ mesh, matrix, color, emissive, opacity, transparent, depthWrite }]
   */
  function render(camera, list) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(fog.color[0], fog.color[1], fog.color[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(prog);
    gl.enableVertexAttribArray(A.position);
    gl.enableVertexAttribArray(A.normal);
    gl.enableVertexAttribArray(A.color);
    lastMesh = null;

    gl.uniformMatrix4fv(U.uProj, false, camera.proj);
    gl.uniformMatrix4fv(U.uView, false, camera.view);
    gl.uniform3fv(U.uLightDir, light.dir);
    gl.uniform3fv(U.uLightColor, light.color);
    gl.uniform3fv(U.uAmbient, light.ambient);
    gl.uniform3fv(U.uFogColor, fog.color);
    gl.uniform1f(U.uFogNear, fog.near);
    gl.uniform1f(U.uFogFar, fog.far);
    gl.uniform3f(U.uCamPos, camera.pos.x, camera.pos.y, camera.pos.z);

    // 半透明は後ろから描く(奥→手前)
    const opaque = [], alpha = [];
    for (const it of list) (it.transparent ? alpha : opaque).push(it);
    for (const it of alpha) {
      const dx = it.matrix[12] - camera.pos.x, dy = it.matrix[13] - camera.pos.y, dz = it.matrix[14] - camera.pos.z;
      it._d = dx * dx + dy * dy + dz * dz;
    }
    alpha.sort((a, b) => b._d - a._d);

    gl.disable(gl.BLEND);
    gl.depthMask(true);
    for (const it of opaque) drawItem(it);

    gl.enable(gl.BLEND);
    for (const it of alpha) {
      gl.depthMask(it.depthWrite !== false);
      drawItem(it);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  function drawItem(it) {
    bindMesh(it.mesh);
    normalMatrix(normalMat, it.matrix);
    gl.uniformMatrix4fv(U.uModel, false, it.matrix);
    gl.uniformMatrix3fv(U.uNormalMat, false, normalMat);
    const c = it.color || WHITE;
    gl.uniform3f(U.uTint, c[0], c[1], c[2]);
    gl.uniform1f(U.uEmissive, it.emissive || 0);
    gl.uniform1f(U.uOpacity, it.opacity == null ? 1 : it.opacity);
    gl.drawElements(gl.TRIANGLES, it.mesh.count, it.mesh.type, 0);
  }

  const WHITE = [1, 1, 1];

  return {
    gl, upload, resize, render, light, fog,
    getQuality: () => quality,
    setQuality(q) { quality = Math.max(0.5, Math.min(1, q)); },
  };
}
