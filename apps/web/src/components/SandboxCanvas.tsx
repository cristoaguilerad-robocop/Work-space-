import { useCallback, useMemo, useRef, useState } from 'react';
import type { DerivedBody, ProblemModel } from '@wf/schema';

import { compile, value } from '../lib/evaluate';
import { coordinateExpression, positionExpression, positionLabel } from '../lib/symbolic';
import type { Module } from '../lib/elements';

export interface Selection {
  target: 'field' | 'support' | 'boundary' | 'probe';
  id: string;
}

interface Props {
  body: DerivedBody;
  model: ProblemModel;
  module: Module;
  bindings: Record<string, number>;
  selection: Selection | null;
  onSelect: (selection: Selection | null) => void;
  onChange: (update: (model: ProblemModel) => ProblemModel) => void;
  /** Elemento elegido en la paleta, a la espera de que se haga clic en el canvas. */
  pending: string | null;
  onPlace: (at: string) => void;
}

const W = 680;
const H = 340;
const BEAM_Y = 214;
const MARGIN = 74;
const LOAD_PX = 92;
/** Escala del plano transversal, para las sondas de Electro. */
const PLANE_PX = 150;

type Drag =
  | { target: 'field'; id: string; part: 'at' | 'start' | 'end' }
  | { target: 'support' | 'boundary'; id: string; part: 'at' }
  | { target: 'probe'; id: string; part: 'xy' };

/**
 * Canvas editable: la parte que hace de esto un sandbox y no un visor.
 *
 * Todo lo que se arrastra escribe una expresion simbolica en el modelo, no un
 * numero. Mientras dura el arrastre el elemento se dibuja en la posicion del
 * cursor sin esperar al motor: la derivacion tarda unos cientos de
 * milisegundos y el elemento tiene que seguir al dedo, no llegar despues.
 */
