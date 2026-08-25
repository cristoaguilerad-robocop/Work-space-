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

/** Funcion compilada a JS, evaluable en el navegador sin tocar la red. */
export interface CompiledFunction {
  variable: string;
  params: string[];
  source: string;
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

export interface DerivedBody {
  body_id: string;
  name: string;
  mode: 'rigid' | 'deformable';
  parameter: string;
  domain_end: string;
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
 * Documento completo con las tres etapas.
 *
 * Las etapas 2 y 3 NO son copias de lo derivado: son *overlays*. La etapa 2
 * guarda solo los parches del usuario sobre las ecuaciones derivadas, y la
 * etapa 3 guarda los valores por nombre de simbolo. Por eso volver a la etapa 1
 * y cambiar el modelo no destruye el trabajo posterior: se re-deriva y se
 * re-aplican los overlays por id.
 */
export interface ProblemDoc {
  version: 1;
  id: string;
  updatedAt: string;
  stage1: ProblemModel;
  stage2: {
    /** Parches por id de ecuacion. La derivacion sigue siendo la base. */
    edits: Record<string, string>;
    /** Ecuaciones que el usuario agrego a mano. */
    added: { id: string; latex: string }[];
  };
  stage3: {
    bindings: Record<string, Binding>;
    /** Valores cuyo simbolo ya no existe en el modelo. No se borran: se aislan. */
    quarantined: Record<string, Binding>;
  };
}
