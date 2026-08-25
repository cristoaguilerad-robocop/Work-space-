import type { BoundaryCondition, ProblemModel } from '@wf/schema';

import type { Selection } from './SandboxCanvas';

interface Props {
  model: ProblemModel;
  selection: Selection;
  onChange: (update: (model: ProblemModel) => ProblemModel) => void;
  onDelete: () => void;
}

const DISTRIBUTIONS: Record<string, string> = {
  point: 'Puntual',
  uniform: 'Uniforme',
  linear: 'Lineal / triangular / trapezoidal',
  polynomial: 'Polinomica',
  expression: 'Funcion custom',
};

/** Edita el elemento seleccionado en el canvas. */
export function Inspector({ model, selection, onChange, onDelete }: Props) {
  const body = model.bodies[0];

  const patchField = (patch: Record<string, unknown>) =>
    onChange((m) => ({
      ...m,
      bodies: m.bodies.map((b, i) => (i !== 0 ? b : {
        ...b,
        fields: b.fields.map((f) => (f.id === selection.id ? { ...f, ...patch } : f)),
      })),
    }));

  let content: React.ReactNode = null;
  let title = selection.id;

  if (selection.target === 'field') {
    const field = body.fields.find((f) => f.id === selection.id);
    if (!field) return null;
    title = ('label' in field && field.label) || field.id;

    if (field.kind === 'thermal') {
      content = <p className="hint">El campo de temperatura se edita en el panel del cuerpo.</p>;
    } else {
      const distribution = field.distribution;
      content = (
        <>
          <label>
            Etiqueta
            <input value={field.label ?? ''} onChange={(e) => patchField({ label: e.target.value })} />
          </label>

          <label>
            Distribucion
            <select
              value={distribution.type}
              onChange={(e) => {
                const type = e.target.value;
                const next =
                  type === 'point' ? { type, magnitude: 'P' }
                  : type === 'uniform' ? { type, w: 'w0' }
                  : type === 'linear' ? { type, w_start: '0', w_end: 'w0' }
                  : type === 'polynomial' ? { type, coeffs: ['w0', '0'] }
                  : { type: 'expression', expr: 'w0*sin(pi*x/L)' };
                const region = type === 'point'
                  ? { type: 'point', at: 'L/2' }
                  : field.region.type === 'point' ? { type: 'full' } : field.region;
                patchField({ distribution: next, region });
              }}
            >
              {Object.entries(DISTRIBUTIONS).map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </label>

          {distribution.type === 'point' && (
            <label>
              Magnitud
              <input value={distribution.magnitude}
                     onChange={(e) => patchField({ distribution: { ...distribution, magnitude: e.target.value } })} />
            </label>
          )}
          {distribution.type === 'uniform' && (
            <label>
              Intensidad
              <input value={distribution.w}
                     onChange={(e) => patchField({ distribution: { ...distribution, w: e.target.value } })} />
            </label>
          )}
          {distribution.type === 'linear' && (
            <label>
              Inicial → final
              <span className="pair">
                <input value={distribution.w_start}
                       onChange={(e) => patchField({ distribution: { ...distribution, w_start: e.target.value } })} />
                <input value={distribution.w_end}
                       onChange={(e) => patchField({ distribution: { ...distribution, w_end: e.target.value } })} />
              </span>
            </label>
          )}
          {distribution.type === 'expression' && (
            <label>
              f(x) =
              <input value={distribution.expr}
                     onChange={(e) => patchField({ distribution: { ...distribution, expr: e.target.value } })} />
            </label>
          )}
          {distribution.type === 'polynomial' && (
            <label>
              Coeficientes
              <input value={distribution.coeffs.join(', ')}
                     onChange={(e) => patchField({
                       distribution: { ...distribution, coeffs: e.target.value.split(',').map((c) => c.trim()) },
                     })} />
            </label>
          )}

          <label>
            Region
            <span className="pair">
              {field.region.type === 'point' ? (
                <input value={field.region.at}
                       onChange={(e) => patchField({ region: { type: 'point', at: e.target.value } })} />
              ) : (
                <>
                  <input value={field.region.type === 'interval' ? field.region.start : '0'}
                         onChange={(e) => patchField({
                           region: {
                             type: 'interval', start: e.target.value,
                             end: field.region.type === 'interval' ? field.region.end : body.domain.end,
                           },
                         })} />
                  <input value={field.region.type === 'interval' ? field.region.end : body.domain.end}
                         onChange={(e) => patchField({
                           region: {
                             type: 'interval',
                             start: field.region.type === 'interval' ? field.region.start : '0',
                             end: e.target.value,
                           },
                         })} />
                </>
              )}
            </span>
          </label>

          {field.kind === 'load' && (
            <label>
              Sentido
              <select
                value={field.direction.vector[1] === '-1' ? 'down' : 'up'}
                onChange={(e) => patchField({
                  direction: { frame: 'global', vector: ['0', e.target.value === 'down' ? '-1' : '1', '0'] },
                })}
              >
                <option value="down">Hacia abajo</option>
                <option value="up">Hacia arriba</option>
              </select>
            </label>
          )}
        </>
      );
    }
  }

  if (selection.target === 'support') {
    const support = model.supports.find((s) => s.id === selection.id);
    if (!support) return null;
    content = (
      <>
        <label>
          Tipo
          <select
            value={support.type}
            onChange={(e) => onChange((m) => ({
              ...m,
              supports: m.supports.map((s) => (s.id === support.id
                ? { ...s, type: e.target.value as typeof s.type } : s)),
            }))}
          >
            <option value="pin">Articulado (pin)</option>
            <option value="roller">Movil (roller)</option>
            <option value="fixed">Empotrado</option>
          </select>
        </label>
        <label>
          Posicion
          <input value={support.at}
                 onChange={(e) => onChange((m) => ({
                   ...m,
                   supports: m.supports.map((s) => (s.id === support.id ? { ...s, at: e.target.value } : s)),
                 }))} />
        </label>
      </>
    );
  }

  if (selection.target === 'boundary') {
    const boundary = model.boundaries.find((b) => b.id === selection.id);
    if (!boundary) return null;
    const patch = (next: Partial<BoundaryCondition>) => onChange((m) => ({
      ...m,
      boundaries: m.boundaries.map((b) => (b.id === boundary.id ? { ...b, ...next } : b)),
    }));
    content = (
      <>
        <label>
          Tipo
          <select value={boundary.type} onChange={(e) => {
            const type = e.target.value as BoundaryCondition['type'];
            patch({
              type,
              value: type === 'temperature' ? 'T1' : type === 'flux' ? 'Q0'
                : type === 'convection' ? 'T_inf' : null,
              h: type === 'convection' ? 'h_c' : null,
            });
          }}>
            <option value="temperature">Temperatura impuesta</option>
            <option value="flux">Flujo impuesto</option>
            <option value="convection">Conveccion</option>
            <option value="insulated">Aislado</option>
          </select>
        </label>
        {boundary.type !== 'insulated' && (
          <label>
            {boundary.type === 'convection' ? 'Temperatura ambiente' : 'Valor'}
            <input value={boundary.value ?? ''} onChange={(e) => patch({ value: e.target.value })} />
          </label>
        )}
        {boundary.type === 'convection' && (
          <label>
            Coeficiente h
            <input value={boundary.h ?? ''} onChange={(e) => patch({ h: e.target.value })} />
          </label>
        )}
        <label>
          Posicion
          <input value={boundary.at} onChange={(e) => patch({ at: e.target.value })} />
        </label>
      </>
    );
  }

  if (selection.target === 'probe') {
    const probe = model.probes.find((p) => p.id === selection.id);
    if (!probe) return null;
    content = (
      <label>
        Posicion (x, y)
        <span className="pair">
          {[0, 1].map((axis) => (
            <input
              key={axis}
              value={String(probe.at[axis])}
              onChange={(e) => onChange((m) => ({
                ...m,
                probes: m.probes.map((p) => {
                  if (p.id !== probe.id) return p;
                  const at = [...p.at] as [string, string, string];
                  at[axis] = e.target.value;
                  return { ...p, at };
                }),
              }))}
            />
          ))}
        </span>
      </label>
    );
  }

  return (
    <section className="plate inspector">
      <div className="panel-head">
        <h2>{title}</h2>
        <button type="button" className="danger" onClick={onDelete}>Quitar</button>
      </div>
      <div className="grid">{content}</div>
    </section>
  );
}