export function SandboxCanvas({
  body, model, module, bindings, selection, onSelect, onChange, pending, onPlace,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [ghost, setGhost] = useState<number | null>(null);

  const L = value(body.length.js, bindings) || 1;
  const modelBody = model.bodies[0];
  const domainEnd = modelBody?.domain.end ?? 'L';

  const toPx = useCallback((x: number) => MARGIN + (x / L) * (W - 2 * MARGIN), [L]);
  const fromPx = useCallback((px: number) => ((px - MARGIN) / (W - 2 * MARGIN)) * L, [L]);

  /** Coordenadas del puntero en el sistema del SVG. */
  const pointerAt = useCallback((event: React.PointerEvent) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const matrix = svg.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(matrix.inverse());
    return { x: local.x, y: local.y };
  }, []);

  const applyPosition = useCallback((current: Drag, t: number, snap: boolean) => {
    const expression = positionExpression(t, domainEnd, snap);
    onChange((m) => {
      if (current.target === 'field') {
        return {
          ...m,
          bodies: m.bodies.map((b, i) => (i !== 0 ? b : {
            ...b,
            fields: b.fields.map((f) => {
              if (f.id !== current.id) return f;
              if (current.part === 'at' && 'region' in f && f.region.type === 'point') {
                return { ...f, region: { type: 'point', at: expression } };
              }
              if ('region' in f && f.region.type === 'interval') {
                return {
                  ...f,
                  region: { ...f.region, [current.part]: expression },
                };
              }
              // Region 'full' que se empieza a arrastrar: pasa a ser un tramo.
              if ('region' in f && f.region.type === 'full') {
                return {
                  ...f,
                  region: current.part === 'start'
                    ? { type: 'interval', start: expression, end: domainEnd }
                    : { type: 'interval', start: '0', end: expression },
                };
              }
              return f;
            }),
          })),
        };
      }
      if (current.target === 'support') {
        return { ...m, supports: m.supports.map((s) => (s.id === current.id ? { ...s, at: expression } : s)) };
      }
      if (current.target === 'boundary') {
        return { ...m, boundaries: m.boundaries.map((b) => (b.id === current.id ? { ...b, at: expression } : b)) };
      }
      return m;
    });
  }, [domainEnd, onChange]);

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    if (!drag) return;
    const { x, y } = pointerAt(event);

    if (drag.target === 'probe') {
      const px = coordinateExpression(fromPx(x));
      const py = coordinateExpression((BEAM_Y - y) / PLANE_PX);
      onChange((m) => ({
        ...m,
        probes: m.probes.map((p) => (p.id === drag.id ? { ...p, at: [px, py, '0'] } : p)),
      }));
      return;
    }

    const t = Math.min(1, Math.max(0, fromPx(x) / L));
    setGhost(t);
    applyPosition(drag, t, !event.altKey);
  }, [drag, pointerAt, fromPx, L, applyPosition, onChange]);

  const endDrag = useCallback(() => { setDrag(null); setGhost(null); }, []);

  const startDrag = (next: Drag) => (event: React.PointerEvent) => {
    event.stopPropagation();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    setDrag(next);
    onSelect({ target: next.target, id: next.id });
  };

  const onCanvasClick = (event: React.PointerEvent) => {
    if (!pending) { onSelect(null); return; }
    const { x } = pointerAt(event);
    onPlace(positionExpression(Math.min(1, Math.max(0, fromPx(x) / L)), domainEnd, !event.altKey));
  };

  const isSelected = (target: Selection['target'], id: string) =>
    selection?.target === target && selection.id === id;

  // ------------------------------------------------------------------ dibujo

  const distributed = body.loads.filter((l) => l.kind === 'distributed' && l.profile);

  const scale = useMemo(() => {
    let peak = 0;
    for (const load of distributed) {
      const f = compile(load.profile!.js);
      for (let i = 0; i <= 60; i += 1) peak = Math.max(peak, Math.abs(f((i / 60) * L, bindings)));
    }
    return peak > 0 ? LOAD_PX / peak : 0;
  }, [distributed, bindings, L]);

  /** Posicion en pixeles, con el arrastre en curso pisando lo derivado. */
  const livePx = (target: Drag['target'], id: string, part: string, derived: number) => {
    if (drag && drag.target === target && drag.id === id && drag.part === part && ghost !== null) {
      return toPx(ghost * L);
    }
    return toPx(derived);
  };

  return (
    <svg
      ref={svgRef}
      className={`canvas${pending ? ' placing' : ''}`}
      viewBox={`0 0 ${W} ${H}`}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onPointerDown={onCanvasClick}
      role="application"
      aria-label="Canvas del modelo"
    >
      <defs>
        <marker id="ar" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
      </defs>

      {distributed.map((load) => {
        const f = compile(load.profile!.js);
        const a = livePx('field', load.id, 'start', value(load.start.js, bindings));
        const b = livePx('field', load.id, 'end', value(load.end.js, bindings));
        const x0 = fromPx(a);
        const x1 = fromPx(b);
        const height = (x: number) => Math.abs(f(x, bindings)) * scale;
        const down = f((x0 + x1) / 2, bindings) <= 0;

        const outline: string[] = [];
        for (let i = 0; i <= 80; i += 1) {
          const x = x0 + ((x1 - x0) * i) / 80;
          outline.push(`${toPx(x).toFixed(1)},${(BEAM_Y - height(x)).toFixed(1)}`);
        }
        const peak = Math.max(...outline.map((p) => BEAM_Y - Number(p.split(',')[1])), 0);

        return (
          <g key={load.id} className={`dist ${module}${isSelected('field', load.id) ? ' sel' : ''}`}>
            <polygon points={`${a},${BEAM_Y} ${outline.join(' ')} ${b},${BEAM_Y}`} />
            <polyline points={outline.join(' ')} />
            {/* Las flechas indican el sentido de aplicacion, que solo tiene
                sentido para una fuerza. Una densidad de carga o una generacion
                de calor son escalares: dibujarles flechas sugiere una direccion
                que el modelo no tiene. */}
            {load.quantity === 'force' && Array.from({ length: 6 }, (_, i) => {
              const x = x0 + ((x1 - x0) * (i + 0.5)) / 6;
              const top = BEAM_Y - height(x);
              if (Math.abs(BEAM_Y - top) < 7) return null;
              return (
                <line key={i} x1={toPx(x)} y1={down ? top : BEAM_Y}
                      x2={toPx(x)} y2={down ? BEAM_Y : top} markerEnd="url(#ar)" />
              );
            })}
            <text x={(a + b) / 2} y={BEAM_Y - peak - 11} textAnchor="middle" className="lab">
              {load.label}
            </text>
            {(['start', 'end'] as const).map((part) => (
              <circle
                key={part}
                className="handle"
                cx={part === 'start' ? a : b}
                cy={BEAM_Y}
                r={7}
                onPointerDown={startDrag({ target: 'field', id: load.id, part })}
              />
            ))}
          </g>
        );
      })}

      {body.loads.filter((l) => l.kind === 'point').map((load) => {
        const at = livePx('field', load.id, 'at', value(load.start.js, bindings));
        const magnitude = load.magnitude ? value(load.magnitude.js, bindings) : 1;

        // Una fuerza tiene sentido de aplicacion y se dibuja como flecha. Una
        // carga o una fuente de calor concentradas son escalares: se dibujan
        // como lo que son, con su signo, sin insinuar una direccion.
        if (load.quantity !== 'force') {
          const sign = magnitude >= 0 ? '+' : '−';
          return (
            <g key={load.id}
               className={`scalar-pt ${magnitude >= 0 ? 'pos' : 'neg'}${isSelected('field', load.id) ? ' sel' : ''}`}
               onPointerDown={startDrag({ target: 'field', id: load.id, part: 'at' })}>
              <circle cx={at} cy={BEAM_Y} r={11} />
              <text x={at} y={BEAM_Y + 5} textAnchor="middle" className="glyph">{sign}</text>
              <text x={at} y={BEAM_Y - 20} textAnchor="middle" className="lab">{load.label}</text>
              <circle className="handle" cx={at} cy={BEAM_Y - 30} r={7} />
            </g>
          );
        }

        const down = magnitude >= 0;
        const y0 = BEAM_Y - (down ? 68 : -68);
        return (
          <g key={load.id} className={`pt${isSelected('field', load.id) ? ' sel' : ''}`}
             onPointerDown={startDrag({ target: 'field', id: load.id, part: 'at' })}>
            <line x1={at} y1={y0} x2={at} y2={BEAM_Y} markerEnd="url(#ar)" />
            <circle className="handle" cx={at} cy={y0} r={7} />
            <text x={at} y={y0 - 11} textAnchor="middle" className="lab">{load.label}</text>
          </g>
        );
      })}

      {body.loads.filter((l) => l.kind === 'couple').map((load) => {
        const at = livePx('field', load.id, 'at', value(load.start.js, bindings));
        return (
          <g key={load.id} className={`cpl${isSelected('field', load.id) ? ' sel' : ''}`}
             onPointerDown={startDrag({ target: 'field', id: load.id, part: 'at' })}>
            <path d={`M ${at - 25} ${BEAM_Y - 6} A 25 25 0 1 1 ${at + 25} ${BEAM_Y - 6}`}
                  markerEnd="url(#ar)" />
            <circle className="handle" cx={at} cy={BEAM_Y - 31} r={7} />
            <text x={at} y={BEAM_Y - 44} textAnchor="middle" className="lab">{load.label}</text>
          </g>
        );
      })}

      <line x1={toPx(0)} y1={BEAM_Y} x2={toPx(L)} y2={BEAM_Y}
            className={`beam ${module}`} />

      {body.supports?.map((support) => {
        const at = livePx('support', support.id, 'at', value(support.at.js, bindings));
        return (
          <g key={support.id} className={`support${isSelected('support', support.id) ? ' sel' : ''}`}
             onPointerDown={startDrag({ target: 'support', id: support.id, part: 'at' })}>
            {support.type === 'fixed' ? (
              <>
                <line x1={at} y1={BEAM_Y - 29} x2={at} y2={BEAM_Y + 29} className="wall" />
                {[-22, -11, 0, 11, 22].map((dy) => (
                  <line key={dy} x1={at} y1={BEAM_Y + dy} x2={at - 12} y2={BEAM_Y + dy + 10} />
                ))}
              </>
            ) : (
              <>
                <polygon points={`${at},${BEAM_Y} ${at - 14},${BEAM_Y + 23} ${at + 14},${BEAM_Y + 23}`} />
                {support.type === 'roller' && (
                  <>
                    <circle cx={at - 7.5} cy={BEAM_Y + 28} r={4.5} />
                    <circle cx={at + 7.5} cy={BEAM_Y + 28} r={4.5} />
                  </>
                )}
              </>
            )}
            <text x={at} y={BEAM_Y + 50} textAnchor="middle" className="lab">{support.id}</text>
          </g>
        );
      })}

      {body.boundaries?.map((boundary) => {
        const at = livePx('boundary', boundary.id, 'at', value(boundary.at.js, bindings));
        const glyph = { temperature: 'T', flux: 'Q', convection: 'h', insulated: '//' }[boundary.type];
        return (
          <g key={boundary.id}
             className={`bc bc-${boundary.type}${isSelected('boundary', boundary.id) ? ' sel' : ''}`}
             onPointerDown={startDrag({ target: 'boundary', id: boundary.id, part: 'at' })}>
            <line x1={at} y1={BEAM_Y - 22} x2={at} y2={BEAM_Y + 22} />
            <rect x={at - 13} y={BEAM_Y + 24} width={26} height={20} rx={3} />
            <text x={at} y={BEAM_Y + 38} textAnchor="middle" className="glyph">{glyph}</text>
            <text x={at} y={BEAM_Y + 58} textAnchor="middle" className="lab">{boundary.id}</text>
          </g>
        );
      })}

      {body.probes?.map((probe) => {
        const px = toPx(value(probe.at[0].js, bindings));
        const py = BEAM_Y - value(probe.at[1].js, bindings) * PLANE_PX;
        return (
          <g key={probe.id} className={`probe${isSelected('probe', probe.id) ? ' sel' : ''}`}
             onPointerDown={startDrag({ target: 'probe', id: probe.id, part: 'xy' })}>
            <line x1={px} y1={BEAM_Y} x2={px} y2={py} className="lead" />
            <circle cx={px} cy={py} r={7} className="handle" />
            <text x={px + 12} y={py + 4} className="lab">{probe.label}</text>
          </g>
        );
      })}

      <line x1={toPx(0)} y1={BEAM_Y + 74} x2={toPx(L)} y2={BEAM_Y + 74} className="dim" />
      <text x={toPx(L / 2)} y={BEAM_Y + 90} textAnchor="middle" className="lab">
        {domainEnd} = {L} m
      </text>

      {ghost !== null && (
        <g className="ghost">
          <line x1={toPx(ghost * L)} y1={BEAM_Y - 105} x2={toPx(ghost * L)} y2={BEAM_Y + 40} />
          <text x={toPx(ghost * L)} y={BEAM_Y - 112} textAnchor="middle">
            {positionLabel(positionExpression(ghost, domainEnd))}
          </text>
        </g>
      )}
    </svg>
  );
}
