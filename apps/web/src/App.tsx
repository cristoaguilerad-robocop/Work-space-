import { useEffect, useMemo, useState } from 'react';

import { fetchExamples, type Example } from './lib/api';
import type { Module } from './lib/elements';
import { useProblem } from './lib/useProblem';
import { Library } from './components/Library';
import { Stage1 } from './components/Stage1';
import { Stage2 } from './components/Stage2';
import { Stage3 } from './components/Stage3';

const STAGES = [
  { n: 1, title: '1. Armar', hint: 'Construi el ejercicio' },
  { n: 2, title: '2. Plantear', hint: 'Escribi como lo encaras' },
  { n: 3, title: '3. Resolver', hint: 'Numeros y tu desarrollo' },
] as const;

const MODULES: { id: Module; label: string }[] = [
  { id: 'statics', label: 'Estatica' },
  { id: 'em', label: 'Electro' },
  { id: 'thermo', label: 'Termo' },
];

export function App() {
  const [examples, setExamples] = useState<Example[]>([]);
  const [stage, setStage] = useState<1 | 2 | 3>(1);
  const [showLibrary, setShowLibrary] = useState(false);
  const problem = useProblem();
  const { doc, derived, status, error, bindings, orphans } = problem;

  const module = (doc.stage1.module ?? 'statics') as Module;

  useEffect(() => {
    fetchExamples().then(({ examples: list }) => setExamples(list)).catch(() => undefined);
  }, []);

  const moduleExamples = useMemo(
    () => examples.filter((x) => x.model.module === module),
    [examples, module],
  );

  const bodies = derived?.bodies ?? [];
  const failed = derived?.errors ?? [];

  return (
    <div className="app">
      <header className="topbar">
        <strong>Workspace Funcional</strong>

        <div className="modules" role="tablist" aria-label="Materia">
          {MODULES.map((entry) => (
            <button key={entry.id} type="button" role="tab"
                    aria-selected={module === entry.id}
                    onClick={() => problem.newDoc(entry.id)}>
              {entry.label}
            </button>
          ))}
        </div>

        <label className="doctitle">
          Ejercicio
          <input value={doc.title}
                 onChange={(e) => problem.setTitle(e.target.value)} />
        </label>

        <nav className="stepper">
          {STAGES.map((s) => (
            <button key={s.n} type="button" title={s.hint}
                    className={stage === s.n ? 'active' : ''}
                    onClick={() => setStage(s.n)}>
              {s.title}
            </button>
          ))}
        </nav>

        <div className="status">
          <button type="button" aria-pressed={showLibrary}
                  onClick={() => setShowLibrary((v) => !v)}>
            Mis ejercicios ({problem.library.filter((d) => d.module === module).length})
          </button>
          <select value="" onChange={(e) => {
            const chosen = moduleExamples.find((x) => x.id === e.target.value);
            if (chosen) problem.setModel(() => chosen.model);
          }}>
            <option value="">Partir de un ejemplo...</option>
            {moduleExamples.map((x) => (
              <option key={x.id} value={x.id}>{x.title}</option>
            ))}
          </select>
          <span className={`pill ${status}`}>
            {status === 'deriving' ? 'calculando...'
              : status === 'error' ? 'sin resolver'
              : status === 'noengine' ? 'sin motor'
              : 'guardado'}
          </span>
        </div>
      </header>

      {showLibrary && (
        <Library
          module={module}
          docs={problem.library}
          currentId={doc.id}
          onOpen={problem.openDoc}
          onNew={() => problem.newDoc(module)}
          onDuplicate={problem.duplicateDoc}
          onDelete={problem.deleteDoc}
        />
      )}

      {error && <div className="banner error">Error del motor: {error}</div>}

      {status === 'noengine' && (
        <div className="banner">
          Esta copia no trae motor de calculo: los ejemplos vienen resueltos, pero
          lo que armes vos no se resuelve solo. Podes construir, mover, mirar en 3D
          y escribir tu procedimiento igual — se guarda todo.
        </div>
      )}

      <main>
        {stage === 1 && (
          <Stage1
            model={doc.stage1}
            module={module}
            bodies={bodies}
            bindings={bindings}
            unresolved={failed}
            dimension={doc.dimension}
            onDimension={problem.setDimension}
            onChange={problem.setModel}
            onBinding={problem.setBinding}
          />
        )}
        {stage === 2 && (
          <Stage2
            bodies={bodies}
            doc={doc}
            orphans={orphans}
            onEdit={problem.setEquationEdit}
            onSteps={(steps) => problem.setSteps('stage2', steps)}
          />
        )}
        {stage === 3 && (
          <Stage3
            bodies={bodies}
            model={doc.stage1}
            module={module}
            doc={doc}
            bindings={bindings}
            symbols={derived?.symbols ?? []}
            onBinding={problem.setBinding}
            onSteps={(steps) => problem.setSteps('stage3', steps)}
          />
        )}
      </main>
    </div>
  );
}
