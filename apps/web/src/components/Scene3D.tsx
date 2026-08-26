import { useCallback, useMemo, useRef, useState } from 'react';
import type { DerivedBody, ProblemModel } from '@wf/schema';

import { value } from '../lib/evaluate';
import { evalExpr } from '../lib/evalexpr';
import { capture, type CanvasMode, type Selection } from './WorldCanvas';

export interface Orbit {
  yaw: number;
  pitch: number;
  /** Pixeles por metro. */
  scale: number;
  /** Centro de la escena, en metros. */
  center: [number, number, number];
}

export const DEFAULT_ORBIT: Orbit = {
  yaw: -0.6, pitch: 0.5, scale: 70, center: [2, 0, 0],
};

interface Props {
  bodies: DerivedBody[];
  model: ProblemModel;
  bindings: Record<string, number>;
  selection: Selection | null;
  onSelect: (selection: Selection | null) => void;
  onChange: (update: (model: ProblemModel) => ProblemModel) => void;
  pending: string | null;
  pendingTarget: string | null;
  onPlace: (place: { at: [number, number, number]; bodyId?: string; parameter?: string }) => void;
  orbit: Orbit;
  onOrbit: (orbit: Orbit) => void;
  showReactions: boolean;
  /** Que hace un dedo sobre un cuerpo. Mismo selector que en 2D. */
  mode?: CanvasMode;
  interactive?: boolean;
}

const W = 900;
const H = 540;

type P3 = [number, number, number];

/**
 * Escena 3D sin dependencias.
 *
 * Proyeccion ortografica y orden por profundidad (algoritmo del pintor). Para
 * un sistema de barras y flechas eso alcanza de sobra, y evita meter una
 * libreria de 3D entera para dibujar segmentos.
 *
 * Se construye sobre el **plano de piso** (y = 0): un clic en pantalla es un
 * rayo, y hace falta una superficie donde apoyarlo. Es el mismo idioma que usa
 * cualquier CAD, y la altura se ajusta despues desde el inspector.
 */
