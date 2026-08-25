import { useMemo } from 'react';
import type { DerivedBody } from '@wf/schema';

import { compile, value } from '../lib/evaluate';

interface Props {
  body: DerivedBody;
  bindings: Record<string, number>;
}

const W = 640;
const H = 300;
const BEAM_Y = 210;
const MARGIN = 64;
const LOAD_MAX_PX = 96;

/**
 * Vista 2D del cuerpo con sus cargas y apoyos.
 *
 * El canvas NO reimplementa las distribuciones: dibuja evaluando el mismo
 * perfil canonico que el motor integro. Por eso una carga custom se ve con su
 * forma real sin codigo especifico.
 */
export function Canvas({ body, bindings }: Props) {
  // La longitud viene compilada del motor: puede ser cualquier expresion
  // simbolica ("L", "2*L", "a+b"), no necesariamente un solo simbolo.
  const L = value(body.length.js, bindings) || 1;

  const toPx = (x: number) => MARGIN + (x / L) * (W - 2 * MARGIN);

  const distributed = body.loads.filter((l) => l.kind === 'distributed' && l.profile);
  const scale = useMemo(() => {
    let peak = 0;
    for (const load of distributed) {
      const f = compile(load.profile!.js);
      for (let i = 0; i <= 60; i += 1) {
        peak = Math.max(peak, Math.abs(f((i / 60) * L, bindings)));
      }
    }
    return peak > 0 ? LOAD_MAX_PX / peak : 0;
  }, [distributed, bindings, L]);

  return (
    <svg className="canvas" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Modelo del cuerpo">
      {distributed.map((load) => {
        const f = compile(load.profile!.js);
        const a = value(load.start.js, bindings);
        const b = value(load.end.js, bindings);

        // El perfil se dibuja siempre del lado de arriba y el sentido lo indican
        // las flechas, que es como se lee en un diagrama de cuerpo libre. La
        // altura usa el modulo; el signo vive en `down`.
        const heightAt = (x: number) => Math.abs(f(x, bindings)) * scale;
        const down = f((a + b) / 2, bindings) <= 0;

        const N = 80;
        const outline: string[] = [];
        for (let i = 0; i <= N; i += 1) {
          const x = a + ((b - a) * i) / N;
          outline.push(`${toPx(x).toFixed(1)},${(BEAM_Y - heightAt(x)).toFixed(1)}`);
        }

        const arrows = Array.from({ length: 6 }, (_, i) => {
          const x = a + ((b - a) * (i + 0.5)) / 6;
          const top = BEAM_Y - heightAt(x);
          return { x: toPx(x), from: down ? top : BEAM_Y, to: down ? BEAM_Y : top };
        }).filter((arrow) => Math.abs(arrow.from - arrow.to) > 6);

        const peak = Math.max(...outline.map((pt) => BEAM_Y - Number(pt.split(',')[1])));

        return (
          <g key={load.id} className="load-distributed">
            <polygon
              points={`${toPx(a).toFixed(1)},${BEAM_Y} ${outline.join(' ')} ${toPx(b).toFixed(1)},${BEAM_Y}`}
            />
            <polyline points={outline.join(' ')} />
            {arrows.map((arrow) => (
              <line
                key={arrow.x}
                x1={arrow.x} y1={arrow.from} x2={arrow.x} y2={arrow.to}
                className="load-arrow" markerEnd="url(#arrow)"
              />
            ))}
            <text x={toPx((a + b) / 2)} y={BEAM_Y - peak - 10} textAnchor="middle" className="label">
              {load.label}
            </text>
          </g>
        );
      })}

      {body.loads
        .filter((l) => l.kind === 'point')
        .map((load) => {
          const at = toPx(value(load.start.js, bindings));
          const magnitude = load.magnitude ? value(load.magnitude.js, bindings) : 0;
          const down = magnitude >= 0;
          const y0 = BEAM_Y - (down ? 62 : -62);
          return (
            <g key={load.id} className="load-point">
              <line x1={at} y1={y0} x2={at} y2={BEAM_Y} markerEnd="url(#arrow)" />
              <text x={at} y={y0 - 8} textAnchor="middle" className="label">
                {load.label}
              </text>
            </g>
          );
        })}

      {body.loads
        .filter((l) => l.kind === 'couple')
        .map((load) => {
          const at = toPx(value(load.start.js, bindings));
          return (
            <g key={load.id} className="load-couple">
              <path
                d={`M ${at - 22} ${BEAM_Y - 4} A 22 22 0 1 1 ${at + 22} ${BEAM_Y - 4}`}
                markerEnd="url(#arrow)"
              />
              <text x={at} y={BEAM_Y - 34} textAnchor="middle" className="label">
                {load.label}
              </text>
            </g>
          );
        })}

      <line x1={toPx(0)} y1={BEAM_Y} x2={toPx(L)} y2={BEAM_Y} className="beam" />

      {body.supports.map((support) => {
        const at = toPx(value(support.at.js, bindings));
        if (support.type === 'fixed') {
          return (
            <g key={support.id} className="support">
              <line x1={at} y1={BEAM_Y - 26} x2={at} y2={BEAM_Y + 26} className="fixed-wall" />
              {[-20, -10, 0, 10, 20].map((dy) => (
                <line key={dy} x1={at} y1={BEAM_Y + dy} x2={at - 11} y2={BEAM_Y + dy + 9} />
              ))}
              <text x={at} y={BEAM_Y + 46} textAnchor="middle" className="label">{support.id}</text>
            </g>
          );
        }
        return (
          <g key={support.id} className="support">
            <polygon points={`${at},${BEAM_Y} ${at - 13},${BEAM_Y + 22} ${at + 13},${BEAM_Y + 22}`} />
            {support.type === 'roller' && (
              <>
                <circle cx={at - 7} cy={BEAM_Y + 27} r={4.5} />
                <circle cx={at + 7} cy={BEAM_Y + 27} r={4.5} />
              </>
            )}
            <text x={at} y={BEAM_Y + 48} textAnchor="middle" className="label">{support.id}</text>
          </g>
        );
      })}

      <line x1={toPx(0)} y1={BEAM_Y + 62} x2={toPx(L)} y2={BEAM_Y + 62} className="dimension" />
      <text x={toPx(L / 2)} y={BEAM_Y + 78} textAnchor="middle" className="label">
        L = {L} m
      </text>

      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
      </defs>
    </svg>
  );
}
