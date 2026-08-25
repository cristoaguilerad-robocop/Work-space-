import { useCallback, useEffect, useState } from 'react';
import type { DerivedBody, ProblemModel } from '@wf/schema';

import {
  PALETTE, freshId, makeBoundary, makeField, makeSupport, type Module,
} from '../lib/elements';
import { Inspector } from './Inspector';
import { Palette } from './Palette';
import { SandboxCanvas, type Selection } from './SandboxCanvas';

interface Props {
  model: ProblemModel;
  module: Module;
  derivedBody: DerivedBody | null;
  bindings: Record<string, number>;
  onChange: (update: (model: ProblemModel) => ProblemModel) => void;
}

/**
 * Etapa 1: armar el problema.
 *
 * El canvas no es una vista previa: es donde se construye. Se elige un
 * elemento de la paleta, se hace clic en el cuerpo para colocarlo, y despues
 * se arrastra para moverlo. Cada posicion se guarda como expresion del
 * dominio, no como numero, para que la etapa 2 siga siendo parametrica.
 */
export function Stage1({ model, module, derivedBody, bindings, onChange }: Props) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const body = model.bodies[0];

  const remove = useCallback(() => {
    if (!selection) return;
    onChange((m) => {
      if (selection.target === 'field') {
        return {
          ...m,
          bodies: m.bodies.map((b, i) => (i !== 0 ? b : {
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

  // Suprimir borra lo seleccionado, salvo mientras se escribe en un campo.
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

  const place = useCallback((at: string) => {
    if (!pending) return;
    const item = PALETTE[module].find((entry) => entry.id === pending);
    if (!item) return;

    onChange((m) => {
      if (item.target === 'field') {
        const field = makeField(pending, module, m, at);
        return {
          ...m,
          bodies: m.bodies.map((b, i) => (i !== 0 ? b : { ...b, fields: [...b.fields, field] })),
        };
      }
      if (item.target === 'support') {
        return { ...m, supports: [...m.supports, makeSupport(pending, m, at)] };
      }
      if (item.target === 'boundary') {
        return { ...m, boundaries: [...m.boundaries, makeBoundary(pending, m, at)] };
      }
      return {
        ...m,
        probes: [...m.probes, {
          id: freshId('P', m.probes.map((p) => p.id)),
          at: [at, '0.5', '0'] as [string, string, string],
          label: `P${m.probes.length + 1}`,
        }],
      };
    });
    setPending(null);
  }, [pending, module, onChange]);

  if (!body) return <p className="empty">El modelo no tiene cuerpos.</p>;

  return (
    <div className="sheet cols-model">
      <div className="stack">
        <section className="plate">
          <h2>Canvas — arma el problema</h2>
          {derivedBody ? (
            <SandboxCanvas
              body={derivedBody}
              model={model}
              module={module}
              bindings={bindings}
              selection={selection}
              onSelect={setSelection}
              onChange={onChange}
              pending={pending}
              onPlace={place}
            />
          ) : (
            <p className="empty">Esperando la derivacion...</p>
          )}
          <p className="hint">
            Arrastra los elementos para moverlos: engancha a fracciones del dominio
            (<code>L/4</code>, <code>2L/3</code>) para que el planteo siga siendo simbolico.
            Con <kbd>Alt</kbd> se mueve libre. <kbd>Supr</kbd> quita lo seleccionado.
          </p>
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
              Selecciona un elemento del canvas para editarlo, o elegi uno de la paleta y
              hace clic en el cuerpo para agregarlo.
            </p>
          </section>
        )}

        <section className="plate">
          <h2>Cuerpo</h2>
          <div className="grid">
            <label>
              Nombre
              <input value={body.name ?? ''}
                     onChange={(e) => onChange((m) => ({
                       ...m,
                       bodies: m.bodies.map((b, i) => (i === 0 ? { ...b, name: e.target.value } : b)),
                     }))} />
            </label>
            <label>
              Dominio x ∈ [0, ...]
              <input value={body.domain.end}
                     onChange={(e) => onChange((m) => ({
                       ...m,
                       bodies: m.bodies.map((b, i) => (i === 0
                         ? { ...b, domain: { ...b.domain, end: e.target.value } } : b)),
                     }))} />
            </label>
            {module === 'statics' && (
              <label>
                Modo de analisis
                <select
                  value={body.analysis.mode}
                  onChange={(e) => onChange((m) => ({
                    ...m,
                    bodies: m.bodies.map((b, i) => (i === 0
                      ? { ...b, analysis: { ...b.analysis, mode: e.target.value as 'rigid' | 'deformable' } }
                      : b)),
                  }))}
                >
                  <option value="rigid">Rigido — resultantes y equilibrio</option>
                  <option value="deformable">Deformable — hasta la elastica</option>
                </select>
              </label>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
