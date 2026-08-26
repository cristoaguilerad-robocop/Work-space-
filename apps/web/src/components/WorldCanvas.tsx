import { useCallback, useMemo, useRef, useState } from 'react';
import type { Body, DerivedBody, MechanicalLoad, ProblemModel, ScalarSource } from '@wf/schema';

import { compile, value } from '../lib/evaluate';
import { evalExpr } from '../lib/evalexpr';
import { coordinateExpression, positionExpression, positionLabel } from '../lib/symbolic';
import type { Module } from '../lib/elements';

export interface Selection {
  target: 'body' | 'field' | 'support' | 'boundary' | 'probe';
  id: string;
  /** Cuerpo al que pertenece, cuando el elemento vive dentro de uno. */
  bodyId?: string;
}

export interface View {
  /** Centro de la vista, en metros. */
  cx: number;
  cy: number;
  /** Pixeles por metro. */
  scale: number;
}

export const DEFAULT_VIEW: View = { cx: 2, cy: 0.2, scale: 95 };

interface Props {
  bodies: DerivedBody[];
  model: ProblemModel;
  module: Module;
  bindings: Record<string, number>;
  selection: Selection | null;
  onSelect: (selection: Selection | null) => void;
  onChange: (update: (model: ProblemModel) => ProblemModel) => void;
  onBinding?: (name: string, value: number) => void;
  pending: string | null;
  pendingTarget: string | null;
  onPlace: (place: { at: Vec; bodyId?: string; parameter?: string }) => void;
  view: View;
  onView: (view: View) => void;
  showReactions: boolean;
  /** Que hace un dedo (o el mouse) sobre un elemento. Ver `CanvasMode`. */
  mode?: CanvasMode;
  /** Si las posiciones enganchan a fracciones del dominio. Alt lo invierte. */
  snap?: boolean;
  /** Modo 1D: los cuerpos viven sobre el eje horizontal y no se giran. */
  lockToAxis?: boolean;
  interactive?: boolean;
}

/**
 * Que significa arrastrar.
 *
 * En un mouse el modo casi no importa: se ve el cursor, se apunta fino y se
 * puede soltar sin querer. En una tablet si: el dedo tapa lo que toca, y un
 * arrastre que queria mover la vista termina moviendo una carga. Por eso el
 * modo es explicito y se elige antes, como en cualquier herramienta de dibujo.
 *
 * - `select`: tocar elige; arrastrar mueve la VISTA, nunca el elemento.
 * - `move`:   arrastrar mueve el elemento tocado.
 * - `pan`:    todo mueve la vista; nada se selecciona ni se modifica.
 */
export type CanvasMode = 'select' | 'move' | 'pan';

/** Zoom minimo y maximo, en pixeles por metro. */
const MIN_SCALE = 8;
const MAX_SCALE = 800;

const W = 900;
const H = 520;
/** Alto maximo del dibujo de una carga, en pixeles. */
const LOAD_PX = 64;
/** Angulos a los que engancha la rotacion, en grados. */
const ANGLE_SNAP = 15;
/** Que tan cerca hay que hacer clic de un cuerpo para colgarle algo, en pixeles. */
const PICK_PX = 34;

export type Vec = [number, number];

/**
 * Retiene el puntero en el elemento que empezo el gesto.
 *
 * Sin esto, mover el dedo fuera del canvas -- o soltarlo sobre otro elemento --
 * corta el arrastre a la mitad. Puede fallar (un puntero que el navegador ya
 * dio por terminado), y fallar aca no vale romper el gesto entero.
 */
export function capture(event: React.PointerEvent): void {
  try {
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  } catch {
    // Sin captura el arrastre sigue funcionando mientras el dedo no se salga.
  }
}


const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]];
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k];
const norm = (a: Vec) => Math.hypot(a[0], a[1]);

interface Placed {
  body: Body;
  /** Lo que el motor calculo para este cuerpo, si es que pudo. */
  derived?: DerivedBody;
  origin: Vec;
  axis: Vec;
  /** Perpendicular al eje: hacia donde se dibujan las cargas transversales. */
  perp: Vec;
  length: number;
  at: (t: number) => Vec;
}

type Drag =
  | { kind: 'pan'; from: Vec }
  | { kind: 'body'; id: string; grab: Vec }
  | { kind: 'body-end'; id: string }
  | { kind: 'element'; target: Selection['target']; id: string; bodyId: string; part: string }
  | { kind: 'probe'; id: string };

type FieldSpec = MechanicalLoad | ScalarSource;

