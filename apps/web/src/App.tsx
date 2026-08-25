import { useEffect, useMemo, useState } from 'react';
import type { ProblemModel } from '@wf/schema';

import { fetchExamples, type Example } from './lib/api';
import type { Module } from './lib/elements';
import { useProblem } from './lib/useProblem';
import { Stage1 } from './components/Stage1';
import { Stage2 } from './components/Stage2';
import { Stage3 } from './components/Stage3';

const STAGES = [
  { n: 1, title: 'Armar', hint: 'Coloca cuerpos, cargas y apoyos' },
  { n: 2, title: 'Plantear', hint: 'Ecuaciones derivadas del modelo' },
  { n: 3, title: 'Valorizar', hint: 'Numeros, diagramas y mapas' },
] as const;

const MODULES: { id: Module; label: string }[] = [
  { id: 'statics', label: 'Estatica' },
  { id: 'em', label: 'Electro' },
  { id: 'thermo', label: 'Termo' },
];

const SEED: ProblemModel = {
  module: 'statics',
  title: 'Cargando...',
  bodies: [],
  supports: [],
  boundaries: [],
  probes: [],
};

export function App() {
  const [examples, setExamples] = useState<Example[]>([]);
  const [stage, setStage] = useState<1 | 2 | 3>(1);
  const problem = useProblem(SEED);
  const { doc, derived, status, error, bindings, orphans } = problem;

  const module = (doc.stage1.module ?? 'statics') as Module;

  useEffect(() => {
    fetchExamples()
      .then(({ examples: list }) => {
        setExamples(list);
        const first = list.find((x) => x.model.module === 'statics') ?? list[0];
        if (first) problem.setModel(() => first.model);
      })
      .catch(() => undefined);
    // Solo al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Al cambiar de modulo se carga su primer ejemplo: cada uno tiene sus elementos. */
  const switchModule = (next: Module) => {
    const seed = examples.find((x) => x.model.module === next);
    if (seed) problem.setModel(() => seed.model);
  };

  const moduleExamples = useMemo(
    () => examples.filter((x) => x.model.module === module),
    [examples, module],
  );

  const body = derived?.bodies[0] ?? null;
  const failed = derived?.errors ?? [];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <strong>Workspace Funcional</strong>
        </div>

        <div className="modules" role="tablist" aria-label="Modulo">
          {MODULES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={module === entry.id}
              onClick={() => switchModule(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <nav className="stepper">
          {STAGES.map((s) => (
            <button
              key={s.n}
              type="button"
              className={stage === s.n ? 'active' : ''}
              onClick={() => setStage(s.n)}
            >
              <span className="num">{s.n}</span>
              <span className="labels">
                <strong>{s.title}</strong>
                <small>{s.hint}</small>
              </span>
            </button>
          ))}
        </nav>

        <div className="status">
          <select
            value=""
            onChange={(e) => {
              const chosen = moduleExamples.find((x) => x.id === e.target.value);
              if (chosen) problem.setModel(() => chosen.model);
            }}
          >
            <option value="">Cargar ejemplo...</option>
            {moduleExamples.map((x) => (
              <option key={x.id} value={x.id}>{x.title}</option>
            ))}
          </select>
          <span className={`pill ${status}`}>
            {status === 'deriving' ? 'derivando...' : status === 'error' ? 'error' : 'guardado'}
          </span>
        </div>
      </header>

      {error && <div className="banner error">Error del motor: {error}</div>}
      {failed.length > 0 && (
        <div className="banner error">
          {failed.map((e) => (
            <p key={e.body_id}><strong>{e.body_id}:</strong> {e.message}</p>
          ))}
        </div>
      )}

      <main>
        {stage === 1 && (
          <Stage1
            model={doc.stage1}
            module={module}
            derivedBody={body}
            bindings={bindings}
            onChange={problem.setModel}
          />
        )}
        {stage === 2 &&
          (body ? (
            <Stage2 body={body} doc={doc} orphans={orphans} onEdit={problem.setEquationEdit} />
          ) : (
            <p className="empty">Todavia no hay ecuaciones: revisa el modelo en la etapa 1.</p>
          ))}
        {stage === 3 &&
          (body ? (
            <Stage3
              body={body}
              doc={doc}
              bindings={bindings}
              symbols={derived!.symbols}
              onBinding={problem.setBinding}
            />
          ) : (
            <p className="empty">Todavia no hay nada que valorizar.</p>
          ))}
      </main>
    </div>
  );
}