export function Scene3D({
  bodies, model, bindings, selection, onSelect, onChange,
  pending, pendingTarget, onPlace, orbit, onOrbit, showReactions,
  mode = 'move', interactive = true,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ kind: 'orbit' | 'body'; id?: string; from: [number, number] } | null>(null);

  /** Mundo -> pantalla, con profundidad para ordenar. */
  const project = useCallback((p: P3) => {
    const [cx, cy, cz] = orbit.center;
    const x = p[0] - cx;
    const y = p[1] - cy;
    const z = p[2] - cz;

    const cosYaw = Math.cos(orbit.yaw);
    const sinYaw = Math.sin(orbit.yaw);
    const rx = x * cosYaw + z * sinYaw;
    const rz = -x * sinYaw + z * cosYaw;

    const cosPitch = Math.cos(orbit.pitch);
    const sinPitch = Math.sin(orbit.pitch);
    const ry = y * cosPitch - rz * sinPitch;
    const depth = y * sinPitch + rz * cosPitch;

    return { x: W / 2 + rx * orbit.scale, y: H / 2 - ry * orbit.scale, depth };
  }, [orbit]);

  /**
   * Pantalla -> punto del plano de piso.
   *
   * Se invierte la proyeccion con y = 0 impuesto: es la unica forma de que un
   * clic (que es un rayo) tenga un punto definido.
   */
  const toGround = useCallback((sx: number, sy: number): P3 => {
    const [cx, cy, cz] = orbit.center;
    const rx = (sx - W / 2) / orbit.scale;
    const screenY = (H / 2 - sy) / orbit.scale;

    // Con y = 0 en el mundo: ry = -cy*cos(pitch) - rz*sin(pitch) = screenY.
    const cosPitch = Math.cos(orbit.pitch);
    const sinPitch = Math.sin(orbit.pitch);
    if (Math.abs(sinPitch) < 1e-6) return [cx, 0, cz];
    const rz = (-cy * cosPitch - screenY) / sinPitch;

    const cosYaw = Math.cos(orbit.yaw);
    const sinYaw = Math.sin(orbit.yaw);
    const x = rx * cosYaw - rz * sinYaw;
    const z = rx * sinYaw + rz * cosYaw;
    return [x + cx, 0, z + cz];
  }, [orbit]);

  const pointerAt = useCallback((event: React.PointerEvent): [number, number] => {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return [0, 0];
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(matrix.inverse());
    return [local.x, local.y];
  }, []);

  const placed = useMemo(() => model.bodies.map((body) => {
    const embedding = body.domain.embedding;
    const straight = embedding.type === 'straight';
    const origin: P3 = straight
      ? [evalExpr(embedding.origin[0] as unknown as string, bindings),
         evalExpr(embedding.origin[1] as unknown as string, bindings),
         evalExpr(embedding.origin[2] as unknown as string, bindings)]
      : [0, 0, 0];
    const raw: P3 = straight
      ? [evalExpr(embedding.direction[0] as unknown as string, bindings, 1),
         evalExpr(embedding.direction[1] as unknown as string, bindings),
         evalExpr(embedding.direction[2] as unknown as string, bindings)]
      : [1, 0, 0];
    const magnitude = Math.hypot(...raw) || 1;
    const axis: P3 = [raw[0] / magnitude, raw[1] / magnitude, raw[2] / magnitude];
    const length = evalExpr(body.domain.end, bindings, 1) || 1;
    // Transversal: perpendicular al eje dentro del plano vertical que lo contiene.
    const horizontal = Math.hypot(axis[0], axis[2]) || 1;
    const perp: P3 = [
      (-axis[0] * axis[1]) / horizontal,
      horizontal,
      (-axis[2] * axis[1]) / horizontal,
    ];
    return {
      body,
      derived: bodies.find((d) => d.body_id === body.id),
      origin, axis, perp, length,
      at: (t: number): P3 => [
        origin[0] + axis[0] * t, origin[1] + axis[1] * t, origin[2] + axis[2] * t,
      ],
    };
  }), [model.bodies, bodies, bindings]);

  // --------------------------------------------------------------- primitivas

  interface Piece { depth: number; node: React.ReactNode }
  const pieces: Piece[] = [];
  const push = (depth: number, node: React.ReactNode) => pieces.push({ depth, node });

  const segment = (a: P3, b: P3, className: string, key: string, onDown?: (e: React.PointerEvent) => void) => {
    const pa = project(a);
    const pb = project(b);
    push((pa.depth + pb.depth) / 2, (
      <line key={key} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} className={className}
            onPointerDown={onDown} />
    ));
  };

  const arrow = (from: P3, to: P3, className: string, key: string, label?: string) => {
    const pa = project(from);
    const pb = project(to);
    push((pa.depth + pb.depth) / 2, (
      <g key={key} className={className}>
        <line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} markerEnd="url(#ar3)" />
        {label && <text x={pb.x} y={pb.y - 6} textAnchor="middle">{label}</text>}
      </g>
    ));
  };

  // Piso: da referencia de escala y de donde se apoya lo que uno pone.
  const extent = 6;
  for (let i = -extent; i <= extent; i += 1) {
    const shade = i === 0 ? 'axis3' : 'grid3';
    segment([i, 0, -extent], [i, 0, extent], shade, `gx${i}`);
    segment([-extent, 0, i], [extent, 0, i], shade, `gz${i}`);
  }

  for (const spot of placed) {
    const { body, derived, origin, axis, perp, length, at } = spot;
    const selected = selection?.target === 'body' && selection.id === body.id;

    const grab = interactive ? (event: React.PointerEvent) => {
        if (pending || mode === 'pan') return;
        event.stopPropagation();
        onSelect({ target: 'body', id: body.id });
        // En modo tocar el arrastre gira la escena: mover un cuerpo por el piso
        // con el dedo, mientras se busca el angulo desde donde mirarlo, es
        // justo lo que uno no queria hacer.
        if (mode === 'move') setDrag({ kind: 'body', id: body.id, from: pointerAt(event) });
      } : undefined;

    // Las figuras rigidas se dibujan con su forma. Un disco proyectado es una
    // elipse; se aproxima con un circulo del radio proyectado, que para armar
    // y mirar alcanza y no cuesta una libreria de 3D.
    const klass = `shape3 ${body.type}${selected ? ' sel' : ''}`;
    if (body.type === 'disc' || body.type === 'sphere') {
      const c = project(origin);
      const rim = project(at(length));
      push(c.depth, (
        <circle key={`b${body.id}`} className={klass} cx={c.x} cy={c.y}
                r={Math.max(3, Math.hypot(rim.x - c.x, rim.y - c.y))}
                onPointerDown={grab} />
      ));
    } else if (body.type === 'block') {
      const height = evalExpr(body.shape?.height ?? '', bindings, 0.6);
      const up = (q: P3): P3 => [q[0], q[1] + height, q[2]];
      const corners = [origin, at(length), up(at(length)), up(origin)].map(project);
      push(Math.min(...corners.map((q) => q.depth)), (
        <polygon key={`b${body.id}`} className={klass} onPointerDown={grab}
                 points={corners.map((q) => `${q.x},${q.y}`).join(' ')} />
      ));
    } else {
      segment(origin, at(length),
        body.type === 'ideal_cable' || body.type === 'spring' || body.type === 'rod'
          ? klass : `beam3${selected ? ' sel' : ''}`,
        `b${body.id}`, grab);
    }

    const mid = project(at(length / 2));
    push(mid.depth, (
      <text key={`n${body.id}`} x={mid.x} y={mid.y + 20} textAnchor="middle" className="lab3">
        {body.name || body.id}
      </text>
    ));

    // Cargas: puntuales como flecha, distribuidas como una fila de flechas.
    for (const field of body.fields) {
      if (field.kind === 'thermal') continue;
      const direction: P3 = 'direction' in field
        ? [evalExpr(field.direction.vector[0] as unknown as string, bindings),
           evalExpr(field.direction.vector[1] as unknown as string, bindings, -1),
           evalExpr(field.direction.vector[2] as unknown as string, bindings)]
        : [perp[0], perp[1], perp[2]];
      const norm = Math.hypot(...direction) || 1;
      const unit: P3 = [direction[0] / norm, direction[1] / norm, direction[2] / norm];
      const reach = 0.55;

      if (field.region.type === 'point') {
        const t = evalExpr(field.region.at, bindings);
        const tip = at(t);
        arrow([tip[0] - unit[0] * reach, tip[1] - unit[1] * reach, tip[2] - unit[2] * reach],
              tip, 'load3', `f${body.id}${field.id}`, field.label || field.id);
        continue;
      }
      const a = field.region.type === 'interval' ? evalExpr(field.region.start, bindings) : 0;
      const b = field.region.type === 'interval'
        ? evalExpr(field.region.end, bindings, length) : length;
      for (let i = 0; i <= 5; i += 1) {
        const t = a + ((b - a) * i) / 5;
        const tip = at(t);
        arrow([tip[0] - unit[0] * reach, tip[1] - unit[1] * reach, tip[2] - unit[2] * reach],
              tip, 'load3', `f${body.id}${field.id}${i}`,
              i === 2 ? (field.label || field.id) : undefined);
      }
    }

    for (const support of model.supports.filter((s) => s.body_id === body.id)) {
      const t = evalExpr(support.at, bindings);
      const p = at(t);
      const base: P3 = [p[0], p[1] - 0.32, p[2]];
      const pp = project(p);
      const pb = project(base);
      push(Math.min(pp.depth, pb.depth), (
        <g key={`s${support.id}`} className="support3"
           onPointerDown={interactive && !pending ? (event) => {
             event.stopPropagation();
             onSelect({ target: 'support', id: support.id, bodyId: body.id });
           } : undefined}>
          <polygon points={`${pp.x},${pp.y} ${pb.x - 11},${pb.y} ${pb.x + 11},${pb.y}`} />
          <text x={pp.x} y={pb.y + 14} textAnchor="middle">{support.id}</text>
        </g>
      ));
    }

    if (showReactions) {
      for (const reaction of derived?.reaction_arrows ?? []) {
        const magnitude = value(reaction.value.js, bindings);
        if (!Number.isFinite(magnitude) || magnitude === 0) continue;
        if (reaction.component === 'moment') continue;
        const t = value(reaction.at.js, bindings);
        const base = at(t);
        const dir = reaction.component === 'axial' ? axis : perp;
        const sign = magnitude >= 0 ? 1 : -1;
        arrow(base, [base[0] + dir[0] * 0.6 * sign, base[1] + dir[1] * 0.6 * sign,
                     base[2] + dir[2] * 0.6 * sign],
              'reaction3', `r${reaction.id}`, reaction.id);
      }
    }
  }

  for (const probe of model.probes) {
    const p: P3 = [
      evalExpr(probe.at[0] as unknown as string, bindings),
      evalExpr(probe.at[1] as unknown as string, bindings),
      evalExpr(probe.at[2] as unknown as string, bindings),
    ];
    const s = project(p);
    push(s.depth, (
      <g key={`p${probe.id}`} className="probe3">
        <circle cx={s.x} cy={s.y} r={6} />
        <text x={s.x + 10} y={s.y + 4}>{probe.label || probe.id}</text>
      </g>
    ));
  }

  pieces.sort((a, b) => a.depth - b.depth);

  // ------------------------------------------------------------------ eventos

  /** Los dedos apoyados. Dos son gesto de vista: pellizcar acerca. */
  const pointers = useRef(new Map<number, [number, number]>());
  const pinch = useRef<number | null>(null);

  const twoFingers = () => pointers.current.size >= 2;
  const spread = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (!interactive) return;
    const [sx, sy] = pointerAt(event);
    pointers.current.set(event.pointerId, [sx, sy]);
    capture(event);
    if (twoFingers()) {
      setDrag(null);
      pinch.current = spread();
      return;
    }
    if (pending) {
      const world = toGround(sx, sy);
      if (pendingTarget === 'body' || pendingTarget === 'probe') onPlace({ at: world });
      // Colgar algo de un cuerpo en 3D pide apuntar al cuerpo, no al piso: por
      // ahora eso se hace en la vista 2D, que es donde el clic es inequivoco.
      return;
    }
    onSelect(null);
    setDrag({ kind: 'orbit', from: [sx, sy] });
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const [sx, sy] = pointerAt(event);
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, [sx, sy]);

    if (twoFingers()) {
      // Sin rueda no hay otra forma de acercarse en una tablet.
      const now = spread();
      const before = pinch.current;
      pinch.current = now;
      if (before && before > 0) {
        onOrbit({
          ...orbit,
          scale: Math.max(10, Math.min(400, orbit.scale * (now / before))),
        });
      }
      return;
    }

    if (!drag) return;
    if (drag.kind === 'orbit') {
      onOrbit({
        ...orbit,
        yaw: orbit.yaw + (sx - drag.from[0]) * 0.008,
        pitch: Math.max(0.08, Math.min(1.5, orbit.pitch + (sy - drag.from[1]) * 0.006)),
      });
      setDrag({ ...drag, from: [sx, sy] });
      return;
    }
    const before = toGround(drag.from[0], drag.from[1]);
    const after = toGround(sx, sy);
    onChange((m) => ({
      ...m,
      bodies: m.bodies.map((b) => {
        if (b.id !== drag.id || b.domain.embedding.type !== 'straight') return b;
        const o = b.domain.embedding.origin as unknown as [string, string, string];
        return {
          ...b,
          domain: {
            ...b.domain,
            embedding: {
              ...b.domain.embedding,
              origin: [
                (evalExpr(o[0], bindings) + after[0] - before[0]).toFixed(2),
                o[1],
                (evalExpr(o[2], bindings) + after[2] - before[2]).toFixed(2),
              ],
            },
          },
        };
      }),
    }));
    setDrag({ ...drag, from: [sx, sy] });
  };

  const endPointer = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId);
    if (!twoFingers()) pinch.current = null;
    setDrag(null);
  };

  return (
    <svg
      ref={svgRef}
      className={`canvas scene3${pending ? ' placing' : ''}`}
      viewBox={`0 0 ${W} ${H}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onWheel={(event) => interactive && onOrbit({
        ...orbit,
        scale: Math.max(10, Math.min(400, orbit.scale * Math.exp(-event.deltaY * 0.0015))),
      })}
      role="application"
      aria-label="Escena 3D del sistema"
    >
      <defs>
        <marker id="ar3" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
      </defs>
      {pieces.map((piece) => piece.node)}
      <text x={10} y={16} className="lab3">
        arrastra para girar · rueda o dos dedos: zoom · se construye sobre el piso (y = 0)
      </text>
      {placed.length === 0 && (
        <text x={W / 2} y={H / 2} textAnchor="middle" className="lab3">
          Elegi un cuerpo de la paleta y hace clic en el piso
        </text>
      )}
    </svg>
  );
}
