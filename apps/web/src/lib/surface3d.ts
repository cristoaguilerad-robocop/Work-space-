/**
 * Superficie 3D del campo, dibujada sobre canvas sin dependencias.
 *
 * Reusa la misma grilla que el mapa 2D: la diferencia es solo como se proyecta.
 * Se dibuja de atras hacia adelante (algoritmo del pintor) porque una malla
 * regular vista desde fuera siempre se puede ordenar por profundidad, y eso
 * evita tener que llevar un z-buffer.
 */

import type { FieldGrid } from './fields';

export interface View {
  /** Giro alrededor del eje vertical, en radianes. */
  yaw: number;
  /** Inclinacion de la camara. */
  pitch: number;
}

export const DEFAULT_VIEW: View = { yaw: -0.62, pitch: 0.62 };

interface Projected {
  x: number;
  y: number;
  depth: number;
}

/**
 * Proyeccion ortografica. Alcanza y sobra para leer una superficie de campo, y
 * a diferencia de la perspectiva no deforma las alturas segun donde caigan.
 */
function project(
  u: number, v: number, h: number, view: View, width: number, height: number,
): Projected {
  const cosYaw = Math.cos(view.yaw);
  const sinYaw = Math.sin(view.yaw);
  const cosPitch = Math.cos(view.pitch);
  const sinPitch = Math.sin(view.pitch);

  const rx = u * cosYaw - v * sinYaw;
  const ry = u * sinYaw + v * cosYaw;

  // Los factores estan elegidos para que el caso extremo -- la diagonal de la
  // malla con la altura al tope -- entre justo en el lienzo. Con valores mas
  // generosos la superficie se recorta abajo en cuanto aparece un pico.
  const screenX = width / 2 + rx * width * 0.46;
  const screenY = height * 0.55 - ry * cosPitch * height * 0.26 - h * height * 0.26;
  return { x: screenX, y: screenY, depth: ry * cosPitch - h * sinPitch };
}

/**
 * Altura normalizada, con el mismo recorte por percentil que el color.
 *
 * Si el campo cambia de signo el cero se deja en el medio: la altura tiene que
 * decir de que lado esta cada punto. Si no cambia de signo eso no aporta nada
 * y solo desperdicia la mitad del alto del lienzo, asi que la superficie se
 * estira para ocuparlo entero.
 */
export function heights(grid: FieldGrid, low: number, high: number): Float64Array {
  const span = Math.max(Math.abs(low), Math.abs(high)) || 1;
  const out = new Float64Array(grid.values.length);
  let min = Infinity;
  let max = -Infinity;

  for (let i = 0; i < grid.values.length; i += 1) {
    const v = grid.values[i];
    if (!Number.isFinite(v)) { out[i] = 0; continue; }
    const t = Math.max(-1, Math.min(1, v / span));
    // Misma compresion que el color: si no, el pico junto a una carga se lleva
    // toda la altura y el resto queda plano.
    const eased = Math.sign(t) * Math.pow(Math.abs(t), 0.45);
    out[i] = eased;
    if (eased < min) min = eased;
    if (eased > max) max = eased;
  }

  if (grid.diverging || !Number.isFinite(min) || max - min < 1e-9) return out;

  const scale = 1.8 / (max - min);
  for (let i = 0; i < out.length; i += 1) out[i] = (out[i] - min) * scale - 0.9;
  return out;
}

/** Cota del plano de sombra: apenas por debajo del punto mas bajo. */
export function floorOf(height: Float64Array): number {
  let min = Infinity;
  for (const value of height) if (value < min) min = value;
  return (Number.isFinite(min) ? min : -1) - 0.18;
}

export function drawSurface(
  context: CanvasRenderingContext2D,
  grid: FieldGrid,
  height: Float64Array,
  color: (index: number) => [number, number, number],
  view: View,
  background: string,
): void {
  const { width, height: canvasHeight } = context.canvas;
  context.fillStyle = background;
  context.fillRect(0, 0, width, canvasHeight);

  const at = (row: number, column: number) => {
    const index = row * grid.width + column;
    return {
      point: project(
        column / (grid.width - 1) - 0.5,
        row / (grid.height - 1) - 0.5,
        height[index], view, width, canvasHeight,
      ),
      index,
    };
  };

  const quads: { depth: number; points: Projected[]; index: number }[] = [];
  for (let row = 0; row < grid.height - 1; row += 1) {
    for (let column = 0; column < grid.width - 1; column += 1) {
      const corners = [at(row, column), at(row, column + 1),
                       at(row + 1, column + 1), at(row + 1, column)];
      quads.push({
        depth: corners.reduce((sum, c) => sum + c.point.depth, 0) / 4,
        points: corners.map((c) => c.point),
        index: corners[0].index,
      });
    }
  }

  quads.sort((a, b) => b.depth - a.depth);

  for (const quad of quads) {
    const [r, g, b] = color(quad.index);
    context.fillStyle = `rgb(${r},${g},${b})`;
    context.strokeStyle = `rgba(${r},${g},${b},0.85)`;
    context.lineWidth = 0.6;
    context.beginPath();
    context.moveTo(quad.points[0].x, quad.points[0].y);
    for (const point of quad.points.slice(1)) context.lineTo(point.x, point.y);
    context.closePath();
    context.fill();
    context.stroke();
  }
}

/** Proyecta un punto del plano del cuerpo, para dibujar la linea encima. */
export function projectPoint(
  u: number, v: number, h: number, view: View, width: number, height: number,
) {
  return project(u, v, h, view, width, height);
}
