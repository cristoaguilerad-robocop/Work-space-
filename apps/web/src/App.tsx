import { useEffect, useState } from 'react';
import type { ProblemModel } from '@wf/schema';

import { fetchExamples, type Example } from './lib/api';
import { useProblem } from './lib/useProblem';
import { Stage1 } from './components/Stage1';
import { Stage2 } from './components/Stage2';
import { Stage3 } from './components/Stage3';

const STAGES = [
  { n: 1, title: 'Modelar', hint: 'Cuerpo, dominio, cargas y apoyos' },
  { n: 2, title: 'Plantear', hint: 'Ecuaciones derivadas del modelo' },
  { n: 3, title: 'Valorizar', hint: 'Numeros y diagramas' },
] as const;

const SEED: ProblemModel = {
  module: 'statics',
  title: 'Cargando...',
  bodies: [],
  supports: [],
} as ProblemModel;

export function App() {
  const [examples, setExamples] = useState<Example[]>([]);
  const [stage, setStage] = useState<1 | 2 | 3>(1);
  const problem = useProblem(SEED);
  const { doc, derived, status, error, bindings, orphans } = problem;

  useEffect(() => {
    fetchExamples()
      .then(({ examples: list }) => {
        setExamples(list);
        if (list[0]) problem.setModel(() => list[0].model);
      })
      .catch(() => undefined);
    // Solo al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const body = derived?.bodies[0] ?? null;
  const derivationFailed = (derived?.errors.length ?? 0) > 0;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <strong>Workspace Funcional</strong>
          <span className="module-badge">Estatica</span>
        </div>

        <nav className="stepper">
          {STAGES.map((s) => (
            <button
              key={s.n}
              type="button"
              className={stage === s.n ? 'active' : ''}
              onClick={() => setStage(s.n)}
              // Se puede volver atras siempre: las etapas siguientes son
              // overlays sobre lo derivado, no copias que se pierdan.
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
              const chosen = examples.find((x) => x.id === e.target.value);
              if (chosen) problem.setModel(() => chosen.model);
            }}
          >
            <option value="">Cargar ejemplo...</option>
            {examples.map((x) => (
              <option key={x.id} value={x.id}>{x.title}</option>
            ))}
          </select>
          <span className={`pill ${status}`}>
            {status === 'deriving' ? 'derivando...' : status === 'error' ? 'error' : 'guardado'}
          </span>
        </div>
      </header>

      {error && <div className="banner error">Error del motor: {error}</div>}
      {derivationFailed && (
        <div className="banner error">
          {derived!.errors.map((e) => (
            <p key={e.body_id}><strong>{e.body_id}:</strong> {e.message}</p>
          ))}
        </div>
      )}

      <main>
        {stage === 1 && (
          <Stage1
            model={doc.stage1}
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
