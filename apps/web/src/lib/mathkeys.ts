/**
 * Teclado matematico: lo que se puede escribir sin acordarse de LaTeX.
 *
 * Cada tecla trae el LaTeX que inserta y, cuando corresponde, donde queda el
 * cursor despues. `caret` es el desplazamiento desde el final de lo insertado:
 * en `\frac{}{}` conviene quedar dentro de la primera llave, no al final.
 */

export interface MathKey {
  /** Lo que se ve en la tecla. Se rinde con KaTeX si empieza con `\` o trae `{`. */
  label: string;
  /** Lo que se inserta en el texto. */
  latex: string;
  /** Posicion del cursor tras insertar, contada desde el final. */
  caret?: number;
  /** Nombre para lectores de pantalla, cuando el simbolo solo no alcanza. */
  name?: string;
}

export interface MathGroup {
  id: string;
  label: string;
  keys: MathKey[];
}

const plain = (latex: string, name?: string): MathKey => ({ label: latex, latex, name });

export const MATH_GROUPS: MathGroup[] = [
  {
    id: 'griegas',
    label: 'Griegas',
    keys: [
      '\\alpha', '\\beta', '\\gamma', '\\delta', '\\epsilon', '\\varepsilon',
      '\\zeta', '\\eta', '\\theta', '\\vartheta', '\\kappa', '\\lambda',
      '\\mu', '\\nu', '\\xi', '\\rho', '\\sigma', '\\tau', '\\phi', '\\varphi',
      '\\chi', '\\psi', '\\omega',
      '\\Gamma', '\\Delta', '\\Theta', '\\Lambda', '\\Xi', '\\Pi',
      '\\Sigma', '\\Phi', '\\Psi', '\\Omega',
    ].map((latex) => plain(latex)),
  },
  {
    id: 'calculo',
    label: 'Calculo',
    keys: [
      { label: '\\int', latex: '\\int ', name: 'integral' },
      { label: '\\int_{a}^{b}', latex: '\\int_{}^{} ', caret: 5, name: 'integral definida' },
      { label: '\\iint', latex: '\\iint ', name: 'integral doble' },
      { label: '\\iiint', latex: '\\iiint ', name: 'integral triple' },
      { label: '\\oint', latex: '\\oint ', name: 'integral de linea cerrada' },
      { label: 'dx', latex: '\\,dx', name: 'diferencial en x' },
      { label: '\\partial', latex: '\\partial ', name: 'derivada parcial' },
      { label: '\\frac{d}{dx}', latex: '\\frac{d}{dx} ', name: 'derivada' },
      { label: '\\frac{\\partial}{\\partial x}', latex: '\\frac{\\partial }{\\partial x} ',
        caret: 14, name: 'derivada parcial respecto de x' },
      { label: '\\lim_{x \\to a}', latex: '\\lim_{ \\to } ', caret: 6, name: 'limite' },
      { label: '\\sum', latex: '\\sum_{}^{} ', caret: 5, name: 'sumatoria' },
      { label: '\\prod', latex: '\\prod_{}^{} ', caret: 5, name: 'productoria' },
      { label: '\\nabla', latex: '\\nabla ', name: 'nabla' },
      { label: '\\infty', latex: '\\infty ', name: 'infinito' },
    ],
  },
  {
    id: 'estructura',
    label: 'Estructura',
    keys: [
      { label: '\\frac{a}{b}', latex: '\\frac{}{}', caret: 3, name: 'fraccion' },
      { label: 'x^{n}', latex: '^{}', caret: 1, name: 'exponente' },
      { label: 'x_{i}', latex: '_{}', caret: 1, name: 'subindice' },
      { label: '\\sqrt{x}', latex: '\\sqrt{}', caret: 1, name: 'raiz' },
      { label: '\\sqrt[n]{x}', latex: '\\sqrt[]{}', caret: 3, name: 'raiz n-esima' },
      { label: '\\left(\\right)', latex: '\\left( \\right)', caret: 8, name: 'parentesis' },
      { label: '\\left[\\right]', latex: '\\left[ \\right]', caret: 8, name: 'corchetes' },
      { label: '\\left\\{\\right\\}', latex: '\\left\\{ \\right\\}', caret: 10, name: 'llaves' },
      { label: '\\left|x\\right|', latex: '\\left| \\right|', caret: 8, name: 'valor absoluto' },
      { label: '\\vec{F}', latex: '\\vec{}', caret: 1, name: 'vector' },
      { label: '\\hat{n}', latex: '\\hat{}', caret: 1, name: 'versor' },
      { label: '\\bar{x}', latex: '\\bar{}', caret: 1, name: 'promedio' },
      { label: '\\dot{x}', latex: '\\dot{}', caret: 1, name: 'derivada temporal' },
      { label: '\\begin{cases}\\end{cases}', latex: '\\begin{cases} \\\\ \\end{cases}',
        caret: 17, name: 'sistema de ecuaciones' },
    ],
  },
  {
    id: 'relaciones',
    label: 'Relaciones',
    keys: [
      '=', '\\neq', '\\approx', '\\equiv', '\\propto',
      '<', '>', '\\leq', '\\geq', '\\ll', '\\gg',
      '\\pm', '\\mp', '\\times', '\\cdot', '\\div',
      '\\to', '\\Rightarrow', '\\Leftrightarrow', '\\therefore',
      '\\in', '\\forall', '\\exists',
    ].map((latex) => plain(latex)),
  },
  {
    id: 'fisica',
    label: 'Fisica',
    keys: [
      { label: '\\sum F_x = 0', latex: '\\sum F_x = 0', name: 'suma de fuerzas en x' },
      { label: '\\sum F_y = 0', latex: '\\sum F_y = 0', name: 'suma de fuerzas en y' },
      { label: '\\sum M = 0', latex: '\\sum M_{} = 0', caret: 5, name: 'suma de momentos' },
      { label: '\\vec{F}', latex: '\\vec{F}', name: 'fuerza' },
      { label: '\\Delta T', latex: '\\Delta T', name: 'salto de temperatura' },
      { label: '\\rho', latex: '\\rho', name: 'densidad' },
      { label: '\\lambda', latex: '\\lambda', name: 'densidad lineal' },
      { label: '\\varepsilon_0', latex: '\\varepsilon_0', name: 'permitividad del vacio' },
      { label: '\\mu_0', latex: '\\mu_0', name: 'permeabilidad del vacio' },
      { label: '^\\circ', latex: '^\\circ', name: 'grados' },
      { label: '\\,\\mathrm{N}', latex: '\\,\\mathrm{N}', name: 'newton' },
      { label: '\\,\\mathrm{m}', latex: '\\,\\mathrm{m}', name: 'metro' },
      { label: '\\,\\mathrm{kg}', latex: '\\,\\mathrm{kg}', name: 'kilogramo' },
      { label: '\\,\\mathrm{W}', latex: '\\,\\mathrm{W}', name: 'watt' },
      { label: '\\,\\mathrm{C}', latex: '\\,\\mathrm{C}', name: 'coulomb' },
      { label: '\\mathrm{V}', latex: '\\,\\mathrm{V}', name: 'volt' },
    ],
  },
];

/**
 * Inserta una tecla en un textarea, respetando la seleccion y el modo.
 *
 * Si el cursor no esta dentro de matematica, se envuelve lo insertado en
 * `$...$`: escribir una integral en medio de una frase tiene que funcionar sin
 * que haya que acordarse de abrir el signo peso.
 */
export function insertKey(
  text: string, start: number, end: number, key: MathKey,
): { text: string; caret: number } {
  const inside = insideMath(text, start);
  const payload = inside ? key.latex : `$${key.latex}$`;
  const next = text.slice(0, start) + payload + text.slice(end);
  const tail = key.caret ?? 0;
  return { text: next, caret: start + payload.length - tail - (inside ? 0 : 1) };
}

/** Si la posicion cae dentro de un tramo `$...$`. */
export function insideMath(text: string, position: number): boolean {
  let open = false;
  for (let i = 0; i < position && i < text.length; i += 1) {
    if (text[i] === '$' && text[i - 1] !== '\\') open = !open;
  }
  return open;
}
