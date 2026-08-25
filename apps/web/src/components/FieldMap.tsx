import { useEffect, useMemo, useRef, useState } from 'react';
import type { DerivedBody } from '@wf/schema';

import { value } from '../lib/evaluate';
import { fieldAt, fieldColor, fieldGrid } from '../lib/fields';

interface Props {
  body: DerivedBody;
  bindings: Record<string, number>;
}

const GRID_W = 150;
const GRID_H = 95;
const PIXEL = 4;

const FIELDS: { key: string; label: string; units: string }[] = [
  { key: 'V', label: 'Potencial V', units: 'V' },
  { key: 'Ey', label: 'Campo E_y', units: 'V/m' },
  { key: 'Ex', label: 'Campo E_x', units: 'V/m' },
  { key: 'Bz', label: 'Campo B_z', units: 'T' },
];

/**
 * Mapa 2D del campo en el plano del cuerpo.
 *
 * Todo el barrido corre en el navegador con los integrandos que mando el
 * motor, asi que cambiar un valor de la etapa 3 lo redibuja sin pedir nada.
 */
export function FieldMap({ body, bindings }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const available = FIELDS.filter((f) => body.field_setups?.[f.key]);
  const [active, setActive] = useState(available[0]?.key ?? 'V');
  const setup = body.field_setups?.[active];

  const L = value(body.length.js, bindings) || 1;
  const bounds = useMemo(
    () => ({ x0: -0.6 * L, x1: 1.6 * L, y0: -0.75 * L, y1: 0.75 * L }),
    [L],
  );

  const [range, setRange] = useState<{ min: number; max: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !setup) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const grid = fieldGrid(setup, bindings, bounds, GRID_W, GRID_H);

    // Los limites se fijan por percentil y no por el extremo: cerca de una
    // carga puntual el campo diverge, y un solo pixel enorme dejaria plano
    // todo el resto del mapa.
    const finite = Array.from(grid.values).filter(Number.isFinite).sort((a, b) => a - b);
    const at = (q: number) => finite[Math.min(finite.length - 1, Math.floor(finite.length * q))] ?? 0;
    const low = at(0.04);
    const high = at(0.96);
    const diverging = low < 0 && high > 0;

    const image = context.createImageData(GRID_W, GRID_H);
    for (let i = 0; i < grid.values.length; i += 1) {
      const [r, g, b] = fieldColor(grid.values[i], low, high, diverging);
      image.data[i * 4] = r;
      image.data[i * 4 + 1] = g;
      image.data[i * 4 + 2] = b;
      image.data[i * 4 + 3] = 255;
    }

    const buffer = document.createElement('canvas');
    buffer.width = GRID_W;
    buffer.height = GRID_H;
    buffer.getContext('2d')!.putImageData(image, 0, 0);

    context.imageSmoothingEnabled = true;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(buffer, 0, 0, canvas.width, canvas.height);

    // El cuerpo, encima del mapa.
    const toX = (x: number) => ((x - bounds.x0) / (bounds.x1 - bounds.x0)) * canvas.width;
    const toY = (y: number) => ((bounds.y1 - y) / (bounds.y1 - bounds.y0)) * canvas.height;
    context.strokeStyle = '#111';
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(toX(0), toY(0));
    context.lineTo(toX(L), toY(0));
    context.stroke();

    for (const probe of body.probes ?? []) {
      const px = value(probe.at[0].js, bindings);
      const py = value(probe.at[1].js, bindings);
      context.strokeStyle = '#111';
      context.lineWidth = 2;
      context.beginPath();
      context.arc(toX(px), toY(py), 6, 0, Math.PI * 2);
      context.stroke();
    }

    setRange({ min: grid.min, max: grid.max });
  }, [setup, bindings, bounds, L, body.probes]);

  if (!setup) return null;

  const format = (v: number) =>
    !Number.isFinite(v) ? '—'
      : Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-2 && v !== 0) ? v.toExponential(2) : v.toFixed(3);

  return (
    <div className="fieldmap">
      <div className="fieldmap-tabs">
        {available.map((field) => (
          <button key={field.key} type="button" aria-pressed={active === field.key}
                  onClick={() => setActive(field.key)}>
            {field.label}
          </button>
        ))}
      </div>
      <canvas ref={canvasRef} width={GRID_W * PIXEL} height={GRID_H * PIXEL} />
      {range && (
        <p className="hint">
          Rango en la vista: {format(range.min)} a {format(range.max)}{' '}
          {available.find((f) => f.key === active)?.units}. La escala se recorta a los
          percentiles 4 y 96 para que el pico junto a una carga no aplane el resto del mapa.
        </p>
      )}
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
