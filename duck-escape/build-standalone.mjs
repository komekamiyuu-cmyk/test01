/* ============================================================
   1ファイル版(standalone.html)を作るスクリプト
       node build-standalone.mjs
   HTML・CSS・JSモジュールを1つのHTMLにまとめる。
   できたファイルはダブルクリックするだけで遊べる(サーバー不要)。
   ============================================================ */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';

// 読み込む順番(依存されている側が先)
const MODULES = [
  'engine/math.js',
  'engine/geometry.js',
  'engine/gl.js',
  'engine/scene.js',
  'config.js',
  'models/meshes.js',
  'models/parts.js',
  'models/items.js',
  'models/duck.js',
  'models/oni.js',
  'models/world.js',
  'hud.js',
  'game/audio.js',
  'game/input.js',
  'game/effects.js',
  'game/projectiles.js',
  'game/pickups.js',
  'game/player.js',
  'game/enemy.js',
  'main.js',
];

/** './x.js' や '../engine/y.js' を、js/ からの相対パスに直す */
function resolveKey(fromKey, spec) {
  return posix.normalize(posix.join(posix.dirname(fromKey), spec));
}

/** 1モジュールを「即時関数 + exports を返す」形に書き換える */
function transform(key, src) {
  const exported = [];
  const lines = src.split('\n');
  const out = [];

  for (const line of lines) {
    let m;
    // import { a, b as c } from '...';
    if ((m = line.match(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)';?\s*$/))) {
      const names = m[1].split(',').map((s) => s.trim()).filter(Boolean)
        .map((s) => {
          const as = s.split(/\s+as\s+/);
          return as.length === 2 ? `${as[0]}: ${as[1]}` : s;
        });
      out.push(`  const { ${names.join(', ')} } = __mod['${resolveKey(key, m[2])}'];`);
      continue;
    }
    // import * as NS from '...';
    if ((m = line.match(/^import\s*\*\s*as\s+(\w+)\s*from\s*'([^']+)';?\s*$/))) {
      out.push(`  const ${m[1]} = __mod['${resolveKey(key, m[2])}'];`);
      continue;
    }
    // export function name / export const name
    if ((m = line.match(/^export\s+(?:function|const|let|class)\s+(\w+)/))) {
      exported.push(m[1]);
      out.push('  ' + line.replace(/^export\s+/, ''));
      continue;
    }
    if (/^export\b/.test(line)) throw new Error(`未対応の export があります: ${key}: ${line}`);
    out.push('  ' + line);
  }

  return `__mod['${key}'] = (function () {\n${out.join('\n')}\n  return { ${exported.join(', ')} };\n})();`;
}

const here = dirname(new URL(import.meta.url).pathname);
const read = (p) => readFileSync(join(here, p), 'utf8');

const bundle = [
  '/* アヒル逃走記 3D — 1ファイル版(build-standalone.mjs が自動生成) */',
  '(function () {',
  '"use strict";',
  'const __mod = {};',
  ...MODULES.map((k) => transform(k, read(join('js', k)))),
  '})();',
].join('\n\n');

let html = read('index.html');
html = html
  .replace('<link rel="stylesheet" href="style.css">', `<style>\n${read('style.css')}\n</style>`)
  .replace(/^\s*<link rel="(manifest|icon|apple-touch-icon)"[^>]*>\n/gm, '')
  .replace('<script type="module" src="js/main.js"></script>', `<script>\n${bundle}\n</script>`)
  .replace(/\s*<script>\s*\n\s*\/\/ オフラインでも遊べるようにする[\s\S]*?<\/script>/, '');

writeFileSync(join(here, 'standalone.html'), html);
console.log(`standalone.html を作りました (${(html.length / 1024).toFixed(0)} KB)`);
