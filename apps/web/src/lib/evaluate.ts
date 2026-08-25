import type { CompiledFunction } from '@wf/schema';

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

/**
 * Compila una funcion del motor a un closure evaluable.
 *
 * Se cachea por codigo fuente: mientras el usuario mueve valores en la etapa 3
 * el modelo no cambia, asi que se compila una sola vez y despues cada muestra
 * cuesta una llamada a funcion.
 */
export function compile(fn: CompiledFunction): Evaluator {
  const key = `${fn.variable}|${fn.params.join(',')}|${fn.source}`;
  const hit = cache.get(key);
  if (hit) return hit;

  // eslint-disable-next-line no-new-func -- el codigo lo genera nuestro motor.
  const raw = new Function(
    fn.variable,
    ...fn.params,
    `${RUNTIME}\nreturn (${fn.source});`,
  ) as (...args: number[]) => number;

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
