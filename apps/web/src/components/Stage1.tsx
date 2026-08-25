import { useCallback, useEffect, useState } from 'react';
import type { Dimension, DerivedBody, ProblemModel } from '@wf/schema';

import {
  freshId, makeBody, makeBoundary, makeField, makeSupport, paletteFor, type Module,
} from '../lib/elements';
import { evalExpr } from '../lib/evalexpr';
import { Inspector } from './Inspector';
import { Palette } from './Palette';
import { DEFAULT_ORBIT, Scene3D, type Orbit } from './Scene3D';
import { DEFAULT_VIEW, WorldCanvas, type Selection, type View } from './WorldCanvas';

interface Props {
  model: ProblemModel;
  module: Module;
  bodies: DerivedBody[];
  bindings: Record<string, number>;
  /** Cuerpos que el motor todavia no puede resolver, con el motivo. */
  unresolved: { body_id: string; message: string }[];
  dimension: Dimension;
  onDimension: (dimension: Dimension) => void;
  onChange: (update: (model: ProblemModel) => ProblemModel) => void;
  onBinding: (name: string, value: number) => void;
}

/**
 * Etapa 1: armar el sistema.
 *
 * El canvas es el lugar donde se construye, no una vista previa. Se elige algo
 * de la paleta, se hace clic en el mundo -- o sobre un cuerpo, si es algo que
 * se le cuelga encima -- y queda colocado. Despues todo se arrastra.
 */
const DIMENSIONS: { id: Dimension; label: string; hint: string }[] = [
  { id: '1d', label: '1D', hint: 'Todo sobre un eje: la viga del libro' },
  { id: '2d', label: '2D', hint: 'Plano: cuerpos en cualquier direccion' },
  { id: '3d', label: '3D', hint: 'Espacio: se construye sobre el piso' },
];

