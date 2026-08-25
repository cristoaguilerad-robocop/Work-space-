import type { Body, MechanicalLoad, ProblemModel } from '@wf/schema';
import type { DerivedBody } from '@wf/schema';

import { Canvas } from './Canvas';

interface Props {
  model: ProblemModel;
  derivedBody: DerivedBody | null;
  bindings: Record<string, number>;
  onChange: (update: (model: ProblemModel) => ProblemModel) => void;
}

type Load = MechanicalLoad;

/** Aplica un cambio al unico cuerpo del modelo (el MVP trabaja con uno). */
function patchBody(model: ProblemModel, patch: (body: Body) => Body): ProblemModel {
  return { ...model, bodies: model.bodies.map((b, i) => (i === 0 ? patch(b) : b)) };
}

const DISTRIBUTION_LABELS: Record<string, string> = {
  point: 'Puntual',
  uniform: 'Uniforme',
  linear: 'Lineal / triangular / trapezoidal',
  polynomial: 'Polinomica',
  expression: 'Funcion custom de x',
};

/**
 * Etapa 1: modelar el problema.
 *
 * El editor de distribucion es la pieza central: una carga no se define por un
 * valor y una posicion, sino por una funcion sobre un tramo del dominio.
 */
export function Stage1({ model, derivedBody, bindings, onChange }: Props) {
  const body = model.bodies[0];
  if (!body) return <p className="empty">El modelo no tiene cuerpos.</p>;

  const loads = body.fields.filter((f): f is Load => f.kind === 'load');
  const thermal = body.fields.find((f) => f.kind === 'thermal');

  const updateLoad = (id: string, patch: Partial<Load>) =>
    onChange((m) =>
      patchBody(m, (b) => ({
        ...b,
        fields: b.fields.map((f) =>
          f.kind === 'load' && f.id === id ? { ...f, ...patch } : f,
        ),
      })),
    );

  const removeLoad = (id: string) =>
    onChange((m) =>
      patchBody(m, (b) => ({
        ...b,
        fields: b.fields.filter((f) => !(f.kind === 'load' && f.id === id)),
      })),
    );

  const addLoad = () =>
    onChange((m) =>
      patchBody(m, (b) => {
        const id = `q${b.fields.length + 1}`;
        const nuevo: Load = {
          kind: 'load',
          id,
          label: 'Carga nueva',
          quantity: 'force',
          region: { type: 'full' },
          distribution: { type: 'uniform', w: 'w0' },
          direction: { frame: 'global', vector: ['0', '-1', '0'] },
          units: 'N/m',
        } as Load;
        return { ...b, fields: [...b.fields, nuevo] };
      }),
    );

  return (
    <div className="stage stage1">
      <section className="panel canvas-panel">
        <h2>Modelo</h2>
        {derivedBody ? (
          <Canvas body={derivedBody} bindings={bindings} />
        ) : (
          <p className="empty">Esperando la derivacion...</p>
        )}
      </section>

      <section className="panel">
        <h2>Cuerpo</h2>
        <div className="grid">
          <label>
            Nombre
            <input
              value={body.name ?? ''}
              onChange={(e) => onChange((m) => patchBody(m, (b) => ({ ...b, name: e.target.value })))}
            />
          </label>
          <label>
            Dominio x ∈ [0, ...]
            <input
              value={body.domain.end}
              onChange={(e) =>
                onChange((m) =>
                  patchBody(m, (b) => ({ ...b, domain: { ...b.domain, end: e.target.value } })),
                )
              }
            />
          </label>
          <label>
            Modo de analisis
            <select
              value={body.analysis.mode}
              onChange={(e) =>
                onChange((m) =>
                  patchBody(m, (b) => ({
                    ...b,
                    analysis: { ...b.analysis, mode: e.target.value as 'rigid' | 'deformable' },
                  })),
                )
              }
            >
              <option value="rigid">Rigido — solo resultantes y equilibrio</option>
              <option value="deformable">Deformable — cortante, momento y elastica</option>
            </select>
          </label>
        </div>
        <p className="hint">
          En modo rigido el motor se detiene en la resultante y su punto de aplicacion. En
          deformable sigue integrando hasta la deflexion. Es el mismo pipeline, truncado
          en distinto punto.
        </p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Cargas</h2>
          <button type="button" onClick={addLoad}>+ Agregar carga</button>
        </div>

        {loads.map((load) => (
          <article key={load.id} className="load-card">
            <header>
              <input
                className="load-title"
                value={load.label ?? ''}
                onChange={(e) => updateLoad(load.id, { label: e.target.value })}
              />
              <code>{load.id}</code>
              <button type="button" className="danger" onClick={() => removeLoad(load.id)}>
                Quitar
              </button>
            </header>

            <div className="grid">
              <label>
                Tipo de distribucion
                <select
                  value={load.distribution.type}
                  onChange={(e) => {
                    const type = e.target.value;
                    const distribution =
                      type === 'point' ? { type, magnitude: 'P' }
                      : type === 'uniform' ? { type, w: 'w0' }
                      : type === 'linear' ? { type, w_start: '0', w_end: 'w0' }
                      : type === 'polynomial' ? { type, coeffs: ['w0', '0'] }
                      : { type: 'expression', expr: 'w0*sin(pi*x/L)' };
                    const region =
                      type === 'point'
                        ? { type: 'point' as const, at: 'L/2' }
                        : load.region.type === 'point'
                          ? { type: 'full' as const }
                          : load.region;
                    updateLoad(load.id, {
                      distribution: distribution as Load['distribution'],
                      region: region as Load['region'],
                    });
                  }}
                >
                  {Object.entries(DISTRIBUTION_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>

              {load.region.type === 'point' ? (
                <label>
                  Posicion
                  <input
                    value={load.region.at}
                    onChange={(e) =>
                      updateLoad(load.id, { region: { type: 'point', at: e.target.value } })
                    }
                  />
                </label>
              ) : (
                <label>
                  Tramo
                  <span className="pair">
                    <input
                      value={load.region.type === 'interval' ? load.region.start : '0'}
                      onChange={(e) =>
                        updateLoad(load.id, {
                          region: {
                            type: 'interval',
                            start: e.target.value,
                            end: load.region.type === 'interval' ? load.region.end : 'L',
                          },
                        })
                      }
                    />
                    <input
                      value={load.region.type === 'interval' ? load.region.end : 'L'}
                      onChange={(e) =>
                        updateLoad(load.id, {
                          region: {
                            type: 'interval',
                            start: load.region.type === 'interval' ? load.region.start : '0',
                            end: e.target.value,
                          },
                        })
                      }
                    />
                  </span>
                </label>
              )}

              <DistributionFields load={load} onPatch={(d) => updateLoad(load.id, { distribution: d })} />

              <label>
                Sentido
                <select
                  value={load.direction.vector[1] === '-1' ? 'down' : 'up'}
                  onChange={(e) =>
                    updateLoad(load.id, {
                      direction: {
                        frame: 'global',
                        vector: ['0', e.target.value === 'down' ? '-1' : '1', '0'],
                      } as Load['direction'],
                    })
                  }
                >
                  <option value="down">Hacia abajo</option>
                  <option value="up">Hacia arriba</option>
                </select>
              </label>
            </div>
          </article>
        ))}
      </section>

      <section className="panel">
        <h2>Campo de temperatura</h2>
        {thermal && thermal.kind === 'thermal' && thermal.profile.type === 'linear_through_section' ? (
          <div className="grid">
            <label>
              T en la cara superior
              <input
                value={thermal.profile.T_top}
                onChange={(e) =>
                  onChange((m) =>
                    patchBody(m, (b) => ({
                      ...b,
                      fields: b.fields.map((f) =>
                        f.kind === 'thermal' && f.profile.type === 'linear_through_section'
                          ? { ...f, profile: { ...f.profile, T_top: e.target.value } }
                          : f,
                      ),
                    })),
                  )
                }
              />
            </label>
            <label>
              T en la cara inferior
              <input
                value={thermal.profile.T_bottom}
                onChange={(e) =>
                  onChange((m) =>
                    patchBody(m, (b) => ({
                      ...b,
                      fields: b.fields.map((f) =>
                        f.kind === 'thermal' && f.profile.type === 'linear_through_section'
                          ? { ...f, profile: { ...f.profile, T_bottom: e.target.value } }
                          : f,
                      ),
                    })),
                  )
                }
              />
            </label>
          </div>
        ) : (
          <p className="hint">Este cuerpo no tiene campo termico definido.</p>
        )}
        <p className="hint">
          El perfil guarda la temperatura arriba y abajo por separado, no un promedio: la
          diferencia es lo que produce curvatura termica.
        </p>
      </section>

      <section className="panel">
        <h2>Apoyos</h2>
        {model.supports.map((support) => (
          <div key={support.id} className="grid support-row">
            <label>
              Id
              <input value={support.id} readOnly />
            </label>
            <label>
              Tipo
              <select
                value={support.type}
                onChange={(e) =>
                  onChange((m) => ({
                    ...m,
                    supports: m.supports.map((s) =>
                      s.id === support.id
                        ? { ...s, type: e.target.value as typeof s.type }
                        : s,
                    ),
                  }))
                }
              >
                <option value="pin">Articulado (pin)</option>
                <option value="roller">Movil (roller)</option>
                <option value="fixed">Empotrado</option>
              </select>
            </label>
            <label>
              Posicion
              <input
                value={support.at}
                onChange={(e) =>
                  onChange((m) => ({
                    ...m,
                    supports: m.supports.map((s) =>
                      s.id === support.id ? { ...s, at: e.target.value } : s,
                    ),
                  }))
                }
              />
            </label>
          </div>
        ))}
        <p className="hint">
          Los apoyos se anclan a la coordenada del dominio, no a pixeles: mover el cuerpo en
          el canvas no toca el planteo.
        </p>
      </section>
    </div>
  );
}

function DistributionFields({
  load,
  onPatch,
}: {
  load: Load;
  onPatch: (d: Load['distribution']) => void;
}) {
  const d = load.distribution;
  switch (d.type) {
    case 'point':
      return (
        <label>
          Magnitud
          <input value={d.magnitude} onChange={(e) => onPatch({ ...d, magnitude: e.target.value })} />
        </label>
      );
    case 'uniform':
      return (
        <label>
          Intensidad w
          <input value={d.w} onChange={(e) => onPatch({ ...d, w: e.target.value })} />
        </label>
      );
    case 'linear':
      return (
        <label>
          Intensidad inicial → final
          <span className="pair">
            <input value={d.w_start} onChange={(e) => onPatch({ ...d, w_start: e.target.value })} />
            <input value={d.w_end} onChange={(e) => onPatch({ ...d, w_end: e.target.value })} />
          </span>
        </label>
      );
    case 'polynomial':
      return (
        <label>
          Coeficientes (separados por coma)
          <input
            value={d.coeffs.join(', ')}
            onChange={(e) =>
              onPatch({ ...d, coeffs: e.target.value.split(',').map((c) => c.trim()) })
            }
          />
        </label>
      );
    case 'expression':
      return (
        <label>
          w(x) =
          <input value={d.expr} onChange={(e) => onPatch({ ...d, expr: e.target.value })} />
        </label>
      );
    default:
      return null;
  }
}
