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
  target: 'body' | 'field' | 'support' | 'boundary' | 'probe';
}

/** Cuerpos que se pueden crear, por modulo. */
const BODIES: Record<Module, PaletteItem[]> = {
  statics: [
    { id: 'beam', label: 'Viga', hint: 'Barra con rigidez a flexion', target: 'body' },
    { id: 'cable', label: 'Cable', hint: 'Flexible: la forma la da la tension', target: 'body' },
    { id: 'rod', label: 'Barra rigida', hint: 'Solo transmite fuerza: no flexiona', target: 'body' },
    { id: 'ideal_cable', label: 'Cable ideal', hint: 'Sin masa ni espesor, inextensible', target: 'body' },
    { id: 'disc', label: 'Disco / polea', hint: 'Radio R, gira sobre su centro', target: 'body' },
    { id: 'sphere', label: 'Esfera', hint: 'Radio R, masa en el centro', target: 'body' },
    { id: 'block', label: 'Bloque', hint: 'Masa apoyada: lado y peso', target: 'body' },
    { id: 'spring', label: 'Resorte', hint: 'Constante k', target: 'body' },
  ],
  thermo: [
    { id: 'bar', label: 'Barra', hint: 'Conduccion 1D a lo largo del cuerpo', target: 'body' },
  ],
  em: [
    { id: 'charged_line', label: 'Linea cargada', hint: 'Soporta densidad de carga', target: 'body' },
    { id: 'wire', label: 'Conductor', hint: 'Soporta corriente', target: 'body' },
  ],
};

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

/** La paleta completa de un modulo: primero los cuerpos, despues lo que se
 *  les pone encima. */
export function paletteFor(module: Module): PaletteItem[] {
  return [...BODIES[module], ...PALETTE[module]];
}

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
  kind: string, module: Module, body: Body, at: string,
): MechanicalLoad | ScalarSource {
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

export function makeSupport(
  kind: string, model: ProblemModel, bodyId: string, at: string,
): StructuralSupport {
  return {
    id: freshId('S', model.supports.map((s) => s.id)),
    body_id: bodyId,
    at,
    type: (kind as StructuralSupport['type']) ?? 'roller',
    elevation: '0',
    label: '',
  };
}

export function makeBoundary(
  kind: string, model: ProblemModel, bodyId: string, at: string,
): BoundaryCondition {
  const type = kind as BoundaryCondition['type'];
  return {
    id: freshId('B', model.boundaries.map((b) => b.id)),
    body_id: bodyId,
    at,
    type,
    value: type === 'temperature' ? 'T1'
      : type === 'flux' ? 'Q0'
      : type === 'convection' ? 'T_inf' : null,
    h: type === 'convection' ? 'h_c' : null,
    label: '',
  };
}

/**
 * Crea un cuerpo nuevo en el punto del mundo donde se hizo clic.
 *
 * Cada cuerpo estrena su propio simbolo de longitud (`L1`, `L2`, ...) en vez de
 * compartir `L`. Compartirlo seria simbolicamente correcto -- y a veces es lo
 * que uno quiere -- pero hace que estirar un cuerpo estire todos los demas, que
 * no es lo que nadie espera al arrastrar. Se pueden igualar despues escribiendo
 * el mismo simbolo a mano.
 */
/**
 * Figuras rigidas: las que el ejercicio dibuja pero el motor no integra.
 *
 * Un disco no tiene `q(x)`: tiene radio y masa. Aparecen aca porque el
 * ejercicio del libro las tiene y hay que poder ponerlas, medirlas y escribir
 * el procedimiento sobre ellas. La derivacion las reporta como "no la resuelvo"
 * y sigue con el resto del sistema.
 */
export const RIGID_SHAPES = new Set([
  'disc', 'sphere', 'block', 'rod', 'ideal_cable', 'spring',
]);

export function isRigidShape(kind: string): boolean {
  return RIGID_SHAPES.has(kind);
}

/**
 * Que simbolo mide el dominio de cada figura, y que mas lleva encima.
 *
 * El dominio de un cuerpo va de 0 a un simbolo, y ese simbolo es el que
 * cambia al arrastrar el extremo. En un disco el "extremo" es el borde, asi
 * que el simbolo del dominio ES el radio: arrastrarlo agranda el disco.
 */
const SHAPE_SPECS: Record<string, (n: string) => {
  span: string;
  shape: NonNullable<Body['shape']>;
}> = {
  disc: (n) => ({ span: `R${n}`, shape: { radius: `R${n}`, height: null, mass: `m${n}`, stiffness: null } }),
  sphere: (n) => ({ span: `R${n}`, shape: { radius: `R${n}`, height: null, mass: `m${n}`, stiffness: null } }),
  block: (n) => ({ span: `a${n}`, shape: { radius: null, height: `b${n}`, mass: `m${n}`, stiffness: null } }),
  rod: (n) => ({ span: `L${n}`, shape: { radius: null, height: null, mass: `m${n}`, stiffness: null } }),
  // Masa nula y espesor nulo no son valores por completar: son la definicion
  // de cable ideal. Van escritos como cero, no como simbolo a valorizar.
  ideal_cable: (n) => ({ span: `L${n}`, shape: { radius: null, height: null, mass: '0', stiffness: null } }),
  spring: (n) => ({ span: `L${n}`, shape: { radius: null, height: null, mass: null, stiffness: `k${n}` } }),
};

/**
 * Valor inicial sugerido para un simbolo que acaba de nacer en el canvas.
 *
 * Espejo de `SUGGESTIONS` en apps/api/wf_api/defaults.py. Existe de este lado
 * porque el canvas dibuja con los valores: un cuerpo cuyo largo todavia no
 * vale nada se dibuja de un metro, y una carga sin intensidad no se ve. Cuando
 * hay motor, el que ya esta puesto gana, asi que los dos lados coinciden.
 *
 * `null` significa "no tengo idea": ese simbolo lo valoriza el usuario.
 */
const SUGGESTED: Record<string, number> = {
  L: 4, f: 0.4, hB: 0.8, w0: 1000, w1: 1000, P: 5000, M0: 2000,
  E: 2e11, I: 8e-6, A: 1e-2, alpha: 1.2e-5, h: 0.1, h_c: 25,
  k: 200, rho: 7850, T_ref: 20, T0: 20, dT: 30,
  g0: 100, Q0: 400, T1: 100, T2: 20, T_inf: 20,
  lam0: 3e-9, q0: 5e-9, I0: 10, d: 0.5,
};

const SUGGESTED_PREFIXES: [RegExp, number][] = [
  [/^L\d+$/, 4], [/^R\d+$/, 0.5], [/^a\d+$/, 1], [/^b\d+$/, 0.6],
  [/^m\d+$/, 2], [/^k\d+$/, 1000], [/^w\d+$/, 1000], [/^P\d+$/, 5000],
];

export function suggestValue(symbol: string): number | null {
  if (symbol in SUGGESTED) return SUGGESTED[symbol];
  for (const [pattern, value] of SUGGESTED_PREFIXES) {
    if (pattern.test(symbol)) return value;
  }
  return null;
}

/**
 * Simbolos con valor sugerido que aparecen dentro de un elemento recien hecho.
 *
 * Se recorre el objeto entero en vez de enumerar campos: asi agregar una
 * figura nueva con una medida nueva no obliga a acordarse de esta funcion.
 * Solo salen los que tienen sugerencia, que de paso descarta `sin`, `exp` y
 * cualquier otra cosa que parezca un nombre dentro de una expresion.
 */
export function seededSymbols(node: unknown): [string, number][] {
  const out = new Map<string, number>();

  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      for (const name of value.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
        const suggestion = suggestValue(name);
        if (suggestion !== null) out.set(name, suggestion);
      }
    } else if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value && typeof value === 'object') {
      for (const [key, inner] of Object.entries(value)) {
        // Mismo criterio que `_NON_EXPR_FIELDS` en el modelo: estos campos son
        // texto, no expresiones. Sin saltearlos, la unidad "A" de una corriente
        // se leeria como el area de la seccion.
        if (['id', 'label', 'name', 'units', 'body_id', 'parameter'].includes(key)) continue;
        walk(inner);
      }
    }
  };

  walk(node);
  return [...out];
}

