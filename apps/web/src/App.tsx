import { useEffect, useMemo, useState } from 'react';
import type { ProblemModel } from '@wf/schema';

import { fetchExamples, type Example } from './lib/api';
import type { Module } from './lib/elements';
import { useProblem } from './lib/useProblem';
import { Stage1 } from './components/Stage1';
import { Stage2 } from './components/Stage2';
import { Stage3 } from './components/Stage3';

const STAGES = [
  { n: 1, title: '1. Armar', hint: 'Coloca cuerpos, cargas y apoyos' },
  { n: 2, title: '2. Plantear', hint: 'Ecuaciones derivadas del modelo' },
  { n: 3, title: '3. Valorizar', hint: 'Numeros, diagramas y mapas' },
] as const;

const MODULES: { id: Module; label: string }[] = [
  { id: 'statics', label: 'Estatica' },
  { id: 'em', label: 'Electro' },
  { id: 'thermo', label: 'Termo' },
];

/** El sistema arranca vacio: la herramienta es para armar, no para mirar. */
const SEED: ProblemModel = {
  module: 'statics',
  title: 'Sistema nuevo',
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
    // Solo se cargan los ejemplos en el selector: el lienzo queda vacio para
    // que lo primero que uno haga sea poner un cuerpo, no borrar el de otro.
    fetchExamples().then(({ examples: list }) => setExamples(list)).catch(() => undefined);
    // Solo al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Cambiar de modulo empieza un sistema nuevo: cada uno tiene sus elementos
   *  y sus reglas, y mezclarlos en un mismo documento no significa nada. */
  const switchModule = (next: Module) => {
    problem.setModel(() => ({
      module: next, title: 'Sistema nuevo',
      bodies: [], supports: [], boundaries: [], probes: [],
    }));
  };

  const moduleExamples = useMemo(
    () => examples.filter((x) => x.model.module === module),
    [examples, module],
  );

  const bodies = derived?.bodies ?? [];
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
          <button type="button" onClick={() => problem.setModel(() => ({
            module, title: 'Sistema nuevo',
            bodies: [], supports: [], boundaries: [], probes: [],
          }))}>
            Vaciar
          </button>
          <span className={`pill ${status}`}>
            {status === 'deriving' ? 'derivando...' : status === 'error' ? 'error' : 'guardado'}
          </span>
        </div>
      </header>

      {error && <div className="banner error">Error del motor: {error}</div>}

      <main>
        {stage === 1 && (
          <Stage1
            model={doc.stage1}
            module={module}
            bodies={bodies}
            bindings={bindings}
            unresolved={failed}
            onChange={problem.setModel}
            onBinding={problem.setBinding}
          />
        )}
        {stage === 2 &&
          (bodies.length ? (
            <Stage2 bodies={bodies} doc={doc} orphans={orphans} onEdit={problem.setEquationEdit} />
          ) : (
            <p className="empty">Todavia no hay ecuaciones: arma el sistema en la etapa 1.</p>
          ))}
        {stage === 3 &&
          (bodies.length ? (
            <Stage3
              bodies={bodies}
              model={doc.stage1}
              module={module}
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
