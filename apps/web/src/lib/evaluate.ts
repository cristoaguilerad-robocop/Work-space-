import type { CompiledFunction, ExprNode } from '@wf/schema';

/**
 * Runtime que acompana al codigo generado por el motor.
 * Debe ser identico a `JS_RUNTIME` en engine/wf_core/jsprint.py.
 */
const RUNTIME = `
function sf(x, a, n) {
  if (n < 0) return 0;
  if (x < a) return 0;
  return n === 0 ? 1 : Math.pow(x - a, n);
}
function hv(t) { return t < 0 ? 0 : 1; }
`;

type Evaluator = (x: number, bindings: Record<string, number>) => number;

const cache = new Map<string, Evaluator>();

/** Las funciones de una hoja `{f, a}`, con el mismo nombre que usa el motor. */
const FN: Record<string, (...args: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh,
  exp: Math.exp, log: Math.log, abs: Math.abs,
};

function singularity(x: number, a: number, n: number): number {
  if (n < 0) return 0;
  if (x < a) return 0;
  return n === 0 ? 1 : Math.pow(x - a, n);
}

/**
 * Recorre el arbol serializado.
 *
 * Es el mismo calculo que hace el codigo generado, pero sin compilarlo: en una
 * pagina con CSP estricta `new Function` esta prohibido y este es el unico
 * camino. `variable` dice cual de los simbolos es la variable libre.
 */
function walk(
  node: ExprNode,
  variable: string,
  x: number,
  bindings: Record<string, number>,
): number {
  if (typeof node === 'number') return node;
  if (node === null || node === undefined) return NaN;
  if ('v' in node) return node.v === variable ? x : bindings[node.v];

  const a = node.a;
  switch (node.f) {
    case '+': {
      let out = 0;
      for (const t of a) out += walk(t, variable, x, bindings);
      return out;
    }
    case '*': {
      let out = 1;
      for (const t of a) out *= walk(t, variable, x, bindings);
      return out;
    }
    case '^':
      return Math.pow(walk(a[0], variable, x, bindings), walk(a[1], variable, x, bindings));
    case 'sf':
      return singularity(
        walk(a[0], variable, x, bindings),
        walk(a[1], variable, x, bindings),
        walk(a[2], variable, x, bindings),
      );
    case 'hv':
      return walk(a[0], variable, x, bindings) < 0 ? 0 : 1;
    default: {
      const fn = FN[node.f];
      if (!fn) return NaN;
      return fn(...a.map((arg) => walk(arg, variable, x, bindings)));
    }
  }
}

/** ¿Se puede compilar codigo en esta pagina? Una CSP estricta dice que no. */
let canCompile: boolean | null = null;

function compilable(): boolean {
  if (canCompile === null) {
    try {
      // eslint-disable-next-line no-new-func -- la sonda es una constante.
      canCompile = new Function('return 1')() === 1;
    } catch {
      canCompile = false;
    }
  }
  return canCompile;
}

/**
 * Compila una funcion del motor a un closure evaluable.
 *
 * Se cachea por codigo fuente: mientras el usuario mueve valores en la etapa 3
 * el modelo no cambia, asi que se compila una sola vez y despues cada muestra
 * cuesta una llamada a funcion.
 *
 * Cuando el motor manda el arbol, se evalua recorriendolo: es un poco mas caro
 * por muestra, pero funciona igual donde `new Function` esta prohibido. El
 * codigo queda como camino rapido para la app servida normalmente.
 */
export function compile(fn: CompiledFunction): Evaluator {
  const key = `${fn.variable}|${fn.params.join(',')}|${fn.source}`;
  const hit = cache.get(key);
  if (hit) return hit;

  let raw: (...args: number[]) => number;
  if (!compilable() && fn.ast !== undefined) {
    const tree = fn.ast;
    raw = (x, ...args) => {
      const bindings: Record<string, number> = {};
      fn.params.forEach((p, i) => { bindings[p] = args[i]; });
      return walk(tree, fn.variable, x, bindings);
    };
  } else if (compilable()) {
    // eslint-disable-next-line no-new-func -- el codigo lo genera nuestro motor.
    raw = new Function(
      fn.variable,
      ...fn.params,
      `${RUNTIME}\nreturn (${fn.source});`,
    ) as (...args: number[]) => number;
  } else {
    raw = () => NaN;
  }

  const evaluator: Evaluator = (x, bindings) => {
    const args = fn.params.map((p) => bindings[p]);
    if (args.some((v) => v === undefined || !Number.isFinite(v))) return NaN;
    const out = raw(x, ...args);
    return Number.isFinite(out) ? out : NaN;
  };

  cache.set(key, evaluator);
  return evaluator;
}

/** Evalua una constante (funcion sin variable libre relevante). */
export function value(fn: CompiledFunction, bindings: Record<string, number>): number {
  return compile(fn)(0, bindings);
}

export interface Series {
  xs: number[];
  ys: number[];
  min: number;
  max: number;
}

/**
 * Muestrea una funcion sobre el dominio.
 *
 * Se muestrea denso y, cuando se conocen los puntos de discontinuidad (cargas
 * puntuales, pares), se agrega un par de muestras a cada lado: si no, el
 * grafico dibujaria la rampa de un salto como si fuera parte de la solucion.
 */
export function sample(
  fn: CompiledFunction,
  bindings: Record<string, number>,
  length: number,
  breaks: number[] = [],
  steps = 400,
): Series {
  const f = compile(fn);
  const eps = length * 1e-6;

  const grid = new Set<number>();
  for (let i = 0; i <= steps; i += 1) grid.add((i / steps) * length);
  for (const b of breaks) {
    if (b > eps && b < length - eps) {
      grid.add(b - eps);
      grid.add(b + eps);
    }
  }

  const xs = [...grid].sort((a, b) => a - b);
  const ys = xs.map((x) => f(x, bindings));
  const finite = ys.filter(Number.isFinite);
  return {
    xs,
    ys,
    min: finite.length ? Math.min(...finite) : 0,
    max: finite.length ? Math.max(...finite) : 0,
  };
}
