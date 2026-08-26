import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DerivedBody } from '@wf/schema';

import { value } from '../lib/evaluate';
import { fieldAt, fieldColor, fieldGrid } from '../lib/fields';
import {
  DEFAULT_VIEW, drawSurface, floorOf, heights, projectPoint, type View,
} from '../lib/surface3d';

interface Props {
  body: DerivedBody;
  bindings: Record<string, number>;
}

const GRID_2D = { w: 150, h: 95 };
/** La malla 3D va mas gruesa: cada celda se dibuja como poligono, no como pixel. */
const GRID_3D = { w: 56, h: 40 };
const PIXEL = 4;

const FIELDS: { key: string; label: string; units: string }[] = [
  { key: 'V', label: 'Potencial V', units: 'V' },
  { key: 'Ey', label: 'Campo E_y', units: 'V/m' },
  { key: 'Ex', label: 'Campo E_x', units: 'V/m' },
  { key: 'Bz', label: 'Campo B_z', units: 'T' },
];

function format(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  const abs = Math.abs(v);
  return abs >= 1e4 || abs < 1e-2 ? v.toExponential(2) : v.toFixed(3);
}

/** Color del fondo del lienzo 3D, leido del tema para no fijarlo a mano. */
function surfaceBackground(element: HTMLElement): string {
  return getComputedStyle(element).getPropertyValue('--panel').trim() || '#ffffff';
}

/**
 * Mapa del campo, en 2D o como superficie 3D.
 *
 * Las dos vistas salen de la misma grilla: el barrido corre en el navegador con
 * los integrandos que mando el motor, asi que cambiar un valor de la etapa 3 las
 * redibuja sin pedir nada al servidor.
 */
