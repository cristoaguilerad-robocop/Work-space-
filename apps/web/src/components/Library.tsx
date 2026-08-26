import type { DocSummary } from '@wf/schema';

import type { Module } from '../lib/elements';

interface Props {
  module: Module;
  docs: DocSummary[];
  currentId: string;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDuplicate: () => void;
  onDelete: (id: string) => void;
}

const MODULE_LABEL: Record<string, string> = {
  statics: 'Estatica',
  em: 'Electro',
  thermo: 'Termo',
};

function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
    + ' ' + date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/**
 * Biblioteca de ejercicios de la materia.
 *
 * Cada materia tiene la suya: mezclar un problema de vigas con uno de campos
 * en una misma lista no ayuda a encontrar nada, y son cursos distintos.
 */
export function Library({
  module, docs, currentId, onOpen, onNew, onDuplicate, onDelete,
}: Props) {
  const mine = docs.filter((doc) => doc.module === module);

  return (
    <section className="plate library">
      <div className="panel-head">
        <h2>Ejercicios de {MODULE_LABEL[module] ?? module} ({mine.length})</h2>
        <span>
          <button type="button" onClick={onNew}>+ Nuevo</button>{' '}
          <button type="button" onClick={onDuplicate}>Duplicar este</button>
        </span>
      </div>

      {mine.length === 0 ? (
        <p className="hint">
          Todavia no guardaste ejercicios de esta materia. Se guardan solos a medida que
          los armas.
        </p>
      ) : (
        <ul className="doclist">
          {mine.map((doc) => (
            <li key={doc.id} aria-current={doc.id === currentId}>
              <button type="button" onClick={() => onOpen(doc.id)}>
                {doc.id === currentId ? <strong>{doc.title}</strong> : doc.title}
              </button>{' '}
              <span className="hint">
                {doc.steps} paso{doc.steps === 1 ? '' : 's'} · {when(doc.updatedAt)}
              </span>{' '}
              <button type="button" aria-label={`Borrar ${doc.title}`}
                      onClick={() => onDelete(doc.id)}>✕</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
