import type { DerivedBody, ProblemDoc, ProblemModel, UserStep } from '@wf/schema';

import { value } from '../lib/evaluate';
import type { Module } from '../lib/elements';
import { FieldMap } from './FieldMap';
import { Katex } from './Katex';
import { Notebook } from './Notebook';
import { Plot } from './Plot';
import { DEFAULT_VIEW, WorldCanvas } from './WorldCanvas';

interface Props {
  bodies: DerivedBody[];
  model: ProblemModel;
  module: Module;
  doc: ProblemDoc;
  bindings: Record<string, number>;
  symbols: { name: string; latex: string; units: string; description: string }[];
  onBinding: (name: string, next: number) => void;
  onSteps: (steps: UserStep[]) => void;
}

interface Diagram { key: string; title: string; units: string; color: string }

/** Que se grafica en cada caso. En Electro el resultado vive en el plano, asi
 *  que va un mapa en vez de curvas sobre el dominio. */
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
 * que mover un valor redibuja los diagramas sin ninguna ida por red. El sistema
 * armado en la etapa 1 y las ecuaciones de la 2 quedan a la vista.
 */
export function Stage3({
  bodies, model, module, doc, bindings, symbols, onBinding, onSteps,
}: Props) {
  const quarantined = Object.entries(doc.stage3.quarantined);
  const suggestions = bodies.flatMap((body) => [
    ...Object.entries(body.reactions).map(([name, p]) => ({ label: name, latex: p.latex })),
    ...Object.entries(body.scalars).map(([name, p]) =>
      ({ label: SCALAR_LABELS[name] ?? name, latex: p.latex })),
  ]);

  return (
    <div className="stage stage3">
      <Notebook
        title="Mi desarrollo"
        hint={'Anota el reemplazo de valores y el resultado al que llegas, con tus '
          + 'unidades y tus cuentas.'}
        steps={doc.stage3.steps}
        onChange={onSteps}
        suggestions={suggestions}
      />

      <section className="plate">
        <h2>Valores</h2>
        <div className="bindings">
          {symbols.map((symbol) => (
            <label key={symbol.name} title={symbol.description}>
              <span className="sym"><Katex latex={symbol.latex} /></span>
              <input type="number" value={bindings[symbol.name] ?? ''} step="any"
                     onChange={(e) => onBinding(symbol.name, Number(e.target.value))} />
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

      {bodies.map((body) => (
        <BodyResults key={body.body_id} body={body} bindings={bindings}
                     showName={bodies.length > 1} />
      ))}

      <section className="plate recap">
        <h2>Lo armado en la etapa 1</h2>
        <WorldCanvas
          bodies={bodies}
          model={model}
          module={module}
          bindings={bindings}
          selection={null}
          onSelect={() => undefined}
          onChange={() => undefined}
          pending={null}
          pendingTarget={null}
          onPlace={() => undefined}
          view={DEFAULT_VIEW}
          onView={() => undefined}
          showReactions
          interactive={false}
        />
      </section>

      <section className="plate recap">
        <h2>Lo planteado en la etapa 2</h2>
        {bodies.flatMap((body) => body.equations
          .filter((e) => e.role === 'equilibrium' || e.role === 'result')
          .map((e) => (
            <div key={e.id} className="recap-eq">
              <span className="eq-title">{e.title}</span>
              <Katex latex={doc.stage2.edits[e.id] ?? e.latex} display />
            </div>
          )))}
      </section>
    </div>
  );
}

/** Resultados y diagramas de un cuerpo. */
function BodyResults({ body, bindings, showName }: {
  body: DerivedBody; bindings: Record<string, number>; showName: boolean;
}) {
  const kind = body.kind === 'cable' ? 'cable' : (body.module ?? 'statics');
  const length = value(body.length.js, bindings) || 1;
  const breaks = body.loads
    .filter((l) => l.kind === 'point' || l.kind === 'couple')
    .map((l) => value(l.start.js, bindings))
    .filter(Number.isFinite);

  const diagrams = (DIAGRAMS[kind] ?? []).filter((d) => body.functions[d.key]);
  const rows = [
    ...Object.entries(body.reactions).map(([name, packaged]) => ({ name, packaged, math: true })),
    ...Object.entries(body.scalars).map(([name, packaged]) =>
      ({ name: SCALAR_LABELS[name] ?? name, packaged, math: false })),
  ];

  return (
    <>
      {showName && <h2>{body.name}</h2>}
      {rows.length > 0 && (
        <section className="plate">
          <h2>Resultados</h2>
          <table className="results">
            <tbody>
              {rows.map((row) => (
                <tr key={row.name}>
                  <th className="sym-cell">
                    {row.math ? <Katex latex={row.name} /> : row.name}
                  </th>
                  <td className="expr"><Katex latex={row.packaged.latex} /></td>
                  <td className="num">{format(value(row.packaged.js, bindings))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {body.field_setups ? (
        <section className="plate">
          <h2>Mapa del campo</h2>
          <FieldMap body={body} bindings={bindings} />
        </section>
      ) : diagrams.length > 0 && (
        <section className="plate">
          <h2>Diagramas</h2>
          <div className="plots">
            {diagrams.map((diagram) => (
              <Plot key={diagram.key} title={diagram.title} units={diagram.units}
                    fn={body.functions[diagram.key].js} bindings={bindings}
                    length={length} breaks={breaks} color={diagram.color} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
