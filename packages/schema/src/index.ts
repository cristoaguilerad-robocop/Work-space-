/**
 * Contrato compartido entre el motor y la UI.
 *
 * Los tipos del MODELO se generan desde `engine/wf_core/model.py` (ver
 * `generated.ts`). Los tipos de la RESPUESTA de la API se declaran aca porque
 * no son parte del modelo: son lo que el motor produce a partir de el.
 */

export * from './generated.js';
import type { ProblemModel } from './generated.js';

/** Una expresion lista para consumir: LaTeX para leer, JS para graficar. */
export interface Packaged {
  latex: string;
  js: CompiledFunction;
}

/**
 * Nodo de una expresion serializada.
 *
 * Un numero es una hoja; `{v}` es un simbolo; `{f, a}` es una aplicacion.
 * Es la misma expresion que `source`, pero recorrible sin compilar codigo.
 */
export type ExprNode =
  | number
  | null
  | { v: string }
  | { f: string; a: ExprNode[] };

/** Funcion compilada a JS, evaluable en el navegador sin tocar la red. */
export interface CompiledFunction {
  variable: string;
  params: string[];
  source: string;
  /**
   * Arbol serializado, cuando el motor lo emite. Existe para las paginas que
   * corren con una CSP que prohibe `new Function`: ahi se evalua recorriendo
   * el arbol. Cuesta mas por muestra, asi que solo se pide donde hace falta.
   */
  ast?: ExprNode;
}

export interface DerivedStep {
  id: string;
  title: string;
  detail: string;
  latex: string;
  kind: 'algebra' | 'integrate' | 'solve' | 'substitute' | 'check';
}

export interface DerivedEquation {
  id: string;
  title: string;
  lhs: string;
  latex: string;
  role: 'equilibrium' | 'definition' | 'field' | 'result' | 'check';
  detail: string;
  sympy: string;
  unknowns: string[];
}

/** Una carga tal como la dibuja el canvas, con su perfil ya compilado. */
export interface DerivedLoad {
  id: string;
  label: string;
  quantity: string;
  kind: 'distributed' | 'point' | 'couple' | 'thermal';
  units?: string;
  start: Packaged;
  end: Packaged;
  /** Densidad canonica, solo para cargas distribuidas. */
  profile?: Packaged;
  /** Magnitud, solo para cargas puntuales y pares. */
  magnitude?: Packaged;
}

export interface DerivedSupport {
  id: string;
  type: 'pin' | 'roller' | 'fixed';
  at: Packaged;
  /** Cota del apoyo. Solo los cables la usan. */
  elevation?: Packaged;
}

/** Ubicacion del cuerpo en el mundo, evaluable con los valores de la etapa 3. */
export interface DerivedGeometry {
  origin: [Packaged, Packaged, Packaged];
  axis: [Packaged, Packaged, Packaged];
  transverse: [Packaged, Packaged, Packaged];
}

/**
 * Una reaccion como vector dibujable.
 *
 * Viaja aparte de `reactions` porque el canvas necesita saber donde actua y en
 * que sentido, no solo cuanto vale.
 */
export interface DerivedReaction {
  id: string;
  support_id: string;
  component: 'transverse' | 'axial' | 'moment';
  at: Packaged;
  value: Packaged;
}

export interface DerivedBoundary {
  id: string;
  type: 'temperature' | 'flux' | 'convection' | 'insulated';
  at: Packaged;
  label: string;
}

export interface DerivedProbe {
  id: string;
  label: string;
  at: [Packaged, Packaged, Packaged];
}

/**
 * Planteamiento de un campo en Electro.
 *
 * `parts` son los integrandos por tramo -- cada uno con sus limites propios,
 * para que la cuadratura del cliente no atraviese un salto de densidad --,
 * `discrete` el aporte exacto de las cargas puntuales y `closed_form` la
 * primitiva cuando existe.
 */
export interface FieldSetup {
  parts: { integrand: Packaged; start: Packaged; end: Packaged }[];
  discrete: Packaged;
  closed_form: Packaged | null;
}

