/* GENERADO. Fuente de verdad: engine/wf_core/model.py. No editar a mano. */

export type Module = "statics" | "em" | "thermo";
export type Title = string;
export type Id = string;
export type Name = string;
export type Type = "beam" | "bar" | "cable" | "disc";
/**
 * @minItems 3
 * @maxItems 3
 */
export type Origin = [unknown, unknown, unknown];
export type RotationDeg = number;
export type Kind = "curve1d";
export type Parameter = string;
export type Start = string;
export type End = string;
export type Embedding = StraightEmbedding | ArcEmbedding;
export type Type1 = "straight";
/**
 * @minItems 3
 * @maxItems 3
 */
export type Origin1 = [unknown, unknown, unknown];
/**
 * @minItems 3
 * @maxItems 3
 */
export type Direction = [unknown, unknown, unknown];
export type Type2 = "arc";
/**
 * @minItems 3
 * @maxItems 3
 */
export type Center = [unknown, unknown, unknown];
export type Radius = string;
export type StartAngle = string;
export type Jacobian = string;
export type Kind1 = "load";
export type Id1 = string;
export type Label = string;
export type Quantity = "force" | "moment";
export type Region = PointRegion | IntervalRegion | FullRegion;
export type Type3 = "point";
export type At = string;
export type Type4 = "interval";
export type Start1 = string;
export type End1 = string;
export type Type5 = "full";
export type Distribution =
  | PointDistribution
  | UniformDistribution
  | LinearDistribution
  | PolynomialDistribution
  | ExpressionDistribution
  | PiecewiseDistribution;
export type Type6 = "point";
export type Magnitude = string;
export type Type7 = "uniform";
export type W = string;
export type Type8 = "linear";
export type WStart = string;
export type WEnd = string;
export type Type9 = "polynomial";
export type Coeffs = string[];
export type Type10 = "expression";
export type Expr = string;
export type Type11 = "piecewise";
export type Start2 = string;
export type End2 = string;
export type Distribution1 =
  | PointDistribution
  | UniformDistribution
  | LinearDistribution
  | PolynomialDistribution
  | ExpressionDistribution
  | PiecewiseDistribution;
export type Pieces = PiecewisePiece[];
export type Frame = "global" | "local";
/**
 * @minItems 3
 * @maxItems 3
 */
export type Vector = [unknown, unknown, unknown];
export type Units = string;
export type Kind2 = "thermal";
export type Id2 = string;
export type Label1 = string;
export type TRef = string;
export type Profile = ThermalProfileUniform | ThermalProfileLinear;
export type Type12 = "uniform_through_section";
export type T = string;
export type Type13 = "linear_through_section";
export type TTop = string;
export type TBottom = string;
export type Fields = (MechanicalLoad | ThermalField)[];
export type E = string | null;
export type I = string | null;
export type A = string | null;
export type Alpha = string | null;
export type H = string | null;
export type K = string | null;
export type Rho = string | null;
export type Mode = "rigid" | "deformable";
export type Dof = "1d_beam";
export type Bodies = Body[];
export type Id3 = string;
export type BodyId = string;
export type At1 = string;
export type Type14 = "pin" | "roller" | "fixed";
export type Label2 = string;
export type Supports = StructuralSupport[];

/**
 * Etapa 1: el modelo fisico.
 */
export interface ProblemModel {
  module?: Module;
  title?: Title;
  bodies?: Bodies;
  supports?: Supports;
}
export interface Body {
  id: Id;
  name?: Name;
  type?: Type;
  placement?: Placement;
  domain?: Domain1D;
  fields?: Fields;
  constitutive?: Constitutive;
  analysis?: Analysis;
}
/**
 * Pose en el mundo. Cambiarla NO invalida la derivacion simbolica.
 */
export interface Placement {
  origin?: Origin;
  rotation_deg?: RotationDeg;
}
/**
 * Dominio parametrico de un cuerpo idealizado como curva.
 */
export interface Domain1D {
  kind?: Kind;
  parameter?: Parameter;
  start?: Start;
  end?: End;
  embedding?: Embedding;
  jacobian?: Jacobian;
}
/**
 * Recta: ``r(x) = origin + x * direction``.
 */
export interface StraightEmbedding {
  type?: Type1;
  origin?: Origin1;
  direction?: Direction;
}
/**
 * Arco de radio constante en el plano XY. Reservado para Electro/Termo.
 */
export interface ArcEmbedding {
  type?: Type2;
  center?: Center;
  radius?: Radius;
  start_angle?: StartAngle;
}
/**
 * Carga mecanica: fuerza distribuida/puntual o par concentrado.
 */
export interface MechanicalLoad {
  kind?: Kind1;
  id: Id1;
  label?: Label;
  quantity?: Quantity;
  region: Region;
  distribution: Distribution;
  direction?: Direction1;
  units?: Units;
}
export interface PointRegion {
  type?: Type3;
  at: At;
}
export interface IntervalRegion {
  type?: Type4;
  start: Start1;
  end: End1;
}
/**
 * Todo el dominio del cuerpo.
 */
export interface FullRegion {
  type?: Type5;
}
/**
 * Concentrada. Internamente es una delta, no un caso especial.
 */
export interface PointDistribution {
  type?: Type6;
  magnitude: Magnitude;
}
export interface UniformDistribution {
  type?: Type7;
  w: W;
}
/**
 * Cubre triangular y trapezoidal: es el mismo objeto matematico.
 */
export interface LinearDistribution {
  type?: Type8;
  w_start: WStart;
  w_end: WEnd;
}
/**
 * ``sum(coeffs[i] * (s - inicio_region)**i)``.
 */
export interface PolynomialDistribution {
  type?: Type9;
  coeffs: Coeffs;
}
/**
 * Funcion arbitraria del parametro del dominio.
 */
export interface ExpressionDistribution {
  type?: Type10;
  expr: Expr;
}
export interface PiecewiseDistribution {
  type?: Type11;
  pieces: Pieces;
}
export interface PiecewisePiece {
  start: Start2;
  end: End2;
  distribution: Distribution1;
}
export interface Direction1 {
  frame?: Frame;
  vector?: Vector;
}
export interface ThermalField {
  kind?: Kind2;
  id: Id2;
  label?: Label1;
  T_ref?: TRef;
  profile: Profile;
}
/**
 * Temperatura constante en la seccion, variable a lo largo del dominio.
 */
export interface ThermalProfileUniform {
  type?: Type12;
  T: T;
}
/**
 * Gradiente lineal en la seccion. Es lo que permite flexion termica.
 *
 * Guardar solo ``T(x)`` media hace imposible modelar curvatura termica, y
 * agregarlo despues obliga a tocar el schema y todos los documentos guardados.
 */
export interface ThermalProfileLinear {
  type?: Type13;
  T_top: TTop;
  T_bottom: TBottom;
}
/**
 * Material y seccion. Todo opcional: el modo rigido no necesita nada.
 */
export interface Constitutive {
  E?: E;
  I?: I;
  A?: A;
  alpha?: Alpha;
  h?: H;
  k?: K;
  rho?: Rho;
}
export interface Analysis {
  mode?: Mode;
  dof?: Dof;
}
/**
 * Anclado a ``(body_id, at)`` en coordenada del dominio, nunca a pixeles.
 *
 * Si se anclara a la posicion en pantalla, mover el cuerpo en el canvas
 * romperia el modelo fisico.
 */
export interface StructuralSupport {
  id: Id3;
  body_id: BodyId;
  at: At1;
  type?: Type14;
  label?: Label2;
}
