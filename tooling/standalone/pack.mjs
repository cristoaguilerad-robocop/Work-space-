/**
 * Empaqueta la app en un unico HTML publicable.
 *
 * No es una demo ni un catalogo: es la aplicacion entera -- el canvas donde se
 * pone y se saca, el 3D, el cuaderno y el teclado -- en un archivo que se abre
 * sin servidor. Lo unico que no viaja es el motor simbolico, que es Python; en
 * su lugar van los ejemplos ya derivados (ver build_bundle.py).
 *
 * Restricciones del destino: la pagina corre con una CSP estricta, asi que no
 * puede pedir nada por red ni compilar codigo. De ahi que las fuentes vayan
 * como data URI y que las funciones del motor viajen tambien como arbol.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const DIST = join(ROOT, 'apps', 'web', 'dist');

const assets = readdirSync(join(DIST, 'assets'));
const pick = (ext) => {
  const name = assets.find((f) => f.endsWith(ext));
  if (!name) throw new Error(`falta el ${ext} en dist/assets`);
  return readFileSync(join(DIST, 'assets', name), 'utf8');
};

const js = pick('.js');

/**
 * Deja una sola variante por fuente.
 *
 * Vite incrusta las tres que declara KaTeX (woff2, woff y ttf) y el navegador
 * usa una: las otras dos son medio megabyte de peso muerto.
 */
function trimFonts(css) {
  let kept = 0;
  // Se corta por la estructura y no por el `;`: un data URI lleva uno adentro
  // (`data:font/woff2;base64,...`) y cualquier regex que pare ahi se come el
  // bloque a la mitad. Un base64 no contiene `)`, asi que `url(...)` cierra bien.
  const SRC = /src:\s*(?:url\([^)]*\)(?:\s*format\([^)]*\))?\s*,?\s*)+/g;
  const out = css.replace(SRC, (block) => {
    const woff2 = block.match(/url\((data:font\/woff2;base64,[^)]+)\)/);
    if (!woff2) return block;
    kept += 1;
    return `src:url(${woff2[1]}) format("woff2")`;
  });
  return { css: out, kept };
}

const { css, kept } = trimFonts(pick('.css'));
const bundle = readFileSync(join(HERE, 'bundle.json'), 'utf8');

// El charset primero: el navegador solo lo respeta dentro de los primeros
// 1024 bytes. `</script>` dentro del JSON cerraria la etiqueta antes de tiempo.
const html = `<meta charset="utf-8">
<title>Workspace Funcional</title>
<style>${css}</style>
<div id="root"></div>
<script id="wf-offline" type="application/json">${bundle.replace(/</g, '\\u003c')}</script>
<script type="module">${js}</script>
`;

const out = join(HERE, 'index.html');
writeFileSync(out, html);
console.log(`escrito ${out}`);
console.log(`  ${(html.length / 1024 / 1024).toFixed(2)} MB · ${kept} fuentes · `
  + `${(bundle.length / 1024).toFixed(0)} KB de ejemplos derivados`);
