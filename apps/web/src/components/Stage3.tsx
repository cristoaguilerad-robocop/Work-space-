import type { DerivedBody, ProblemDoc } from '@wf/schema';

import { value } from '../lib/evaluate';
import { Canvas } from './Canvas';
import { Katex } from './Katex';
import { Plot } from './Plot';

interface Props {
  body: DerivedBody;
  doc: ProblemDoc;
  bindings: Record<string, number>;
  symbols: { name: string; latex: string; units: string; description: string }[];
  onBinding: (name: string, next: number) => void;
}

const DIAGRAMS: { key: string; title: string; units: string; color: string }[] = [
  { key: 'V', title: 'Cortante V(x)', units: 'N', color: 'var(--c-shear)' },
  { key: 'M', title: 'Momento flector M(x)', units: 'N·m', color: 'var(--c-moment)' },
  { key: 'theta', title: 'Pendiente θ(x)', units: 'rad', color: 'var(--c-slope)' },
  { key: 'y', title: 'Deflexion y(x)', units: 'm', color: 'var(--c-defl)' },
];

/** Nombres legibles para los escalares que devuelve el motor. */
const SCALAR_LABELS: Record<string, string> = {
  elongation: 'Alargamiento δ',
};

function format(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  return Math.abs(v) >= 1e5 || Math.abs(v) < 1e-3 ? v.toExponential(4) : v.toFixed(4);
}

/**
 * Etapa 3: valores numericos.
 *
 * Todo se evalua en el navegador con las funciones que compilo el motor, asi
 * que mover un valor redibuja los diagramas sin ninguna ida y vuelta por red.
 * El modelo de la etapa 1 y las ecuaciones de la etapa 2 quedan a la vista.
 */
export function Stage3({ body, doc, bindings, symbols, onBinding }: Props) {
  const L = value(body.length.js, bindings) || 1;
  const breaks = body.loads
    .filter((l) => l.kind === 'point' || l.kind === 'couple')
    .map((l) => value(l.start.js, bindings))
    .filter(Number.isFinite);

  const quarantined = Object.entries(doc.stage3.quarantined);

  return (
    <div className="stage stage3">
      <section className="panel">
        <h2>Valores</h2>
        <div className="bindings">
          {symbols.map((symbol) => (
            <label key={symbol.name} title={symbol.description}>
              <span className="sym"><Katex latex={symbol.latex} /></span>
              <input
                type="number"
                value={bindings[symbol.name] ?? ''}
                step="any"
                onChange={(e) => onBinding(symbol.name, Number(e.target.value))}
              />
              <span className="units">{symbol.units}</span>
            </label>
          ))}
        </div>
        {quarantined.length > 0 && (
          <p className="hint">
            En cuarentena (su simbolo ya no esta en el modelo, pero el valor se conserva):{' '}
            {quarantined.map(([name, b]) => `${name} = ${b.value}`).join(', ')}
          </p>
        )}
      </section>

      <section className="panel">
        <h2>Resultados</h2>
        <table className="results">
          <tbody>
            {Object.entries(body.reactions).map(([name, packaged]) => (
              <tr key={name}>
                <th><Katex latex={name} /></th>
                <td><Katex latex={packaged.latex} /></td>
                <td className="numeric">{format(value(packaged.js, bindings))}</td>
              </tr>
            ))}
            {Object.entries(body.scalars).map(([name, packaged]) => (
              <tr key={name}>
                <th>{SCALAR_LABELS[name] ?? name}</th>
                <td><Katex latex={packaged.latex} /></td>
                <td className="numeric">{format(value(packaged.js, bindings))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Diagramas</h2>
        <div className="plots">
          {DIAGRAMS.filter((d) => body.functions[d.key]).map((diagram) => (
            <Plot
              key={diagram.key}
              title={diagram.title}
              units={diagram.units}
              fn={body.functions[diagram.key].js}
              bindings={bindings}
              length={L}
              breaks={breaks}
              color={diagram.color}
            />
          ))}
        </div>
      </section>

      <section className="panel recap">
        <h2>Lo definido en la etapa 1</h2>
        <Canvas body={body} bindings={bindings} />
      </section>

      <section className="panel recap">
        <h2>Lo planteado en la etapa 2</h2>
        {body.equations
          .filter((e) => e.role === 'equilibrium' || e.role === 'result')
          .map((e) => (
            <div key={e.id} className="recap-eq">
              <span className="eq-title">{e.title}</span>
              <Katex latex={doc.stage2.edits[e.id] ?? e.latex} display />
            </div>
          ))}
      </section>
    </div>
  );
}
