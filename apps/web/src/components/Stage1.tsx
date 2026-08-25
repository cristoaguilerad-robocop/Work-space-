import { useCallback, useEffect, useState } from 'react';
import type { DerivedBody, ProblemModel } from '@wf/schema';

import {
  freshId, makeBody, makeBoundary, makeField, makeSupport, paletteFor, type Module,
} from '../lib/elements';
import { Inspector } from './Inspector';
import { Palette } from './Palette';
import { DEFAULT_VIEW, WorldCanvas, type Selection, type View } from './WorldCanvas';

interface Props {
  model: ProblemModel;
  module: Module;
  bodies: DerivedBody[];
  bindings: Record<string, number>;
  /** Cuerpos que el motor todavia no puede resolver, con el motivo. */
  unresolved: { body_id: string; message: string }[];
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
export function Stage1({
  model, module, bodies, bindings, unresolved, onChange, onBinding,
}: Props) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const [showReactions, setShowReactions] = useState(true);

  const palette = paletteFor(module);
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
    at: [number, number]; bodyId?: string; parameter?: string;
  }) => {
    if (!pending) return;
    const item = palette.find((entry) => entry.id === pending);
    if (!item) return;

    // El cuerpo se fabrica antes de entrar al updater: crear estado de React
    // dentro de un updater lo ejecuta durante el render de otro componente, y
    // React lo rechaza. El updater solo tiene que devolver el modelo nuevo.
    let created: string | null = null;
    if (item.target === 'body') created = makeBody(pending, module, model, spot.at).id;

    onChange((m) => {
      if (item.target === 'body') {
        const body = makeBody(pending, module, m, spot.at);
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
  }, [pending, palette, module, model, onChange]);

  return (
    <div className="sheet cols-model">
      <div className="stack">
        <section className="plate">
          <h2>Sistema</h2>
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
          />
          <p className="hint">
            Arrastra un cuerpo para moverlo y su extremo para girarlo o estirarlo (engancha
            cada {15}°; con <kbd>Alt</kbd> queda libre). Lo que se pone encima engancha a
            fracciones del dominio, para que el planteo siga siendo simbolico.{' '}
            <kbd>Supr</kbd> quita lo seleccionado. La rueda acerca, el fondo mueve la vista.
          </p>
          <label>
            <input type="checkbox" checked={showReactions}
                   onChange={(e) => setShowReactions(e.target.checked)} />
            {' '}Mostrar las reacciones calculadas
          </label>
          <button type="button" onClick={() => setView(DEFAULT_VIEW)}>Encuadrar</button>
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
