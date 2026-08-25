import type { FieldSetup } from '@wf/schema';

import { compile } from './evaluate';

/**
 * Evaluacion de campos de Electro en el cliente.
 *
 * El motor manda el planteo, no el numero: los integrandos por tramo y el
 * aporte exacto de las cargas puntuales. Integrar aca es lo que permite mover
 * la sonda o barrer la grilla del mapa sin una sola ida al servidor, y
 * funciona igual para una densidad que SymPy no sabe integrar.
 */

/** Pasos de Simpson por tramo. Debe ser par. */
const PROBE_STEPS = 200;
const MAP_STEPS = 16;

function simpson(
  f: (x: number) => number, start: number, end: number, steps: number,
): number {
  if (!(end > start)) return 0;
  const h = (end - start) / steps;
  let total = f(start) + f(end);
  for (let i = 1; i < steps; i += 1) {
    total += f(start + i * h) * (i % 2 ? 4 : 2);
  }
  return (total * h) / 3;
}

/**
 * Valor del campo en un punto de observacion.
 *
 * `observer` trae px, py, pz; se mezclan con los valores de la etapa 3 porque
 * para el integrando son parametros como cualquier otro.
 */
export function fieldAt(
  setup: FieldSetup,
  bindings: Record<string, number>,
  observer: { px: number; py: number; pz: number },
  steps = PROBE_STEPS,
): number {
  const scope = { ...bindings, ...observer };
  let total = compile(setup.discrete.js)(0, scope);
  if (!Number.isFinite(total)) total = 0;

  for (const part of setup.parts) {
    const start = compile(part.start.js)(0, scope);
    const end = compile(part.end.js)(0, scope);
    const f = compile(part.integrand.js);
    const contribution = simpson((x) => f(x, scope), start, end, steps);
    if (Number.isFinite(contribution)) total += contribution;
  }
  return total;
}

export interface FieldGrid {
  width: number;
  height: number;
  /** Valores fila por fila, de arriba hacia abajo. */
  values: Float64Array;
  min: number;
  max: number;
}

/**
 * Barre una grilla del plano y devuelve el campo en cada celda.
 *
 * Se usan pocos pasos de Simpson por celda a proposito: el mapa es una lectura
 * cualitativa y hay decenas de miles de celdas. La sonda, que si se lee como
 * numero, usa una cuadratura mucho mas fina.
 */
export function fieldGrid(
  setup: FieldSetup,
  bindings: Record<string, number>,
  bounds: { x0: number; x1: number; y0: number; y1: number },
  width: number,
  height: number,
): FieldGrid {
  const values = new Float64Array(width * height);
  let min = Infinity;
  let max = -Infinity;

  for (let row = 0; row < height; row += 1) {
    const py = bounds.y1 - ((row + 0.5) / height) * (bounds.y1 - bounds.y0);
    for (let column = 0; column < width; column += 1) {
      const px = bounds.x0 + ((column + 0.5) / width) * (bounds.x1 - bounds.x0);
      const v = fieldAt(setup, bindings, { px, py, pz: 0 }, MAP_STEPS);
      values[row * width + column] = v;
      if (Number.isFinite(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
  }

  return { width, height, values, min: Number.isFinite(min) ? min : 0,
           max: Number.isFinite(max) ? max : 0 };
}

/**
 * Escala de color del mapa.
 *
 * Si el campo cambia de signo (un dipolo) hace falta una escala divergente con
 * el cero en el neutro: es justo el dato que interesa. Si no cambia de signo
 * (una linea con carga toda del mismo signo) una divergente pinta todo del
 * mismo lado y no se lee nada, asi que ahi va una secuencial que usa todo el
 * rango.
 */
export function fieldColor(
  v: number, low: number, high: number, diverging: boolean,
): [number, number, number] {
  if (!Number.isFinite(v)) return [128, 128, 128];

  if (diverging) {
    const span = Math.max(Math.abs(low), Math.abs(high)) || 1;
    const t = Math.max(-1, Math.min(1, v / span));
    // Compresion suave: si no, el pico junto a una carga aplana todo lo demas.
    const eased = Math.sign(t) * Math.pow(Math.abs(t), 0.42);
    if (eased >= 0) {
      return [
        Math.round(247 - 60 * (1 - eased)),
        Math.round(247 - 150 * eased),
        Math.round(247 - 190 * eased),
      ];
    }
    const a = -eased;
    return [
      Math.round(247 - 200 * a),
      Math.round(247 - 110 * a),
      Math.round(247 - 20 * a),
    ];
  }

  const range = high - low || 1;
  const t = Math.pow(Math.max(0, Math.min(1, (v - low) / range)), 0.5);
  // Rampa fria -> calida, monotona en luminosidad para que se lea en gris.
  return [
    Math.round(28 + 219 * Math.pow(t, 0.8)),
    Math.round(52 + 150 * t),
    Math.round(120 + 40 * t - 90 * Math.pow(t, 2)),
  ];
}
