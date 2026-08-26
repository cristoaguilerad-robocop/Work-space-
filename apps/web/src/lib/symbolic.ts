/**
 * Puente entre arrastrar con el mouse y el modelo simbolico.
 *
 * Este es el problema central del canvas editable: el usuario suelta una carga
 * en un pixel, pero el modelo guarda `3*L/4`, no `2.87`. Si al arrastrar
 * escribieramos el numero, la etapa 2 perderia el planteamiento parametrico y
 * la solucion dejaria de ser una formula para pasar a ser una cuenta.
 *
 * La respuesta es enganchar a fracciones "lindas" del dominio. Con la tecla
 * Alt se desactiva el enganche y ahi si se escribe un multiplo decimal, que
 * sigue siendo simbolico en el dominio.
 */

/** Fracciones a las que engancha el arrastre, en orden. */
const FRACTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 8], [1, 6], [1, 5], [1, 4], [1, 3], [3, 8], [2, 5],
  [1, 2], [3, 5], [5, 8], [2, 3], [3, 4], [4, 5], [5, 6], [7, 8], [1, 1],
];

/** Tolerancia de enganche, como fraccion del largo del cuerpo. */
const SNAP_TOLERANCE = 0.028;

const SIMPLE_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Envuelve el simbolo del dominio si no es un identificador simple. */
function atom(end: string): string {
  return SIMPLE_NAME.test(end.trim()) ? end.trim() : `(${end.trim()})`;
}

/** Escribe `p/q` del dominio como expresion: `0`, `L`, `L/4`, `3*L/4`. */
export function fractionOf(end: string, numerator: number, denominator: number): string {
  if (numerator === 0) return '0';
  const symbol = atom(end);
  if (denominator === 1) return numerator === 1 ? symbol : `${numerator}*${symbol}`;
  if (numerator === 1) return `${symbol}/${denominator}`;
  return `${numerator}*${symbol}/${denominator}`;
}

/**
 * Convierte una posicion normalizada `t` en [0,1] a una expresion del dominio.
 *
 * @param snap `false` (Alt) escribe un multiplo decimal en vez de enganchar.
 */
export function positionExpression(t: number, end: string, snap = true): string {
  const clamped = Math.min(1, Math.max(0, t));

  if (snap) {
    for (const [numerator, denominator] of FRACTIONS) {
      if (Math.abs(clamped - numerator / denominator) <= SNAP_TOLERANCE) {
        return fractionOf(end, numerator, denominator);
      }
    }
  }

  const rounded = Number(clamped.toFixed(3));
  if (rounded === 0) return '0';
  if (rounded === 1) return atom(end);
  return `${rounded}*${atom(end)}`;
}

/** Etiqueta corta para mostrar mientras se arrastra. */
export function positionLabel(expression: string): string {
  return expression.replace(/\*/g, '');
}

/**
 * Coordenada libre en el plano, para las sondas de Electro.
 *
 * Aca no hay dominio al que engancharse, asi que se redondea a dos decimales
 * y se escribe como numero: la posicion de una sonda no es parte del
 * planteamiento, es una pregunta que el usuario le hace al campo.
 */
export function coordinateExpression(value: number): string {
  return String(Number(value.toFixed(2)));
}
