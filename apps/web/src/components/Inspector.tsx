import type { Body, BoundaryCondition, ProblemModel } from '@wf/schema';

import { BODY_LABELS, isRigidShape } from '../lib/elements';
import type { Selection } from './WorldCanvas';

/** Como se llama cada medida de una figura rigida en la ficha. */
const SHAPE_LABELS = {
  radius: 'Radio', height: 'Alto', mass: 'Masa', stiffness: 'Constante k',
} as const;

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

/** Edita lo que este seleccionado en el canvas. */
export function Inspector({ model, selection, onChange, onDelete }: Props) {
  const patchBody = (bodyId: string, patch: (body: Body) => Body) =>
    onChange((m) => ({ ...m, bodies: m.bodies.map((b) => (b.id === bodyId ? patch(b) : b)) }));

  const patchField = (bodyId: string, fieldId: string, patch: Record<string, unknown>) =>
    patchBody(bodyId, (b) => ({
      ...b,
      fields: b.fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)),
    }));

  let content: React.ReactNode = null;
  let title = selection.id;

  // ------------------------------------------------------------------ cuerpo

  if (selection.target === 'body') {
    const body = model.bodies.find((b) => b.id === selection.id);
    if (!body) return null;
    title = body.name || body.id;
    const isCable = body.analysis.dof === 'cable';
    const rigid = isRigidShape(body.type);
    // El dominio de un cuerpo va de 0 a un simbolo, pero ese simbolo no siempre
    // es un largo: en un disco es el radio y en un bloque es el ancho. Llamarlo
    // por su nombre evita tener que adivinar que mide.
    const spanLabel = body.type === 'disc' || body.type === 'sphere' ? 'Radio'
      : body.type === 'block' ? 'Ancho'
      : rigid ? 'Largo' : 'Dominio x ∈ [0, ...]';
    const origin = body.domain.embedding.type === 'straight'
      ? (body.domain.embedding.origin as unknown as [string, string, string])
      : ['0', '0', '0'];

    content = (
      <>
        <label>
          Nombre
          <input value={body.name ?? ''}
                 onChange={(e) => patchBody(body.id, (b) => ({ ...b, name: e.target.value }))} />
        </label>
        <label>
          {spanLabel}
          <input value={body.domain.end}
                 onChange={(e) => patchBody(body.id, (b) => ({
                   ...b, domain: { ...b.domain, end: e.target.value },
                 }))} />
        </label>
        <label>
          Posicion del origen (x, y)
          <span className="pair">
            {[0, 1].map((axis) => (
              <input key={axis} value={origin[axis]}
                     onChange={(e) => patchBody(body.id, (b) => {
                       if (b.domain.embedding.type !== 'straight') return b;
                       const next = [...origin] as [string, string, string];
                       next[axis] = e.target.value;
                       return {
                         ...b,
                         domain: { ...b.domain, embedding: { ...b.domain.embedding, origin: next } },
                       };
                     })} />
            ))}
          </span>
        </label>

        {rigid && (
          <>
            <p className="hint">
              {BODY_LABELS[body.type] ?? body.type}: se arma, se mide y se anota. El motor
              todavia no lo resuelve solo — su equilibrio es otra teoria, no la de vigas.
            </p>
            {(['radius', 'height', 'mass', 'stiffness'] as const)
              .filter((key) => body.shape?.[key] !== null && body.shape?.[key] !== undefined)
              .map((key) => (
                <label key={key}>
                  {SHAPE_LABELS[key]}
                  <input value={body.shape?.[key] ?? ''}
                         onChange={(e) => patchBody(body.id, (b) => (!b.shape ? b : {
                           ...b, shape: { ...b.shape, [key]: e.target.value },
                         }))} />
                </label>
              ))}
          </>
        )}

        {model.module === 'statics' && !rigid && (
          <label>
            Tipo de cuerpo
            <select
              value={isCable ? 'cable' : 'beam'}
              onChange={(e) => {
                const cable = e.target.value === 'cable';
                patchBody(body.id, (b) => ({
                  ...b,
                  type: cable ? 'cable' : 'beam',
                  analysis: {
                    ...b.analysis,
                    dof: cable ? 'cable' : '1d_beam',
                    mode: cable ? 'rigid' : b.analysis.mode,
                  },
                  cable: cable ? (b.cable ?? { mode: 'sag', sag: 'f', at: null, H: null }) : null,
                }));
                // Un cable cuelga de dos articulaciones: un apoyo movil no lo sostiene.
                if (cable) {
                  onChange((m) => ({
                    ...m,
                    supports: m.supports.map((s) => (s.body_id === body.id
                      ? { ...s, type: 'pin' as const } : s)),
                  }));
                }
              }}
            >
              <option value="beam">Viga — con rigidez a flexion</option>
              <option value="cable">Cable — flexible, forma libre</option>
            </select>
          </label>
        )}

        {isCable && body.cable && (
          <label>
            Flecha
            <input value={body.cable.sag ?? ''}
                   onChange={(e) => patchBody(body.id, (b) => (!b.cable ? b : {
                     ...b, cable: { ...b.cable, sag: e.target.value },
                   }))} />
          </label>
        )}

        {model.module === 'statics' && !isCable && !rigid && (
          <label>
            Modo de analisis
            <select value={body.analysis.mode}
                    onChange={(e) => patchBody(body.id, (b) => ({
                      ...b,
                      analysis: { ...b.analysis, mode: e.target.value as 'rigid' | 'deformable' },
                    }))}>
              <option value="rigid">Rigido — resultantes y equilibrio</option>
              <option value="deformable">Deformable — hasta la elastica</option>
            </select>
          </label>
        )}

        {(['E', 'I', 'A', 'k', 'alpha', 'h'] as const)
          .filter((key) => body.constitutive[key] !== null && body.constitutive[key] !== undefined)
          .map((key) => (
            <label key={key}>
              {key}
              <input value={body.constitutive[key] ?? ''}
                     onChange={(e) => patchBody(body.id, (b) => ({
                       ...b, constitutive: { ...b.constitutive, [key]: e.target.value },
                     }))} />
            </label>
          ))}
      </>
    );
  }

  // ------------------------------------------------------------------- campo

  if (selection.target === 'field') {
    const body = model.bodies.find((b) => b.id === selection.bodyId);
    const field = body?.fields.find((f) => f.id === selection.id);
    if (!body || !field) return null;
    title = ('label' in field && field.label) || field.id;

    if (field.kind === 'thermal') {
      content = (
        <>
          {(['T_top', 'T_bottom'] as const).map((key) => (
            field.profile.type === 'linear_through_section' && (
              <label key={key}>
                {key === 'T_top' ? 'T en la cara superior' : 'T en la cara inferior'}
                <input value={field.profile[key]}
                       onChange={(e) => patchField(body.id, field.id, {
                         profile: { ...field.profile, [key]: e.target.value },
                       })} />
              </label>
            )
          ))}
        </>
      );
    } else {
      const distribution = field.distribution;
      content = (
        <>
          <label>
            Etiqueta
            <input value={field.label ?? ''}
                   onChange={(e) => patchField(body.id, field.id, { label: e.target.value })} />
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
                  ? { type: 'point', at: `${body.domain.end}/2` }
                  : field.region.type === 'point' ? { type: 'full' } : field.region;
                patchField(body.id, field.id, { distribution: next, region });
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
                     onChange={(e) => patchField(body.id, field.id, {
                       distribution: { ...distribution, magnitude: e.target.value } })} />
            </label>
          )}
          {distribution.type === 'uniform' && (
            <label>
              Intensidad
              <input value={distribution.w}
                     onChange={(e) => patchField(body.id, field.id, {
                       distribution: { ...distribution, w: e.target.value } })} />
            </label>
          )}
          {distribution.type === 'linear' && (
            <label>
              Inicial → final
              <span className="pair">
                <input value={distribution.w_start}
                       onChange={(e) => patchField(body.id, field.id, {
                         distribution: { ...distribution, w_start: e.target.value } })} />
                <input value={distribution.w_end}
                       onChange={(e) => patchField(body.id, field.id, {
                         distribution: { ...distribution, w_end: e.target.value } })} />
              </span>
            </label>
          )}
          {distribution.type === 'expression' && (
            <label>
              f(x) =
              <input value={distribution.expr}
                     onChange={(e) => patchField(body.id, field.id, {
                       distribution: { ...distribution, expr: e.target.value } })} />
            </label>
          )}
          {distribution.type === 'polynomial' && (
            <label>
              Coeficientes
              <input value={distribution.coeffs.join(', ')}
                     onChange={(e) => patchField(body.id, field.id, {
                       distribution: {
                         ...distribution,
                         coeffs: e.target.value.split(',').map((c) => c.trim()),
                       },
                     })} />
            </label>
          )}

          <label>
            Region
            <span className="pair">
              {field.region.type === 'point' ? (
                <input value={field.region.at}
                       onChange={(e) => patchField(body.id, field.id, {
                         region: { type: 'point', at: e.target.value } })} />
              ) : (
                <>
                  <input value={field.region.type === 'interval' ? field.region.start : '0'}
                         onChange={(e) => patchField(body.id, field.id, {
                           region: {
                             type: 'interval', start: e.target.value,
                             end: field.region.type === 'interval' ? field.region.end : body.domain.end,
                           },
                         })} />
                  <input value={field.region.type === 'interval' ? field.region.end : body.domain.end}
                         onChange={(e) => patchField(body.id, field.id, {
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
              <select value={field.direction.vector[1] === '-1' ? 'down' : 'up'}
                      onChange={(e) => patchField(body.id, field.id, {
                        direction: {
                          frame: 'global',
                          vector: ['0', e.target.value === 'down' ? '-1' : '1', '0'],
                        },
                      })}>
                <option value="down">Hacia abajo</option>
                <option value="up">Hacia arriba</option>
              </select>
            </label>
          )}
        </>
      );
    }
  }

  // ------------------------------------------------------------------- apoyo

  if (selection.target === 'support') {
    const support = model.supports.find((s) => s.id === selection.id);
    if (!support) return null;
    content = (
      <>
        <label>
          Tipo
          <select value={support.type}
                  onChange={(e) => onChange((m) => ({
                    ...m,
                    supports: m.supports.map((s) => (s.id === support.id
                      ? { ...s, type: e.target.value as typeof s.type } : s)),
                  }))}>
            <option value="pin">Articulado (pin)</option>
            <option value="roller">Movil (roller)</option>
            <option value="fixed">Empotrado</option>
          </select>
        </label>
        <label>
          Posicion en el cuerpo
          <input value={support.at}
                 onChange={(e) => onChange((m) => ({
                   ...m,
                   supports: m.supports.map((s) => (s.id === support.id ? { ...s, at: e.target.value } : s)),
                 }))} />
        </label>
        <label>
          Cota (solo cables)
          <input value={support.elevation}
                 onChange={(e) => onChange((m) => ({
                   ...m,
                   supports: m.supports.map((s) => (s.id === support.id
                     ? { ...s, elevation: e.target.value } : s)),
                 }))} />
        </label>
      </>
    );
  }

  // ------------------------------------------------------------------- borde

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
            Coeficiente de pelicula
            <input value={boundary.h ?? ''} onChange={(e) => patch({ h: e.target.value })} />
          </label>
        )}
        <label>
          Posicion en el cuerpo
          <input value={boundary.at} onChange={(e) => patch({ at: e.target.value })} />
        </label>
      </>
    );
  }

  // ------------------------------------------------------------------- sonda

  if (selection.target === 'probe') {
    const probe = model.probes.find((p) => p.id === selection.id);
    if (!probe) return null;
    content = (
      <label>
        Posicion (x, y)
        <span className="pair">
          {[0, 1].map((axis) => (
            <input key={axis} value={String(probe.at[axis])}
                   onChange={(e) => onChange((m) => ({
                     ...m,
                     probes: m.probes.map((p) => {
                       if (p.id !== probe.id) return p;
                       const at = [...p.at] as [string, string, string];
                       at[axis] = e.target.value;
                       return { ...p, at };
                     }),
                   }))} />
          ))}
        </span>
      </label>
    );
  }

  return (
    <section className="plate">
      <div className="panel-head">
        <h2>{title}</h2>
        <button type="button" onClick={onDelete}>Quitar</button>
      </div>
      <div className="grid">{content}</div>
    </section>
  );
}
