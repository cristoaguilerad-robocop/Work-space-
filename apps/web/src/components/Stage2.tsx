import { useState } from 'react';
import type { DerivedBody, ProblemDoc, UserStep } from '@wf/schema';

import { Katex } from './Katex';
import { Notebook } from './Notebook';

interface Props {
  bodies: DerivedBody[];
  doc: ProblemDoc;
  orphans: string[];
  onEdit: (id: string, latex: string | null) => void;
  onSteps: (steps: UserStep[]) => void;
}

const ROLE_TITLES: Record<string, string> = {
  equilibrium: 'Ecuaciones de equilibrio y condiciones de borde',
  field: 'Funciones sobre el dominio',
  result: 'Resultados simbolicos',
  definition: 'Definiciones',
  check: 'Verificaciones',
};

const STEP_ICONS: Record<string, string> = {
  algebra: '=',
  integrate: '∫',
  solve: '→',
  substitute: '↦',
  check: '✓',
};

/**
 * Etapa 2: las ecuaciones derivadas del modelo, editables.
 *
 * Las ediciones se guardan como parches por id, no como una copia del texto
 * derivado: si el usuario vuelve a la etapa 1 y cambia el modelo, la derivacion
 * se rehace y los parches se re-aplican sobre el resultado nuevo.
 */
export function Stage2({ bodies, doc, orphans, onEdit, onSteps }: Props) {
  // Lo que el motor dedujo se ofrece como material para traer al cuaderno, no
  // como el contenido de la etapa: el planteo lo escribe la persona.
  const suggestions = bodies.flatMap((body) => body.equations
    .filter((e) => e.role === 'equilibrium' || e.role === 'result' || e.role === 'field')
    .map((e) => ({ label: e.title, latex: e.latex })));

  return (
    <div className="stage stage2">
      <Notebook
        title="Mi planteo"
        hint={'Escribi como encaras el ejercicio: que ecuaciones planteas y por que. '
          + 'La matematica va entre signos peso y el teclado de abajo la inserta.'}
        steps={doc.stage2.steps}
        onChange={onSteps}
        suggestions={suggestions}
      />

      <details className="derived">
        <summary>Lo que dedujo el motor ({suggestions.length} expresiones)</summary>
        <p className="hint">
          Material de consulta. Puede estar mal o no ser el camino que vos elegis: lo que
          se guarda como tu procedimiento es lo de arriba.
        </p>
      {orphans.length > 0 && (
        <div className="panel warning">
          <h2>Ediciones huerfanas</h2>
          <p>
            Estas ecuaciones ya no existen en el modelo actual. No se borraron: si deshaces el
            cambio en la etapa 1 vuelven con tu edicion.
          </p>
          <ul>
            {orphans.map((id) => (
              <li key={id}>
                <code>{id}</code>
                <button type="button" onClick={() => onEdit(id, null)}>Descartar</button>
              </li>
            ))}
          </ul>
        </div>
      )}

        {bodies.map((body) => (
          <BodyDerivation key={body.body_id} body={body} doc={doc}
                          onEdit={onEdit} showName={bodies.length > 1} />
        ))}
      </details>
    </div>
  );
}

/**
 * El planteo de un cuerpo.
 *
 * Cada cuerpo se deriva por separado: hoy no hay uniones entre cuerpos, asi que
 * lo que se ve aca es un problema independiente por cada uno.
 */
function BodyDerivation({ body, doc, onEdit, showName }: {
  body: DerivedBody; doc: ProblemDoc;
  onEdit: (id: string, latex: string | null) => void; showName: boolean;
}) {
  const [openSteps, setOpenSteps] = useState(true);
  const roles = ['equilibrium', 'result', 'field', 'definition', 'check'];

  return (
    <div>
      {showName && <h2>{body.name}</h2>}
      {body.notes.length > 0 && (
        <div className="panel warning">
          <h2>Observaciones del motor</h2>
          <ul>{body.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </div>
      )}

      {roles.map((role) => {
        const group = body.equations.filter((e) => e.role === role);
        if (group.length === 0) return null;
        return (
          <section key={role} className="panel">
            <h2>{ROLE_TITLES[role] ?? role}</h2>
            {group.map((equation) => {
              const edited = doc.stage2.edits[equation.id];
              return (
                <article key={equation.id} className="equation">
                  <header>
                    <span className="eq-title">{equation.title}</span>
                    <code className="eq-id">{equation.id}</code>
                  </header>
                  <Katex latex={edited ?? equation.latex} display />
                  {equation.detail && <p className="hint">{equation.detail}</p>}
                  <details>
                    <summary>{edited ? 'Editada' : 'Editar'}</summary>
                    <textarea
                      value={edited ?? equation.latex}
                      spellCheck={false}
                      onChange={(e) =>
                        onEdit(
                          equation.id,
                          e.target.value === equation.latex ? null : e.target.value,
                        )
                      }
                    />
                    {edited && (
                      <button type="button" onClick={() => onEdit(equation.id, null)}>
                        Volver a la derivada
                      </button>
                    )}
                  </details>
                </article>
              );
            })}
          </section>
        );
      })}

      <section className="panel">
        <div className="panel-head">
          <h2>Desarrollo paso a paso ({body.steps.length})</h2>
          <button type="button" onClick={() => setOpenSteps((v) => !v)}>
            {openSteps ? 'Contraer' : 'Expandir'}
          </button>
        </div>
        {openSteps && (
          <ol className="steps">
            {body.steps.map((step) => (
              <li key={step.id} data-kind={step.kind}>
                <span className="step-icon" aria-hidden>{STEP_ICONS[step.kind] ?? '·'}</span>
                <div>
                  <strong>{step.title}</strong>
                  {step.latex && <Katex latex={step.latex} display />}
                  {step.detail && <p className="hint">{step.detail}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
