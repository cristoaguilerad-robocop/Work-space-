import type {
  BoundaryCondition, Body, MechanicalLoad, ProblemModel, ScalarSource, StructuralSupport,
} from '@wf/schema';

/**
 * Catalogo de lo que se puede poner en el canvas, por modulo.
 *
 * Cada entrada sabe fabricar un elemento nuevo del modelo. La paleta se dibuja
 * a partir de esta lista, asi que agregar un elemento es agregar una entrada:
 * ni el canvas ni el inspector se tocan.
 */

export type Module = 'statics' | 'thermo' | 'em';

export interface PaletteItem {
  id: string;
  label: string;
  hint: string;
  /** Donde vive el elemento en el documento. */
  target: 'field' | 'support' | 'boundary' | 'probe';
}

export const PALETTE: Record<Module, PaletteItem[]> = {
  statics: [
    { id: 'point', label: 'Carga puntual', hint: 'Fuerza concentrada en un punto', target: 'field' },
    { id: 'uniform', label: 'Carga uniforme', hint: 'Intensidad constante sobre un tramo', target: 'field' },
    { id: 'linear', label: 'Triangular', hint: 'Intensidad que varia linealmente', target: 'field' },
    { id: 'expression', label: 'Carga custom', hint: 'Cualquier funcion w(x)', target: 'field' },
    { id: 'moment', label: 'Par', hint: 'Momento concentrado', target: 'field' },
    { id: 'pin', label: 'Apoyo fijo', hint: 'Articulado: restringe los dos ejes', target: 'support' },
    { id: 'roller', label: 'Apoyo movil', hint: 'Restringe solo la transversal', target: 'support' },
    { id: 'fixed', label: 'Empotramiento', hint: 'Restringe traslacion y giro', target: 'support' },
  ],
  thermo: [
    { id: 'uniform', label: 'Generacion uniforme', hint: 'Potencia por unidad de longitud', target: 'field' },
    { id: 'linear', label: 'Generacion variable', hint: 'Perfil lineal a lo largo del cuerpo', target: 'field' },
    { id: 'point', label: 'Fuente puntual', hint: 'Potencia concentrada en un punto', target: 'field' },
    { id: 'expression', label: 'Generacion custom', hint: 'Cualquier funcion g(x)', target: 'field' },
    { id: 'temperature', label: 'Temperatura fija', hint: 'Condicion de borde de Dirichlet', target: 'boundary' },
    { id: 'flux', label: 'Flujo impuesto', hint: 'Potencia entrante en el extremo', target: 'boundary' },
    { id: 'convection', label: 'Conveccion', hint: 'Intercambio con el ambiente', target: 'boundary' },
    { id: 'insulated', label: 'Aislado', hint: 'Flujo nulo en el extremo', target: 'boundary' },
  ],
  em: [
    { id: 'uniform', label: 'Densidad uniforme', hint: 'Carga por unidad de longitud', target: 'field' },
    { id: 'linear', label: 'Densidad variable', hint: 'Perfil lineal de carga', target: 'field' },
    { id: 'point', label: 'Carga puntual', hint: 'Carga concentrada sobre la linea', target: 'field' },
    { id: 'expression', label: 'Densidad custom', hint: 'Cualquier funcion lambda(x)', target: 'field' },
    { id: 'current', label: 'Corriente', hint: 'Convierte el cuerpo en un conductor', target: 'field' },
    { id: 'probe', label: 'Punto de observacion', hint: 'Donde medir el campo', target: 'probe' },
  ],
};

/** Un id que no choque con los que ya existen. */
export function freshId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let i = 1; ; i += 1) {
    const candidate = `${prefix}${i}`;
    if (!used.has(candidate)) return candidate;
  }
}

const DOWN = { frame: 'global' as const, vector: ['0', '-1', '0'] as [string, string, string] };

function distributionFor(kind: string) {
  switch (kind) {
    case 'point': return { type: 'point' as const, magnitude: 'P' };
    case 'linear': return { type: 'linear' as const, w_start: '0', w_end: 'w0' };
    case 'expression': return { type: 'expression' as const, expr: 'w0*sin(pi*x/L)' };
    default: return { type: 'uniform' as const, w: 'w0' };
  }
}