export function Stage1({
  model, module, bodies, bindings, unresolved, dimension, onDimension, onChange, onBinding,
}: Props) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const [orbit, setOrbit] = useState<Orbit>(DEFAULT_ORBIT);
  const [showReactions, setShowReactions] = useState(true);

  const palette = paletteFor(module);

  /**
   * Encuadra sobre lo que hay.
   *
   * Un "volver al inicio" fijo sirve una sola vez; despues de mover cuerpos por
   * el plano, lo que uno necesita es que la vista vaya a donde estan.
   */
  const fit = useCallback(() => {
    const points: [number, number, number][] = [];
    for (const body of model.bodies) {
      const embedding = body.domain.embedding;
      if (embedding.type !== 'straight') continue;
      const origin: [number, number, number] = [
        evalExpr(embedding.origin[0] as unknown as string, bindings),
        evalExpr(embedding.origin[1] as unknown as string, bindings),
        evalExpr(embedding.origin[2] as unknown as string, bindings),
      ];
      const direction = [
        evalExpr(embedding.direction[0] as unknown as string, bindings, 1),
        evalExpr(embedding.direction[1] as unknown as string, bindings),
        evalExpr(embedding.direction[2] as unknown as string, bindings),
      ];
      const magnitude = Math.hypot(...direction) || 1;
      const length = evalExpr(body.domain.end, bindings, 1) || 1;
      points.push(origin, [
        origin[0] + (direction[0] / magnitude) * length,
        origin[1] + (direction[1] / magnitude) * length,
        origin[2] + (direction[2] / magnitude) * length,
      ]);
    }
    if (points.length === 0) { setView(DEFAULT_VIEW); setOrbit(DEFAULT_ORBIT); return; }

    const axis = (i: number) => points.map((p) => p[i]);
    const span = (i: number) => Math.max(...axis(i)) - Math.min(...axis(i));
    const mid = (i: number) => (Math.max(...axis(i)) + Math.min(...axis(i))) / 2;
    // Margen del 40 %: las cargas y los apoyos se dibujan fuera del cuerpo.
    const width = Math.max(span(0), span(1), span(2), 1) * 1.4;

    setView({ cx: mid(0), cy: mid(1), scale: Math.min(300, 700 / width) });
    setOrbit({ ...DEFAULT_ORBIT, center: [mid(0), mid(1), mid(2)],
               scale: Math.min(300, 620 / width) });
  }, [model.bodies, bindings]);
  const pendingTarget = palette.find((item) => item.id === pending)?.target ?? null;

  const remove = useCallback(() => {
    if (!selection) return;
    onChange((m) => {
      if (selection.target === 'body') {
        // Quitar un cuerpo se lleva lo que estaba anclado a el: dejar apoyos
        // colgando de un cuerpo que ya no existe rompe la derivacion.
        return {
          ...m,
          bodies: m.bodies.filter((b) => b.id !== selection.id),
          supports: m.supports.filter((s) => s.body_id !== selection.id),
          boundaries: m.boundaries.filter((b) => b.body_id !== selection.id),
        };
      }
      if (selection.target === 'field') {
        return {
          ...m,
          bodies: m.bodies.map((b) => (b.id !== selection.bodyId ? b : {
            ...b, fields: b.fields.filter((f) => f.id !== selection.id),
          })),
        };
      }
      if (selection.target === 'support') {
        return { ...m, supports: m.supports.filter((s) => s.id !== selection.id) };
      }
      if (selection.target === 'boundary') {
        return { ...m, boundaries: m.boundaries.filter((b) => b.id !== selection.id) };
      }
      return { ...m, probes: m.probes.filter((p) => p.id !== selection.id) };
    });
    setSelection(null);
  }, [selection, onChange]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (event.key === 'Delete' || event.key === 'Backspace') remove();
      if (event.key === 'Escape') { setPending(null); setSelection(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [remove]);

  const place = useCallback((spot: {
    at: number[]; bodyId?: string; parameter?: string;
  }) => {
    if (!pending) return;
    const item = palette.find((entry) => entry.id === pending);
    if (!item) return;

    // El cuerpo se fabrica antes de entrar al updater: crear estado de React
    // dentro de un updater lo ejecuta durante el render de otro componente, y
    // React lo rechaza. El updater solo tiene que devolver el modelo nuevo.
    let created: string | null = null;
    if (item.target === 'body') created = makeBody(pending, module, model, spot.at, dimension).id;

    onChange((m) => {
      if (item.target === 'body') {
        const body = makeBody(pending, module, m, spot.at, dimension);
        created = body.id;
        return { ...m, bodies: [...m.bodies, body] };
      }
      if (item.target === 'probe') {
        const id = freshId('P', m.probes.map((p) => p.id));
        return {
          ...m,
          probes: [...m.probes, {
            id,
            at: [String(spot.at[0].toFixed(2)), String(spot.at[1].toFixed(2)), '0'] as
              [string, string, string],
            label: id,
          }],
        };
      }

      const target = m.bodies.find((b) => b.id === spot.bodyId);
      if (!target || !spot.parameter) return m;

      if (item.target === 'field') {
        const field = makeField(pending, module, target, spot.parameter);
        return {
          ...m,
          bodies: m.bodies.map((b) => (b.id !== target.id ? b : { ...b, fields: [...b.fields, field] })),
        };
      }
      if (item.target === 'support') {
        return { ...m, supports: [...m.supports, makeSupport(pending, m, target.id, spot.parameter)] };
      }
      return { ...m, boundaries: [...m.boundaries, makeBoundary(pending, m, target.id, spot.parameter)] };
    });
    setPending(null);
    if (created) setSelection({ target: 'body', id: created });
  }, [pending, palette, module, model, dimension, onChange]);

  return (
    <div className="sheet cols-model">
      <div className="stack">
        <section className="plate">
          <div className="panel-head">
            <h2>Sistema</h2>
            <span className="dims">
              {DIMENSIONS.map((entry) => (
                <button key={entry.id} type="button" title={entry.hint}
                        aria-pressed={dimension === entry.id}
                        onClick={() => onDimension(entry.id)}>
                  {entry.label}
                </button>
              ))}
            </span>
          </div>
          {dimension === '3d' ? (
            <Scene3D
              bodies={bodies}
              model={model}
              bindings={bindings}
              selection={selection}
              onSelect={setSelection}
              onChange={onChange}
              pending={pending}
              pendingTarget={pendingTarget}
              onPlace={place}
              orbit={orbit}
              onOrbit={setOrbit}
              showReactions={showReactions}
            />
          ) : (
          <WorldCanvas
            bodies={bodies}
            model={model}
            module={module}
            bindings={bindings}
            selection={selection}
            onSelect={setSelection}
            onChange={onChange}
            onBinding={onBinding}
            pending={pending}
            pendingTarget={pendingTarget}
            onPlace={place}
            view={view}
            onView={setView}
            showReactions={showReactions}
            lockToAxis={dimension === '1d'}
          />
          )}
          <p className="hint">
            {dimension === '3d' ? (
              <>
                Arrastra para girar la escena y la rueda acerca. Los cuerpos se apoyan
                en el piso; para colgarles cargas y apoyos conviene pasar a 2D, donde el
                clic sobre un cuerpo es inequivoco.
              </>
            ) : (
              <>
                {dimension === '1d' && 'Los cuerpos quedan sobre el eje horizontal. '}
                Arrastra un cuerpo para moverlo
                {dimension === '2d' && ' y su extremo para girarlo o estirarlo (engancha cada 15°; con Alt queda libre)'}.
                Lo que se pone encima engancha a fracciones del dominio, para que el
                planteo siga siendo simbolico. <kbd>Supr</kbd> quita lo seleccionado.
              </>
            )}
          </p>
          <label>
            <input type="checkbox" checked={showReactions}
                   onChange={(e) => setShowReactions(e.target.checked)} />
            {' '}Mostrar las reacciones calculadas
          </label>
          <button type="button" onClick={fit}>Encuadrar</button>
        </section>

        <section className="plate">
          <h2>Elementos</h2>
          <Palette module={module} pending={pending} onPick={setPending} />
        </section>
      </div>

      <div className="stack">
        {selection ? (
          <Inspector model={model} selection={selection} onChange={onChange} onDelete={remove} />
        ) : (
          <section className="plate">
            <h2>Inspector</h2>
            <p className="hint">
              Selecciona algo del canvas para editarlo, o elegi un elemento de la paleta y
              hace clic para agregarlo. Los cuerpos se colocan en cualquier punto; las
              cargas, apoyos y bordes, sobre un cuerpo.
            </p>
          </section>
        )}

        <section className="plate">
          <h2>Cuerpos ({model.bodies.length})</h2>
          {model.bodies.length === 0 ? (
            <p className="hint">
              El sistema esta vacio. Elegi un cuerpo de la paleta y hace clic en el canvas.
            </p>
          ) : (
            <ul>
              {model.bodies.map((body) => {
                const problem = unresolved.find((e) => e.body_id === body.id);
                return (
                  <li key={body.id}>
                    <button type="button"
                            onClick={() => setSelection({ target: 'body', id: body.id })}>
                      {body.name || body.id}
                    </button>{' '}
                    <span className="hint">
                      {body.type} · x ∈ [0, {body.domain.end}] ·{' '}
                      {body.fields.length} campo(s) ·{' '}
                      {model.supports.filter((s) => s.body_id === body.id).length +
                       model.boundaries.filter((b) => b.body_id === body.id).length} anclaje(s)
                    </span>
                    {/* Un cuerpo a medio armar no es un error: es el estado normal
                        mientras se construye. Se dice, sin gritar. */}
                    {problem && <div className="hint">Sin resolver: {problem.message}</div>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
