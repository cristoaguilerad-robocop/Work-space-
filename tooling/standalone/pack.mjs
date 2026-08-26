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
 * Familias de KaTeX que la pagina no usa.
 *
 * Son las de alfabetos decorativos: `\\mathfrak`, `\\mathscr`, `\\texttt`,
 * `\\mathsf`. Nada de lo que escribe el motor las pide, y en un ejercicio de
 * fisica no aparecen. Si alguien las escribe igual, el texto se ve con la letra
 * del sistema en vez de no verse. Cuestan cien kilobytes que aca importan: la
 * pagina entra en un archivo y ese archivo tiene un tope.
 */
const DROPPED = ['KaTeX_Fraktur', 'KaTeX_Script', 'KaTeX_Typewriter', 'KaTeX_SansSerif'];

/**
 * Deja una sola variante por fuente y tira las familias que no se usan.
 *
 * Vite incrusta las tres variantes que declara KaTeX (woff2, woff y ttf) y el
 * navegador usa una: las otras dos son medio megabyte de peso muerto.
 */
function trimFonts(css) {
  let kept = 0;
  const dropped = new Set();

  // Se corta por la estructura y no por el `;`: un data URI lleva uno adentro
  // (`data:font/woff2;base64,...`) y cualquier regex que pare ahi se come el
  // bloque a la mitad. Un base64 no contiene `)`, asi que `url(...)` cierra bien.
  const SRC = /src:\s*(?:url\([^)]*\)(?:\s*format\([^)]*\))?\s*,?\s*)+/g;

  const out = css.replace(/@font-face\s*\{[^}]*\}/g, (block) => {
    const family = block.match(/font-family:\s*["']?(KaTeX_[A-Za-z]+)/);
    if (family && DROPPED.includes(family[1])) {
      dropped.add(family[1]);
      return '';
    }
    return block.replace(SRC, (src) => {
      const woff2 = src.match(/url\((data:font\/woff2;base64,[^)]+)\)/);
      if (!woff2) return src;
      kept += 1;
      return `src:url(${woff2[1]}) format("woff2")`;
    });
  });

  return { css: out, kept, dropped: [...dropped] };
}

const { css, kept, dropped } = trimFonts(pick('.css'));
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
console.log(`  sin ${dropped.join(', ') || 'ninguna familia descartada'}`);