/** Region por defecto: los puntuales al medio, los distribuidos a medio cuerpo. */
function regionFor(kind: string, at: string, end: string) {
  if (kind === 'point' || kind === 'moment') return { type: 'point' as const, at };
  return { type: 'interval' as const, start: '0', end: `${end}/2` };
}

export function makeField(
  kind: string, module: Module, model: ProblemModel, at: string,
): MechanicalLoad | ScalarSource {
  const body = model.bodies[0];
  const end = body.domain.end;
  const taken = body.fields.map((f) => f.id);

  if (module === 'statics') {
    if (kind === 'moment') {
      return {
        kind: 'load', id: freshId('C', taken), label: 'Par', quantity: 'moment',
        region: { type: 'point', at },
        distribution: { type: 'point', magnitude: 'M0' },
        direction: DOWN, units: 'N*m',
      } as MechanicalLoad;
    }
    return {
      kind: 'load',
      id: freshId(kind === 'point' ? 'P' : 'q', taken),
      label: kind === 'point' ? 'Carga puntual' : 'Carga distribuida',
      quantity: 'force',
      region: regionFor(kind, at, end),
      distribution: distributionFor(kind),
      direction: DOWN,
      units: kind === 'point' ? 'N' : 'N/m',
    } as MechanicalLoad;
  }

  if (module === 'thermo') {
    const distribution = kind === 'point'
      ? { type: 'point' as const, magnitude: 'Q0' }
      : kind === 'linear' ? { type: 'linear' as const, w_start: '0', w_end: 'g0' }
      : kind === 'expression' ? { type: 'expression' as const, expr: 'g0*exp(-x/L)' }
      : { type: 'uniform' as const, w: 'g0' };
    return {
      kind: 'source', id: freshId('g', taken), label: 'Generacion',
      quantity: 'heat_source',
      region: kind === 'point' ? { type: 'point', at } : { type: 'full' },
      distribution, units: kind === 'point' ? 'W' : 'W/m',
    } as ScalarSource;
  }

  if (kind === 'current') {
    return {
      kind: 'source', id: freshId('I', taken), label: 'Corriente',
      quantity: 'current', region: { type: 'full' },
      distribution: { type: 'uniform', w: 'I0' }, units: 'A',
    } as ScalarSource;
  }

  const distribution = kind === 'point'
    ? { type: 'point' as const, magnitude: 'q0' }
    : kind === 'linear' ? { type: 'linear' as const, w_start: '0', w_end: 'lam0' }
    : kind === 'expression' ? { type: 'expression' as const, expr: 'lam0*exp(-x/L)' }
    : { type: 'uniform' as const, w: 'lam0' };
  return {
    kind: 'source', id: freshId(kind === 'point' ? 'q' : 'lam', taken),
    label: kind === 'point' ? 'Carga puntual' : 'Densidad de carga',
    quantity: 'charge_density',
    region: kind === 'point' ? { type: 'point', at } : { type: 'full' },
    distribution, units: kind === 'point' ? 'C' : 'C/m',
  } as ScalarSource;
}

export function makeSupport(kind: string, model: ProblemModel, at: string): StructuralSupport {
  return {
    id: freshId('S', model.supports.map((s) => s.id)),
    body_id: model.bodies[0].id,
    at,
    type: (kind as StructuralSupport['type']) ?? 'roller',
    elevation: '0',
    label: '',
  };
}

export function makeBoundary(kind: string, model: ProblemModel, at: string): BoundaryCondition {
  const type = kind as BoundaryCondition['type'];
  return {
    id: freshId('B', model.boundaries.map((b) => b.id)),
    body_id: model.bodies[0].id,
    at,
    type,
    value: type === 'temperature' ? 'T1'
      : type === 'flux' ? 'Q0'
      : type === 'convection' ? 'T_inf' : null,
    h: type === 'convection' ? 'h_c' : null,
    label: '',
  };
}

export function bodyOf(model: ProblemModel): Body {
  return model.bodies[0];
}