export function makeBody(
  kind: string, module: Module, model: ProblemModel, at: number[],
  dimension: '1d' | '2d' | '3d' = '2d',
): Body {
  const id = freshId('b', model.bodies.map((b) => b.id));
  const suffix = id.slice(1);
  const rigid = SHAPE_SPECS[kind]?.(suffix) ?? null;
  const lengthSymbol = rigid ? rigid.span : `L${suffix}`;
  const isCable = kind === 'cable';

  // Una figura rigida no tiene ley constitutiva: no se deforma. Dejarle E e I
  // llenos haria aparecer en la etapa 3 dos valores que no entran en ninguna
  // cuenta.
  const constitutive: Body['constitutive'] =
    rigid ? { E: null, I: null, A: null, alpha: null, h: null,
              k: null, rho: null, epsilon_r: null }
    : module === 'thermo' ? { E: null, I: null, A: 'A', alpha: null, h: null,
                            k: 'k', rho: null, epsilon_r: null }
    : module === 'em' ? { E: null, I: null, A: null, alpha: null, h: null,
                          k: null, rho: null, epsilon_r: null }
    : { E: 'E', I: 'I', A: 'A', alpha: null, h: null,
        k: null, rho: null, epsilon_r: null };

  return {
    id,
    name: `${BODY_LABELS[kind] ?? kind} ${id}`,
    type: kind as Body['type'],
    domain: {
      kind: 'curve1d',
      parameter: 'x',
      start: '0',
      end: lengthSymbol,
      embedding: {
        type: 'straight',
        // Redondeado: el modelo se lee y se edita a mano, y una coordenada con
        // dieciseis decimales no dice nada que dos no digan. En 1D la altura no
        // es un grado de libertad, asi que arranca en cero.
        origin: [
          at[0].toFixed(2),
          dimension === '1d' ? '0' : (at[1] ?? 0).toFixed(2),
          (at[2] ?? 0).toFixed(2),
        ],
        direction: ['1', '0', '0'],
      },
      jacobian: '1',
    },
    fields: [],
    constitutive,
    analysis: {
      mode: module === 'statics' && !isCable && !rigid ? 'deformable' : 'rigid',
      dof: isCable ? 'cable' : '1d_beam',
    },
    cable: isCable ? { mode: 'sag', sag: 'f', at: null, H: null } : null,
    shape: rigid ? rigid.shape : null,
  } as Body;
}

/** Nombre legible de cada tipo de cuerpo, para el inspector y las listas. */
export const BODY_LABELS: Record<string, string> = {
  beam: 'Viga', cable: 'Cable', bar: 'Barra', charged_line: 'Linea cargada',
  wire: 'Conductor', rod: 'Barra rigida', ideal_cable: 'Cable ideal',
  disc: 'Disco / polea', sphere: 'Esfera', block: 'Bloque', spring: 'Resorte',
};

export function bodyOf(model: ProblemModel, id: string): Body | undefined {
  return model.bodies.find((b) => b.id === id);
}
