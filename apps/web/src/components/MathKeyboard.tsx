import { useState } from 'react';
import katex from 'katex';

import { MATH_GROUPS, type MathKey } from '../lib/mathkeys';

interface Props {
  onInsert: (key: MathKey) => void;
}

/** Rinde la etiqueta de una tecla: LaTeX si lo parece, texto si no. */
function KeyLabel({ label }: { label: string }) {
  const isLatex = label.includes('\\') || label.includes('{') || label.includes('^');
  if (!isLatex) return <>{label}</>;
  try {
    return <span dangerouslySetInnerHTML={{
      __html: katex.renderToString(label, { throwOnError: false }),
    }} />;
  } catch {
    return <>{label}</>;
  }
}

/**
 * Teclado de simbolos.
 *
 * Existe porque escribir el procedimiento a mano es el punto de la
 * herramienta, y nadie deberia tener que acordarse de `\varepsilon` para poder
 * anotar lo que hizo. Inserta en el cursor del campo que este activo.
 */
export function MathKeyboard({ onInsert }: Props) {
  const [group, setGroup] = useState(MATH_GROUPS[0].id);
  const active = MATH_GROUPS.find((g) => g.id === group) ?? MATH_GROUPS[0];

  return (
    <div className="mathkeys">
      <div className="mathkeys-tabs">
        {MATH_GROUPS.map((entry) => (
          <button key={entry.id} type="button" aria-pressed={entry.id === group}
                  onClick={() => setGroup(entry.id)}>
            {entry.label}
          </button>
        ))}
      </div>
      <div className="mathkeys-grid">
        {active.keys.map((key) => (
          <button
            key={key.latex + key.label}
            type="button"
            title={key.name ?? key.latex}
            aria-label={key.name ?? key.latex}
            // onMouseDown en vez de onClick: al hacer click el textarea pierde
            // el foco antes de que corra el handler y se pierde la posicion del
            // cursor, que es justo donde hay que insertar.
            onMouseDown={(event) => { event.preventDefault(); onInsert(key); }}
          >
            <KeyLabel label={key.label} />
          </button>
        ))}
      </div>
    </div>
  );
}
