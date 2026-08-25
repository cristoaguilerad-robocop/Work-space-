import type { DerivedBody, ProblemDoc } from '@wf/schema';

import { value } from '../lib/evaluate';
import { FieldMap } from './FieldMap';
import { Katex } from './Katex';
import { Plot } from './Plot';
import type { Module } from '../lib/elements';
import { SandboxCanvas } from './SandboxCanvas';

interface Props {
  body: DerivedBody;
  doc: ProblemDoc;
  bindings: Record<string, number>;
  symbols: { name: string; latex: string; units: string; description: string }[];
  onBinding: (name: string, next: number) => void;
}

interface Diagram { key: string; title: string; units: string; color: string }

/** Que se grafica en cada modulo. En Electro no hay curvas sobre el dominio:
 *  el resultado vive en el plano, asi que va un mapa en vez de un diagrama. */
const DIAGRAMS: Record<string, Diagram[]> = {
  statics: [
    { key: 'V', title: 'Cortante V(x)', units: 'N', color: 'var(--c-shear)' },
    { key: 'M', title: 'Momento flector M(x)', units: 'N·m', color: 'var(--c-moment)' },
    { key: 'theta', title: 'Pendiente θ(x)', units: 'rad', color: 'var(--c-slope)' },
    { key: 'y', title: 'Deflexion y(x)', units: 'm', color: 'var(--c-defl)' },
    { key: 'N', title: 'Fuerza axial N(x)', units: 'N', color: 'var(--c-defl)' },
  ],
  thermo: [
    { key: 'T', title: 'Temperatura T(x)', units: '°C', color: 'var(--c-moment)' },
    { key: 'Q', title: 'Flujo de calor Q(x)', units: 'W', color: 'var(--c-shear)' },
  ],
  em: [],
  cable: [
    { key: 'y', title: 'Curva del cable y(x)', units: 'm', color: 'var(--c-defl)' },
    { key: 'V', title: 'Componente vertical V(x)', units: 'N', color: 'var(--c-shear)' },
    { key: 'T', title: 'Tension T(x)', units: 'N', color: 'var(--c-moment)' },
  ],
};

/** Nombres legibles para los escalares que devuelve el motor. */
const SCALAR_LABELS: Record<string, string> = {
  elongation: 'Alargamiento δ',
  generated: 'Potencia generada',
  Q_in: 'Calor entrante',
  Q_out: 'Calor saliente',
  total: 'Carga / corriente total',
  centroid: 'Centroide de la fuente',
  H: 'Tension horizontal H',
  T_A: 'Tension en A',
  T_B: 'Tension en B',
  length: 'Longitud del cable',
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
  // Un cable comparte modulo con la viga pero grafica otras cosas.
  const module = body.kind === 'cable' ? 'cable' : (body.module ?? 'statics');
  const L = value(body.length.js, bindings) || 1;
  const breaks = body.loads
    .filter((l) => l.kind === 'point' || l.kind === 'couple')
    .map((l) => value(l.start.js, bindings))
    .filter(Number.isFinite);

  const quarantined = Object.entries(doc.stage3.quarantined);
  const diagrams = (DIAGRAMS[module] ?? []).filter((d) => body.functions[d.key]);

  return (
    <div className="stage stage3">
      <section className="plate">
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
          <details className="quarantine">
            <summary>
              {quarantined.length} valor{quarantined.length === 1 ? '' : 'es'} en cuarentena
            </summary>
            <p className="hint">
              Su simbolo ya no esta en el modelo, pero el valor se conserva: si volves a
              usarlo, reaparece como lo dejaste.
            </p>
            <p className="hint mono">
              {quarantined.map(([name, b]) => `${name} = ${b.value}`).join('   ')}
            </p>
          </details>
        )}
      </section>

      <section className="plate">
        <h2>Resultados</h2>
        <table className="results">
          <tbody>
            {Object.entries(body.reactions).map(([name, packaged]) => (
              <tr key={name}>
                <th className="sym-cell"><Katex latex={name} /></th>
                <td className="expr"><Katex latex={packaged.latex} /></td>
                <td className="num">{format(value(packaged.js, bindings))}</td>
              </tr>
            ))}
            {Object.entries(body.scalars).map(([name, packaged]) => (
              <tr key={name}>
                <th className="sym-cell">{SCALAR_LABELS[name] ?? name}</th>
                <td className="expr"><Katex latex={packaged.latex} /></td>
                <td className="num">{format(value(packaged.js, bindings))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {module === 'em' ? (
        <section className="plate wide">
          <h2>Mapa del campo</h2>
          <FieldMap body={body} bindings={bindings} />
        </section>
      ) : (
        <section className="plate">
          <h2>Diagramas</h2>
          <div className="plots">
            {diagrams.map((diagram) => (
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
      )}

      <section className="plate recap">
        <h2>Lo armado en la etapa 1</h2>
        <SandboxCanvas
          body={body}
          model={doc.stage1}
          module={(body.module ?? 'statics') as Module}
          bindings={bindings}
          selection={null}
          onSelect={() => undefined}
          onChange={() => undefined}
          pending={null}
          onPlace={() => undefined}
        />
      </section>

      <section className="plate recap">
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