/**
 * Canvas del mundo: varios cuerpos, puestos y orientados donde uno quiera.
 *
 * Dibuja **el modelo**, no lo derivado. Es la diferencia entre una herramienta
 * para armar y una para mirar: una viga recien puesta todavia no tiene
 * solucion -- le faltan los apoyos -- y sin embargo hay que verla, porque es
 * encima de ella que se ponen esos apoyos. Lo que el motor calcula (el perfil
 * exacto de una carga, la curva de un cable, las reacciones) entra como capa
 * de resultados cuando esta disponible.
 */
export function WorldCanvas({
  bodies, model, module, bindings, selection, onSelect, onChange, onBinding,
  pending, pendingTarget, onPlace, view, onView, showReactions,
  mode = 'move', snap = true, lockToAxis = false, interactive = true,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [ghost, setGhost] = useState<string | null>(null);

  const toScreen = useCallback(
    (p: Vec): Vec => [(p[0] - view.cx) * view.scale + W / 2, H / 2 - (p[1] - view.cy) * view.scale],
    [view],
  );
  const toWorld = useCallback(
    (p: Vec): Vec => [(p[0] - W / 2) / view.scale + view.cx, view.cy - (p[1] - H / 2) / view.scale],
    [view],
  );

  const pointerAt = useCallback((event: React.PointerEvent): Vec => {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return [0, 0];
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(matrix.inverse());
    return [local.x, local.y];
  }, []);

  const placed: Placed[] = useMemo(() => model.bodies.map((body) => {
    const embedding = body.domain.embedding;
    const straight = embedding.type === 'straight';
    const origin: Vec = straight
      ? [evalExpr(embedding.origin[0] as unknown as string, bindings),
         evalExpr(embedding.origin[1] as unknown as string, bindings)]
      : [0, 0];
    const raw: Vec = straight
      ? [evalExpr(embedding.direction[0] as unknown as string, bindings, 1),
         evalExpr(embedding.direction[1] as unknown as string, bindings)]
      : [1, 0];
    const magnitude = norm(raw) || 1;
    const axis = mul(raw, 1 / magnitude);
    const length = evalExpr(body.domain.end, bindings, 1) || 1;
    return {
      body,
      derived: bodies.find((d) => d.body_id === body.id),
      origin, axis, perp: [-axis[1], axis[0]] as Vec, length,
      at: (t: number) => add(origin, mul(axis, t)),
    };
  }), [model.bodies, bodies, bindings]);

  /** Cuerpo mas cercano al punto, si esta lo bastante cerca para contar. */
  const nearestBody = useCallback((world: Vec) => {
    let best: { spot: Placed; t: number; distance: number } | null = null;
    for (const spot of placed) {
      const rel = sub(world, spot.origin);
      const t = Math.max(0, Math.min(spot.length, rel[0] * spot.axis[0] + rel[1] * spot.axis[1]));
      const distance = norm(sub(world, spot.at(t)));
      if (!best || distance < best.distance) best = { spot, t, distance };
    }
    if (!best || best.distance > PICK_PX / view.scale) return null;
    return best;
  }, [placed, view.scale]);

  // ------------------------------------------------------------------ edicion

  // En 1D los cuerpos se deslizan sobre el eje: la altura no es un grado de
  // libertad del problema, es una coincidencia de como se dibujo.
  const moveBody = (id: string, raw: Vec) => {
    const delta: Vec = lockToAxis ? [raw[0], 0] : raw;
    return applyMove(id, delta);
  };

  const applyMove = (id: string, delta: Vec) => onChange((m) => ({
    ...m,
    bodies: m.bodies.map((b) => {
      if (b.id !== id || b.domain.embedding.type !== 'straight') return b;
      const o = b.domain.embedding.origin as unknown as [string, string, string];
      return {
        ...b,
        domain: {
          ...b.domain,
          embedding: {
            ...b.domain.embedding,
            origin: [
              coordinateExpression(evalExpr(o[0], bindings) + delta[0]),
              coordinateExpression(evalExpr(o[1], bindings) + delta[1]),
              o[2],
            ],
          },
        },
      };
    }),
  }));

  /**
   * Girar y estirar un cuerpo desde su extremo libre.
   *
   * La direccion se escribe como numero, pero el largo NO: si el dominio
   * termina en un simbolo suelto, lo que cambia es el *valor* de ese simbolo.
   * Asi estirar un cuerpo sigue siendo valorizar y no reemplaza el planteo
   * parametrico por una cuenta.
   */
  const reshapeBody = (id: string, endpoint: Vec, snap: boolean) => {
    const spot = placed.find((p) => p.body.id === id);
    if (!spot) return;

    const delta = sub(endpoint, spot.origin);
    // En 1D el largo es la proyeccion sobre el eje, no la distancia al dedo:
    // con la distancia, levantar el dedo del eje estiraria el cuerpo -- se ve
    // como si girara -- y arrastrarlo hacia atras lo daria vuelta. En una sola
    // dimension eso no existe.
    const distance = lockToAxis ? delta[0] : norm(delta);
    if (distance < 0.05) return;

    let angle = lockToAxis ? 0 : Math.atan2(delta[1], delta[0]);
    if (snap && !lockToAxis) {
      const step = (ANGLE_SNAP * Math.PI) / 180;
      angle = Math.round(angle / step) * step;
    }

    onChange((m) => ({
      ...m,
      bodies: m.bodies.map((b) => (b.id !== id || b.domain.embedding.type !== 'straight' ? b : {
        ...b,
        domain: {
          ...b.domain,
          embedding: {
            ...b.domain.embedding,
            direction: [
              coordinateExpression(Math.cos(angle)),
              coordinateExpression(Math.sin(angle)),
              '0',
            ],
          },
        },
      })),
    }));

    const end = spot.body.domain.end.trim();
    if (onBinding && /^[A-Za-z][A-Za-z0-9_]*$/.test(end)) {
      onBinding(end, Number(distance.toFixed(3)));
    }
    setGhost(`${end} = ${distance.toFixed(2)} m · ${((angle * 180) / Math.PI).toFixed(0)}°`);
  };

  const setParametric = (
    target: Selection['target'], id: string, bodyId: string, part: string,
    t: number, snap: boolean,
  ) => {
    const spot = placed.find((p) => p.body.id === bodyId);
    if (!spot) return;
    const expression = positionExpression(t / spot.length, spot.body.domain.end, snap);
    setGhost(positionLabel(expression));

    onChange((m) => {
      if (target === 'field') {
        return {
          ...m,
          bodies: m.bodies.map((b) => (b.id !== bodyId ? b : {
            ...b,
            fields: b.fields.map((f) => {
              if (f.id !== id || !('region' in f)) return f;
              if (part === 'at' && f.region.type === 'point') {
                return { ...f, region: { type: 'point', at: expression } };
              }
              if (f.region.type === 'interval') {
                return { ...f, region: { ...f.region, [part]: expression } };
              }
              if (f.region.type === 'full') {
                return {
                  ...f,
                  region: part === 'start'
                    ? { type: 'interval', start: expression, end: b.domain.end }
                    : { type: 'interval', start: '0', end: expression },
                };
              }
              return f;
            }),
          })),
        };
      }
      if (target === 'support') {
        return { ...m, supports: m.supports.map((s) => (s.id === id ? { ...s, at: expression } : s)) };
      }
      if (target === 'boundary') {
        return { ...m, boundaries: m.boundaries.map((b) => (b.id === id ? { ...b, at: expression } : b)) };
      }
      return m;
    });
  };

  // ------------------------------------------------------------------ punteros

  /**
   * Los dedos que estan tocando ahora mismo.
   *
   * Con dos, el gesto es de vista -- pellizcar para acercar, arrastrar para
   * mover -- y cualquier arrastre de elemento que estuviera en curso se
   * cancela. Sin esto, apoyar el segundo dedo mueve la carga que sostenia el
   * primero.
   */
  const pointers = useRef(new Map<number, Vec>());
  const pinch = useRef<{ distance: number; center: Vec } | null>(null);
  /** Si el gesto que esta llegando al canvas ya paso por un elemento. */
  const hitElement = useRef(false);

  /** Acerca dejando quieto el punto del mundo que esta bajo el dedo. */
  const zoomAbout = (screen: Vec, factor: number) => {
    const anchor = toWorld(screen);
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, view.scale * factor));
    onView({
      scale,
      cx: anchor[0] - (screen[0] - W / 2) / scale,
      cy: anchor[1] + (screen[1] - H / 2) / scale,
    });
  };

  const twoFingers = (): boolean => pointers.current.size >= 2;

  const gesture = () => {
    const [a, b] = [...pointers.current.values()];
    return { distance: norm(sub(a, b)), center: mul(add(a, b), 0.5) };
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (!interactive) return;
    const screen = pointerAt(event);
    const world = toWorld(screen);
    pointers.current.set(event.pointerId, screen);
    capture(event);

    if (twoFingers()) {
      // Dos dedos son siempre gesto de vista: se abandona lo que se estuviera
      // arrastrando, y no se coloca nada aunque haya herramienta armada.
      setDrag(null);
      setGhost(null);
      pinch.current = gesture();
      return;
    }

    if (pending) {
      if (pendingTarget === 'body' || pendingTarget === 'probe') {
        onPlace({ at: lockToAxis ? [world[0], 0] : world });
      } else {
        const hit = nearestBody(world);
        if (hit) {
          onPlace({
            at: world,
            bodyId: hit.spot.body.id,
            parameter: positionExpression(
              hit.t / hit.spot.length, hit.spot.body.domain.end, snap !== event.altKey,
            ),
          });
        }
      }
      return;
    }

    // El fondo deselecciona; un elemento, no: en modo tocar el evento llega
    // igual hasta aca despues de haber elegido algo.
    if (hitElement.current) hitElement.current = false;
    else onSelect(null);
    setDrag({ kind: 'pan', from: screen });
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const screen = pointerAt(event);
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, screen);

    if (twoFingers()) {
      const now = gesture();
      const before = pinch.current;
      pinch.current = now;
      if (before && before.distance > 0) {
        const moved = sub(now.center, before.center);
        onView({
          ...view,
          cx: view.cx - moved[0] / view.scale,
          cy: view.cy + moved[1] / view.scale,
        });
        // El zoom se aplica despues del desplazamiento, anclado al centro del
        // pellizco: asi el punto que uno pellizca no se le escapa de los dedos.
        zoomAbout(now.center, now.distance / before.distance);
      }
      return;
    }

    if (!drag) return;
    const world = toWorld(screen);

    if (drag.kind === 'pan') {
      const delta = sub(screen, drag.from);
      onView({ ...view, cx: view.cx - delta[0] / view.scale, cy: view.cy + delta[1] / view.scale });
      setDrag({ kind: 'pan', from: screen });
      return;
    }
    if (drag.kind === 'body') {
      moveBody(drag.id, sub(world, drag.grab));
      setDrag({ ...drag, grab: world });
      return;
    }
    if (drag.kind === 'body-end') { reshapeBody(drag.id, world, snap !== event.altKey); return; }
    if (drag.kind === 'probe') {
      onChange((m) => ({
        ...m,
        probes: m.probes.map((p) => (p.id !== drag.id ? p : {
          ...p, at: [coordinateExpression(world[0]), coordinateExpression(world[1]), '0'],
        })),
      }));
      return;
    }

    const spot = placed.find((p) => p.body.id === drag.bodyId);
    if (!spot) return;
    const rel = sub(world, spot.origin);
    const t = Math.max(0, Math.min(spot.length, rel[0] * spot.axis[0] + rel[1] * spot.axis[1]));
    setParametric(drag.target, drag.id, drag.bodyId, drag.part, t, snap !== event.altKey);
  };

  const endPointer = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId);
    if (!twoFingers()) pinch.current = null;
    setDrag(null);
    setGhost(null);
  };

  const onWheel = (event: React.WheelEvent) => {
    if (!interactive) return;
    zoomAbout(pointerAt(event as unknown as React.PointerEvent),
              Math.exp(-event.deltaY * 0.0015));
  };

  const start = (next: Drag, pick?: Selection) => (event: React.PointerEvent) => {
    if (!interactive) return;
    // Con una herramienta activa el clic es para COLOCAR, no para arrastrar. Si
    // el elemento lo frenara aca, poner un apoyo sobre un cuerpo seria
    // imposible: el propio cuerpo se comeria el clic antes de que llegue al
    // colocador. Se deja pasar y lo atiende el canvas.
    if (pending) return;
    // En modo mano el elemento no existe para el puntero: el gesto es de vista.
    if (mode === 'pan') return;

    if (pick) onSelect(pick);
    if (mode === 'select') {
      // Tocar elige, y nada mas: el arrastre sigue siendo de la vista, que es
      // lo que uno suele querer cuando el dedo tapa medio elemento. El evento
      // NO se frena -- asi el canvas arranca el desplazamiento -- pero se deja
      // dicho que ya hubo elemento, para que no borre la seleccion recien
      // hecha al recibirlo.
      hitElement.current = true;
      return;
    }
    event.stopPropagation();
    capture(event);
    // El punto de agarre es DONDE se toco, no el origen del cuerpo. Con el
    // origen, agarrar una viga por el medio la teletransporta en el primer
    // movimiento: el cuerpo salta para que su punta caiga bajo el dedo.
    setDrag(next.kind === 'body' ? { ...next, grab: toWorld(pointerAt(event)) } : next);
  };

  const isSelected = (target: Selection['target'], id: string) =>
    selection?.target === target && selection.id === id;

  return (
    <svg
      ref={svgRef}
      className={`canvas${pending ? ' placing' : ''}`}
      viewBox={`0 0 ${W} ${H}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      // `pointercancel` es lo que manda el sistema cuando decide que el gesto
      // era suyo. Sin atenderlo, el arrastre queda pegado y el elemento sigue
      // al dedo aunque ya no lo estes tocando.
      onPointerCancel={endPointer}
      onWheel={onWheel}
      role="application"
      aria-label="Canvas del sistema"
    >
      <defs>
        <marker id="ar" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
        <pattern id="grid" width={view.scale} height={view.scale} patternUnits="userSpaceOnUse"
                 patternTransform={`translate(${(W / 2 - view.cx * view.scale) % view.scale} ${(H / 2 + view.cy * view.scale) % view.scale})`}>
          <path d={`M ${view.scale} 0 L 0 0 0 ${view.scale}`} fill="none" stroke="#eee" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#grid)" />

      {placed.map((spot) => (
        <BodyLayer key={spot.body.id} spot={spot} model={model} module={module}
                   bindings={bindings} toScreen={toScreen} isSelected={isSelected}
                   start={start} showReactions={showReactions} interactive={interactive} />
      ))}

      {model.probes.map((probe) => {
        const [px, py] = toScreen([
          evalExpr(probe.at[0] as unknown as string, bindings),
          evalExpr(probe.at[1] as unknown as string, bindings),
        ]);
        return (
          <g key={probe.id} className={`probe${isSelected('probe', probe.id) ? ' sel' : ''}`}
             onPointerDown={start({ kind: 'probe', id: probe.id },
                                  { target: 'probe', id: probe.id })}>
            <circle cx={px} cy={py} r={7} />
            <text x={px + 11} y={py + 4} className="lab">{probe.label || probe.id}</text>
          </g>
        );
      })}

      <text x={10} y={16} className="lab">
        {view.scale.toFixed(0)} px/m · rueda: zoom · fondo: mover la vista
      </text>
      {ghost && <text x={10} y={H - 12} className="lab">{ghost}</text>}
      {placed.length === 0 && (
        <text x={W / 2} y={H / 2} textAnchor="middle" className="lab">
          Elegi un cuerpo de la paleta y hace clic aca para empezar
        </text>
      )}
    </svg>
  );
}

interface LayerProps {
  spot: Placed;
  model: ProblemModel;
  module: Module;
  bindings: Record<string, number>;
  toScreen: (p: Vec) => Vec;
  isSelected: (target: Selection['target'], id: string) => boolean;
  start: (next: Drag, pick?: Selection) => (event: React.PointerEvent) => void;
  showReactions: boolean;
  interactive: boolean;
}

/** Extremos de la region de un campo, en coordenadas del cuerpo. */
function regionOf(field: FieldSpec, spot: Placed, bindings: Record<string, number>): [number, number] {
  const region = field.region;
  if (region.type === 'point') {
    const at = evalExpr(region.at, bindings);
    return [at, at];
  }
  if (region.type === 'interval') {
    return [evalExpr(region.start, bindings), evalExpr(region.end, bindings, spot.length)];
  }
  return [0, spot.length];
}

/** Un cuerpo y todo lo que se le colgo encima. */
function BodyLayer({
  spot, model, module, bindings, toScreen, isSelected, start, showReactions, interactive,
}: LayerProps) {
  const { body, derived, origin, axis, perp, length, at } = spot;
  const id = body.id;

  const fields = body.fields.filter((f): f is FieldSpec => f.kind !== 'thermal');
  const points = fields.filter((f) => f.distribution.type === 'point');
  const spread = fields.filter((f) => f.distribution.type !== 'point');

  /** Escala comun de las cargas distribuidas, si el motor ya dio los perfiles. */
  const scale = (() => {
    let peak = 0;
    for (const load of derived?.loads ?? []) {
      if (load.kind !== 'distributed' || !load.profile) continue;
      const f = compile(load.profile.js);
      for (let i = 0; i <= 30; i += 1) peak = Math.max(peak, Math.abs(f((i / 30) * length, bindings)));
    }
    return peak > 0 ? LOAD_PX / peak : 0;
  })();

  const offset = (t: number, pixels: number): Vec => {
    const [sx, sy] = toScreen(at(t));
    return [sx + perp[0] * pixels, sy - perp[1] * pixels];
  };

  const [ox, oy] = toScreen(origin);
  const [ex, ey] = toScreen(at(length));
  const selected = isSelected('body', id);

  return (
    <g className={selected ? 'sel' : ''}>
      {spread.map((field) => {
        const [a, b] = regionOf(field, spot, bindings);
        const profile = derived?.loads.find((l) => l.id === field.id)?.profile;
        const f = profile ? compile(profile.js) : null;
        // Sin derivacion todavia se dibuja una banda plana: el usuario tiene que
        // ver donde puso la carga aunque el sistema no cierre.
        const height = (t: number) => (f ? Math.abs(f(t, bindings)) * scale : 26);
        const down = f ? f((a + b) / 2, bindings) <= 0
          : !('direction' in field) || field.direction.vector[1] === '-1';

        const outline: string[] = [];
        for (let i = 0; i <= 48; i += 1) {
          const t = a + ((b - a) * i) / 48;
          const [px, py] = offset(t, height(t));
          outline.push(`${px.toFixed(1)},${py.toFixed(1)}`);
        }
        const [ax, ay] = toScreen(at(a));
        const [bx, by] = toScreen(at(b));
        const peak = Math.max(...[...Array(9)].map((_, i) => height(a + ((b - a) * i) / 8)), 0);
        const [lx, ly] = offset((a + b) / 2, peak + 11);

        return (
          <g key={field.id} className={`dist ${module}${isSelected('field', field.id) ? ' sel' : ''}`}>
            <polygon points={`${ax},${ay} ${outline.join(' ')} ${bx},${by}`} />
            <polyline points={outline.join(' ')} />
            {(!('quantity' in field) || field.quantity === 'force') && [...Array(5)].map((_, i) => {
              const t = a + ((b - a) * (i + 0.5)) / 5;
              const h = height(t);
              if (h < 8) return null;
              const tip = toScreen(at(t));
              const tail = offset(t, h);
              const [from, to] = down ? [tail, tip] : [tip, tail];
              return <line key={i} x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]}
                           markerEnd="url(#ar)" />;
            })}
            <text x={lx} y={ly} textAnchor="middle" className="lab">{field.label || field.id}</text>
            {interactive && (['start', 'end'] as const).map((part) => {
              const [hx, hy] = toScreen(at(part === 'start' ? a : b));
              return (
                <circle key={part} className="handle" cx={hx} cy={hy} r={7}
                        onPointerDown={start(
                          { kind: 'element', target: 'field', id: field.id, bodyId: id, part },
                          { target: 'field', id: field.id, bodyId: id })} />
              );
            })}
          </g>
        );
      })}

      {points.map((field) => {
        const [t] = regionOf(field, spot, bindings);
        const distribution = field.distribution;
        const magnitude = distribution.type === 'point'
          ? evalExpr(distribution.magnitude, bindings, 1) : 1;
        const pick: Selection = { target: 'field', id: field.id, bodyId: id };
        const drag: Drag = { kind: 'element', target: 'field', id: field.id, bodyId: id, part: 'at' };
        const [tx, ty] = toScreen(at(t));
        const isForce = !('quantity' in field) || field.quantity === 'force';
        const isCouple = 'quantity' in field && field.quantity === 'moment';

        if (isCouple) {
          return (
            <g key={field.id} className={`cpl${isSelected('field', field.id) ? ' sel' : ''}`}
               onPointerDown={start(drag, pick)}>
              <path d={`M ${tx - 20} ${ty - 5} A 20 20 0 1 1 ${tx + 20} ${ty - 5}`}
                    markerEnd="url(#ar)" />
              <text x={tx} y={ty - 30} textAnchor="middle" className="lab">
                {field.label || field.id}
              </text>
            </g>
          );
        }
        if (!isForce) {
          return (
            <g key={field.id}
               className={`scalar-pt ${magnitude >= 0 ? 'pos' : 'neg'}${isSelected('field', field.id) ? ' sel' : ''}`}
               onPointerDown={start(drag, pick)}>
              <circle cx={tx} cy={ty} r={10} />
              <text x={tx} y={ty + 4} textAnchor="middle" className="glyph">
                {magnitude >= 0 ? '+' : '−'}
              </text>
              <text x={tx} y={ty - 16} textAnchor="middle" className="lab">
                {field.label || field.id}
              </text>
            </g>
          );
        }

        const down = !('direction' in field) || field.direction.vector[1] === '-1';
        const tail = offset(t, down ? 52 : -52);
        return (
          <g key={field.id} className={`pt${isSelected('field', field.id) ? ' sel' : ''}`}
             onPointerDown={start(drag, pick)}>
            <line x1={tail[0]} y1={tail[1]} x2={tx} y2={ty} markerEnd="url(#ar)" />
            <circle className="handle" cx={tail[0]} cy={tail[1]} r={7} />
            <text x={tail[0]} y={tail[1] - 8} textAnchor="middle" className="lab">
              {field.label || field.id}
            </text>
          </g>
        );
      })}

      {/* El cuerpo. Un cable se dibuja con su curva, que es el resultado; las
          figuras rigidas, con su forma, que es lo unico que tienen. */}
      {(() => {
        const grab = start({ kind: 'body', id, grab: origin }, { target: 'body', id });

        if (derived?.shape) {
          const shape = compile(derived.shape.js);
          const pts: string[] = [];
          for (let i = 0; i <= 48; i += 1) {
            const t = (i / 48) * length;
            const y = shape(t, bindings);
            if (!Number.isFinite(y)) continue;
            const [px, py] = toScreen(add(at(t), mul(perp, y)));
            pts.push(`${px.toFixed(1)},${py.toFixed(1)}`);
          }
          return <polyline className="cable grabbable" points={pts.join(' ')}
                           onPointerDown={grab} />;
        }

        // Pixeles por metro, leidos del propio dibujo: el largo del cuerpo en
        // pantalla dividido por su largo en el mundo. Asi el glifo no necesita
        // saber nada de la vista.
        const pxPerM = Math.hypot(ex - ox, ey - oy) / (length || 1);
        const screen = (t: number, off: number) => toScreen(add(at(t), mul(perp, off))).join(',');

        if (body.type === 'disc' || body.type === 'sphere') {
          // El radio ES el dominio: el extremo del cuerpo cae sobre el borde, y
          // por eso arrastrar el tirador agranda la figura.
          const r = Math.max(Math.hypot(ex - ox, ey - oy), 3);
          return (
            <g className={`shape ${body.type} grabbable`} onPointerDown={grab}>
              <circle cx={ox} cy={oy} r={r} />
              {body.type === 'sphere' && <ellipse cx={ox} cy={oy} rx={r} ry={r * 0.3} />}
              {body.type === 'disc' && <circle className="hub" cx={ox} cy={oy} r={3} />}
              <line className="radius" x1={ox} y1={oy} x2={ex} y2={ey} />
            </g>
          );
        }

        if (body.type === 'block') {
          const height = evalExpr(body.shape?.height ?? '', bindings, 0.6);
          return (
            <polygon className="shape block grabbable" onPointerDown={grab}
                     points={[screen(0, 0), screen(length, 0),
                              screen(length, height), screen(0, height)].join(' ')} />
          );
        }

        if (body.type === 'spring') {
          const amplitude = Math.min(0.18 * length, 16 / (pxPerM || 1));
          const coils = 8;
          const pts = [screen(0, 0)];
          for (let i = 1; i <= coils; i += 1) {
            pts.push(screen(((i - 0.5) / coils) * length, i % 2 ? amplitude : -amplitude));
          }
          pts.push(screen(length, 0));
          return <polyline className="shape spring grabbable" points={pts.join(' ')}
                           onPointerDown={grab} />;
        }

        if (body.type === 'ideal_cable') {
          return (
            <g className="shape ideal-cable grabbable" onPointerDown={grab}>
              {/* Un cable ideal no tiene espesor, y un trazo de un pixel no se
                  puede tocar con el dedo. La linea invisible es el area de
                  contacto; la visible, el cuerpo. */}
              <line className="hit" x1={ox} y1={oy} x2={ex} y2={ey} />
              <line x1={ox} y1={oy} x2={ex} y2={ey} />
              <circle cx={ox} cy={oy} r={3} />
              <circle cx={ex} cy={ey} r={3} />
            </g>
          );
        }

        const rigid = body.type === 'rod';
        return (
          <g className={`grabbable${rigid ? ' shape rod' : ''}`} onPointerDown={grab}>
            <line className="hit" x1={ox} y1={oy} x2={ex} y2={ey} />
            <line x1={ox} y1={oy} x2={ex} y2={ey}
                  className={rigid ? 'rod-axis' : 'beam body-axis'} />
            {rigid && <><circle cx={ox} cy={oy} r={4} /><circle cx={ex} cy={ey} r={4} /></>}
          </g>
        );
      })()}

      {interactive && (
        <circle className="handle body-end" cx={ex} cy={ey} r={7}
                onPointerDown={start({ kind: 'body-end', id }, { target: 'body', id })} />
      )}

      {(() => {
        const [mx, my] = toScreen(at(length / 2));
        return <text x={mx} y={my + 30} textAnchor="middle" className="lab">{body.name || id}</text>;
      })()}

      {model.supports.filter((s) => s.body_id === id).map((support) => {
        const t = evalExpr(support.at, bindings);
        const [sx, sy] = toScreen(at(t));
        // El apoyo se dibuja con el vertice arriba y la base abajo. Hay que
        // girarlo para que su vertice apunte segun la transversal del cuerpo:
        // R(a) aplicado a (0,-1) da (sin a, -cos a), que tiene que igualar la
        // transversal en pantalla, (perp_x, -perp_y). De ahi a = atan2(px, py).
        const angle = (Math.atan2(perp[0], perp[1]) * 180) / Math.PI;
        return (
          <g key={support.id}
             className={`support${isSelected('support', support.id) ? ' sel' : ''}`}
             transform={`rotate(${angle} ${sx} ${sy})`}
             onPointerDown={start(
               { kind: 'element', target: 'support', id: support.id, bodyId: id, part: 'at' },
               { target: 'support', id: support.id, bodyId: id })}>
            {support.type === 'fixed' ? (
              <>
                <line x1={sx} y1={sy - 20} x2={sx} y2={sy + 20} strokeWidth={3} />
                {[-14, -7, 0, 7, 14].map((dy) => (
                  <line key={dy} x1={sx} y1={sy + dy} x2={sx - 9} y2={sy + dy + 7} />
                ))}
              </>
            ) : (
              <>
                <polygon points={`${sx},${sy} ${sx - 10},${sy + 17} ${sx + 10},${sy + 17}`} />
                {support.type === 'roller' && (
                  <>
                    <circle cx={sx - 5} cy={sy + 21} r={3.5} />
                    <circle cx={sx + 5} cy={sy + 21} r={3.5} />
                  </>
                )}
              </>
            )}
            <text x={sx} y={sy + 36} textAnchor="middle" className="lab">{support.id}</text>
          </g>
        );
      })}

      {model.boundaries.filter((b) => b.body_id === id).map((boundary) => {
        const t = evalExpr(boundary.at, bindings);
        const [bx, by] = toScreen(at(t));
        const glyph = { temperature: 'T', flux: 'Q', convection: 'h', insulated: '//' }[boundary.type];
        return (
          <g key={boundary.id}
             className={`bc bc-${boundary.type}${isSelected('boundary', boundary.id) ? ' sel' : ''}`}
             onPointerDown={start(
               { kind: 'element', target: 'boundary', id: boundary.id, bodyId: id, part: 'at' },
               { target: 'boundary', id: boundary.id, bodyId: id })}>
            <line x1={bx} y1={by - 16} x2={bx} y2={by + 16} />
            <rect x={bx - 11} y={by + 18} width={22} height={17} rx={2} />
            <text x={bx} y={by + 30} textAnchor="middle" className="glyph">{glyph}</text>
            <text x={bx} y={by + 47} textAnchor="middle" className="lab">
              {boundary.label || boundary.id}
            </text>
          </g>
        );
      })}

      {/* Las reacciones son resultado, no dato: se dibujan aparte y solo cuando
          el usuario las pide. */}
      {showReactions && (derived?.reaction_arrows ?? []).map((arrow) => {
        const t = value(arrow.at.js, bindings);
        const magnitude = value(arrow.value.js, bindings);
        if (!Number.isFinite(magnitude) || magnitude === 0) return null;
        const [tx, ty] = toScreen(at(t));

        if (arrow.component === 'moment') {
          return (
            <g key={arrow.id} className="reaction">
              <path d={`M ${tx - 24} ${ty + 6} A 24 24 0 1 0 ${tx + 24} ${ty + 6}`}
                    markerEnd="url(#ar)" />
              <text x={tx} y={ty + 28} textAnchor="middle">{arrow.id}</text>
            </g>
          );
        }
        const direction = arrow.component === 'axial' ? axis : perp;
        const sign = magnitude >= 0 ? 1 : -1;
        const tipX = tx + direction[0] * 42 * sign;
        const tipY = ty - direction[1] * 42 * sign;
        return (
          <g key={arrow.id} className="reaction">
            <line x1={tx} y1={ty} x2={tipX} y2={tipY} markerEnd="url(#ar)" />
            <text x={tipX} y={tipY - 5} textAnchor="middle">{arrow.id}</text>
          </g>
        );
      })}
    </g>
  );
}
