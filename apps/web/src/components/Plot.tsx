import { useMemo } from 'react';
import type { CompiledFunction } from '@wf/schema';

import { sample } from '../lib/evaluate';

interface Props {
  title: string;
  units: string;
  fn: CompiledFunction;
  bindings: Record<string, number>;
  length: number;
  breaks: number[];
  color: string;
}

const W = 520;
const H = 150;
const PAD = { top: 14, right: 14, bottom: 22, left: 58 };

/**
 * Diagrama de una funcion sobre el dominio del cuerpo.
 *
 * Se evalua en el navegador con la funcion compilada por el motor: mover un
 * valor en la etapa 3 redibuja sin pedir nada al servidor.
 */
export function Plot({ title, units, fn, bindings, length, breaks, color }: Props) {
  // Se muestrea el intervalo ABIERTO. Justo en x = L la reaccion del apoyo ya
  // entro en la integral y el cortante cae a cero; incluir ese punto dibuja un
  // salto vertical que no es parte del diagrama de esfuerzos internos.
  const series = useMemo(
    () => sample(fn, bindings, length * (1 - 1e-9), breaks),
    [fn, bindings, length, breaks],
  );

  const { path, zeroY, lo, hi } = useMemo(() => {
    const span = Math.max(Math.abs(series.min), Math.abs(series.max), 1e-12);
    const low = Math.min(series.min, 0) - span * 0.08;
    const high = Math.max(series.max, 0) + span * 0.08;
    const range = high - low || 1;

    const sx = (x: number) => PAD.left + (x / length) * (W - PAD.left - PAD.right);
    const sy = (y: number) => PAD.top + (1 - (y - low) / range) * (H - PAD.top - PAD.bottom);

    let d = '';
    let pen = false;
    series.xs.forEach((x, i) => {
      const y = series.ys[i];
      if (!Number.isFinite(y)) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${sx(x).toFixed(2)},${sy(y).toFixed(2)}`;
      pen = true;
    });

    return { path: d, zeroY: sy(0), lo: series.min, hi: series.max };
  }, [series, length]);

  const fmt = (v: number) =>
    Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-2 && v !== 0)
      ? v.toExponential(1)
      : v.toFixed(2);

  return (
    <figure className="plot">
      <figcaption>
        {title} <span className="units">{units}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        <line
          x1={PAD.left} x2={W - PAD.right} y1={zeroY} y2={zeroY}
          className="axis"
        />
        <text x={PAD.left - 6} y={PAD.top + 8} className="tick" textAnchor="end">
          {fmt(hi)}
        </text>
        <text x={PAD.left - 6} y={H - PAD.bottom} className="tick" textAnchor="end">
          {fmt(lo)}
        </text>
        <text x={PAD.left} y={H - 6} className="tick">0</text>
        <text x={W - PAD.right} y={H - 6} className="tick" textAnchor="end">
          {length.toFixed(2)} m
        </text>
        <path d={path} fill="none" stroke={color} strokeWidth={1.8} />
      </svg>
    </figure>
  );
}
