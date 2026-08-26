/**
 * Genera la demo publicable: un unico HTML sin ninguna dependencia de red.
 *
 * El LaTeX se rinde a HTML con KaTeX aca, en tiempo de build, y las fuentes de
 * KaTeX se incrustan como data URIs. La evaluacion numerica NO se precalcula:
 * viaja el mismo codigo JavaScript que genera el motor, asi que la etapa 3 de
 * la demo se comporta igual que la de la app real.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const KATEX = join(ROOT, 'node_modules/.pnpm/katex@0.16.47/node_modules/katex/dist');
const katex = createRequire(import.meta.url)(join(KATEX, 'katex.js'));

const cases = JSON.parse(readFileSync(join(HERE, 'payloads.json'), 'utf8'));

// ---------------------------------------------------------------- matematica

const usedFonts = new Set();

// Ya no se pre-renderiza nada: la pagina lleva KaTeX y rinde en el navegador.
// El cambio no es solo de peso -- aunque baja de casi 7 MB a algo mas de uno --
// sino que es lo que permite que el usuario ESCRIBA matematica y la vea. Un
// cuaderno donde solo se pueden leer formulas ajenas no es un cuaderno.

// ---------------------------------------------------------------- fuentes

/** Incrusta solo los woff2, y descarta las variantes woff/ttf del CSS. */
function inlineKatexCss() {
  let css = readFileSync(join(KATEX, 'katex.min.css'), 'utf8');
  const files = readdirSync(join(KATEX, 'fonts')).filter((f) => f.endsWith('.woff2'));
  const data = new Map(
    files.map((f) => [f, readFileSync(join(KATEX, 'fonts', f)).toString('base64')]),
  );

  css = css.replace(/src:[^;]+;/g, (block) => {
    const woff2 = block.match(/fonts\/(KaTeX_[A-Za-z-]+\.woff2)/);
    if (!woff2 || !data.has(woff2[1])) return 'src:local("");';
    usedFonts.add(woff2[1]);
    return `src:url(data:font/woff2;base64,${data.get(woff2[1])}) format("woff2");`;
  });
  return css;
}

const katexCss = inlineKatexCss();

// ---------------------------------------------------------------- salida

const app = readFileSync(join(HERE, 'app.js'), 'utf8');
const katexJs = readFileSync(join(KATEX, 'katex.min.js'), 'utf8');
const styles = readFileSync(join(HERE, 'styles.css'), 'utf8');

// El charset va primero de todo: el navegador solo lo respeta si aparece
// dentro de los primeros 1024 bytes del documento.
const html = `<meta charset="utf-8">
<title>Workspace Funcional</title>
<style>${katexCss}</style>
<style>${styles}</style>
<div id="app"></div>
<script id="payloads" type="application/json">${
  JSON.stringify(cases).replace(/</g, '\\u003c')
}</script>
<script>${katexJs}</script>
<script>${app}</script>
`;

const out = join(ROOT, 'tooling', 'demo', 'index.html');
writeFileSync(out, html);
console.log(`escrito ${out}`);
console.log(`  ${(html.length / 1024 / 1024).toFixed(2)} MB · ${usedFonts.size} fuentes incrustadas · ${cases.length} modelos`);