export function FieldMap({ body, bindings }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<'2d' | '3d'>('2d');
  const [view, setView] = useState<View>(DEFAULT_VIEW);

  const available = FIELDS.filter((f) => body.field_setups?.[f.key]);
  const [active, setActive] = useState(available[0]?.key ?? 'V');
  const setup = body.field_setups?.[active] ?? body.field_setups?.[available[0]?.key ?? ''];

  const L = value(body.length.js, bindings) || 1;
  const bounds = useMemo(
    () => ({ x0: -0.6 * L, x1: 1.6 * L, y0: -0.75 * L, y1: 0.75 * L }),
    [L],
  );

  const grid = useMemo(() => {
    if (!setup) return null;
    const size = mode === '2d' ? GRID_2D : GRID_3D;
    return fieldGrid(setup, bindings, bounds, size.w, size.h);
  }, [setup, bindings, bounds, mode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !grid) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const color = (index: number) =>
      fieldColor(grid.values[index], grid.low, grid.high, grid.diverging);

    if (mode === '3d') {
      const height = heights(grid, grid.low, grid.high);
      drawSurface(context, grid, height, color, view, surfaceBackground(canvas));

      // El cuerpo va como sombra en el plano de base, no siguiendo la
      // superficie. Sobre la superficie, un campo que cambia de signo lo
      // convierte en un muro vertical justo donde cruza el cero, y eso se lee
      // como un error de dibujo en vez de como el dato que es.
      const row = ((bounds.y1 - 0) / (bounds.y1 - bounds.y0)) * (grid.height - 1);
      context.save();
      context.strokeStyle = '#111';
      context.globalAlpha = 0.45;
      context.setLineDash([6, 4]);
      context.lineWidth = 2.5;
      context.beginPath();
      for (let i = 0; i <= 2; i += 1) {
        const u = ((i / 2) * L - bounds.x0) / (bounds.x1 - bounds.x0);
        const p = projectPoint(u - 0.5, row / (grid.height - 1) - 0.5, floorOf(height),
                               view, canvas.width, canvas.height);
        if (i === 0) context.moveTo(p.x, p.y); else context.lineTo(p.x, p.y);
      }
      context.stroke();
      context.restore();
      return;
    }

    const image = context.createImageData(grid.width, grid.height);
    for (let i = 0; i < grid.values.length; i += 1) {
      const [r, g, b] = color(i);
      image.data[i * 4] = r;
      image.data[i * 4 + 1] = g;
      image.data[i * 4 + 2] = b;
      image.data[i * 4 + 3] = 255;
    }
    const buffer = document.createElement('canvas');
    buffer.width = grid.width;
    buffer.height = grid.height;
    buffer.getContext('2d')!.putImageData(image, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(buffer, 0, 0, canvas.width, canvas.height);

    const toX = (x: number) => ((x - bounds.x0) / (bounds.x1 - bounds.x0)) * canvas.width;
    const toY = (y: number) => ((bounds.y1 - y) / (bounds.y1 - bounds.y0)) * canvas.height;
    context.strokeStyle = '#111';
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(toX(0), toY(0));
    context.lineTo(toX(L), toY(0));
    context.stroke();

    for (const probe of body.probes ?? []) {
      context.lineWidth = 2;
      context.beginPath();
      context.arc(toX(value(probe.at[0].js, bindings)),
                  toY(value(probe.at[1].js, bindings)), 6, 0, Math.PI * 2);
      context.stroke();
    }
  }, [grid, mode, view, bounds, L, body.probes, bindings]);

  const dragging = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode !== '3d') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = { x: event.clientX, y: event.clientY };
  }, [mode]);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragging.current) return;
    const dx = event.clientX - dragging.current.x;
    const dy = event.clientY - dragging.current.y;
    dragging.current = { x: event.clientX, y: event.clientY };
    setView((current) => ({
      yaw: current.yaw + dx * 0.008,
      // Se limita la inclinacion: pasando de la vertical la superficie se ve
      // desde abajo y el orden por profundidad deja de tener sentido.
      pitch: Math.max(0.12, Math.min(1.45, current.pitch + dy * 0.006)),
    }));
  }, []);

  const endDrag = useCallback(() => { dragging.current = null; }, []);

  if (!setup || !grid) return null;

  return (
    <div className="fieldmap">
      <div className="fieldmap-tabs">
        {available.map((field) => (
          <button key={field.key} type="button" aria-pressed={active === field.key}
                  onClick={() => setActive(field.key)}>
            {field.label}
          </button>
        ))}
        <span className="fieldmap-modes">
          {(['2d', '3d'] as const).map((option) => (
            <button key={option} type="button" aria-pressed={mode === option}
                    onClick={() => setMode(option)}>
              {option.toUpperCase()}
            </button>
          ))}
        </span>
      </div>

      <canvas
        ref={canvasRef}
        className={mode === '3d' ? 'surface' : ''}
        width={(mode === '2d' ? GRID_2D.w : GRID_3D.w * 3.4) * PIXEL}
        height={(mode === '2d' ? GRID_2D.h : GRID_3D.h * 2.4) * PIXEL}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
      />

      <p className="hint">
        Rango en la vista: {format(grid.min)} a {format(grid.max)}{' '}
        {available.find((f) => f.key === active)?.units}. La escala se recorta a los
        percentiles 4 y 96 para que el pico junto a una carga no aplane el resto.
        {mode === '3d' && ' Arrastra sobre la superficie para girarla.'}
      </p>

      {(body.probes ?? []).length > 0 && (
        <table className="results">
          <tbody>
            {(body.probes ?? []).map((probe) => {
              const observer = {
                px: value(probe.at[0].js, bindings),
                py: value(probe.at[1].js, bindings),
                pz: value(probe.at[2].js, bindings),
              };
              return (
                <tr key={probe.id}>
                  <th className="sym-cell">{probe.label}</th>
                  <td className="hint">
                    ({observer.px.toFixed(2)}, {observer.py.toFixed(2)})
                  </td>
                  {available.map((field) => (
                    <td key={field.key} className="num">
                      {format(fieldAt(body.field_setups![field.key], bindings, observer))}
                      <span className="units"> {field.units}</span>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