export interface DerivedBody {
  body_id: string;
  name: string;
  mode: 'rigid' | 'deformable';
  parameter: string;
  domain_end: string;
  /** Longitud del dominio, evaluable con los valores de la etapa 3. */
  length: Packaged;
  geometry?: DerivedGeometry;
  reaction_arrows?: DerivedReaction[];
  loads: DerivedLoad[];
  supports: DerivedSupport[];
  /** Termo. */
  boundaries?: DerivedBoundary[];
  /** Electro. */
  probes?: DerivedProbe[];
  field_setups?: Record<string, FieldSetup>;
  /** Cables: la curva y(x). En un cable la forma es el resultado, no el dibujo. */
  shape?: Packaged;
  /** Electro: nombres de las coordenadas del punto de observacion. */
  observer?: string[];
  module?: 'statics' | 'thermo' | 'em';
  kind?: string;
  reactions: Record<string, Packaged>;
  functions: Record<string, Packaged>;
  scalars: Record<string, Packaged>;
  residuals: Record<string, string>;
  equations: DerivedEquation[];
  steps: DerivedStep[];
  notes: string[];
}

export interface SymbolSuggestion {
  name: string;
  /** El nombre escrito en LaTeX (`alpha` -> `\alpha`, `T_ref` -> `T_{ref}`). */
  latex: string;
  value: number;
  units: string;
  description: string;
}

export interface DeriveResponse {
  model_hash: string;
  module: string;
  title: string;
  symbols: SymbolSuggestion[];
  bodies: DerivedBody[];
  errors: { body_id: string; message: string }[];
}

/** Valor numerico asignado en la etapa 3. */
export interface Binding {
  value: number;
  units: string;
}

/**
 * Un paso escrito por el usuario.
 *
 * Esta es la pieza central del cuaderno: lo que importa guardar no es lo que
 * el motor deduce, sino lo que la persona decidio hacer y en que orden. El
 * cuerpo es texto con matematica entre `$...$`, para poder mezclar
 * "planteo equilibrio en A" con la ecuacion misma.
 */
export interface UserStep {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

/** En que dimension se arma el ejercicio. Es una preferencia del constructor,
 *  no del modelo fisico: el mismo sistema se puede mirar de las tres formas. */
export type Dimension = '1d' | '2d' | '3d';

/**
 * Documento completo con las tres etapas.
 *
 * Las etapas 2 y 3 NO son copias de lo derivado: son *overlays*. La etapa 2
 * guarda solo los parches del usuario sobre las ecuaciones derivadas, y la
 * etapa 3 guarda los valores por nombre de simbolo. Por eso volver a la etapa 1
 * y cambiar el modelo no destruye el trabajo posterior: se re-deriva y se
 * re-aplican los overlays por id.
 */
export interface ProblemDoc {
  version: 2;
  id: string;
  /** Nombre del ejercicio, para encontrarlo en la biblioteca. */
  title: string;
  createdAt: string;
  updatedAt: string;
  /** Con que dimension se esta armando. */
  dimension: Dimension;
  stage1: ProblemModel;
  stage2: {
    /** El procedimiento escrito a mano. Lo que el usuario quiere guardar. */
    steps: UserStep[];
    /** Parches por id de ecuacion derivada. La derivacion sigue siendo la base. */
    edits: Record<string, string>;
    /** Ecuaciones que el usuario agrego a mano. */
    added: { id: string; latex: string }[];
  };
  stage3: {
    /** El procedimiento numerico, escrito a mano. */
    steps: UserStep[];
    bindings: Record<string, Binding>;
    /** Valores cuyo simbolo ya no existe en el modelo. No se borran: se aislan. */
    quarantined: Record<string, Binding>;
  };
}

/** Una entrada de la biblioteca de ejercicios. */
export interface DocSummary {
  id: string;
  title: string;
  module: string;
  updatedAt: string;
  /** Cuantos pasos escritos tiene, sumando las dos etapas. */
  steps: number;
}
