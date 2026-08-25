/**
 * Evaluador de las expresiones simbolicas del modelo, en el cliente.
 *
 * El canvas tiene que poder dibujar un cuerpo **antes** de que el motor sepa
 * resolverlo: una viga recien puesta, todavia sin apoyos, no tiene solucion y
 * sin embargo hay que verla para poder ponerle los apoyos. Si el dibujo
 * dependiera de la derivacion, armar un sistema seria imposible.
 *
 * Por eso este evaluador chico: las expresiones del modelo son posiciones y
 * longitudes (`0`, `1.5`, `L1`, `3*L1/4`), no el algebra pesada que resuelve
 * SymPy. Lo que necesita saber es aritmetica y como buscar un simbolo en los
 * valores de la etapa 3.
 */

const FUNCTIONS: Record<string, (x: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  exp: Math.exp, log: Math.log, sqrt: Math.sqrt, abs: Math.abs,
};

const CONSTANTS: Record<string, number> = { pi: Math.PI };

interface Cursor { text: string; at: number }

function skip(c: Cursor) {
  while (c.at < c.text.length && /\s/.test(c.text[c.at])) c.at += 1;
}

function parseExpression(c: Cursor, scope: Record<string, number>): number {
  let value = parseTerm(c, scope);
  for (;;) {
    skip(c);
    const op = c.text[c.at];
    if (op !== '+' && op !== '-') return value;
    c.at += 1;
    const right = parseTerm(c, scope);
    value = op === '+' ? value + right : value - right;
  }
}

function parseTerm(c: Cursor, scope: Record<string, number>): number {
  let value = parsePower(c, scope);
  for (;;) {
    skip(c);
    const op = c.text[c.at];
    if (op !== '*' && op !== '/') return value;
    // `**` es potencia, no dos multiplicaciones.
    if (op === '*' && c.text[c.at + 1] === '*') return value;
    c.at += 1;
    const right = parsePower(c, scope);
    value = op === '*' ? value * right : value / right;
  }
}

function parsePower(c: Cursor, scope: Record<string, number>): number {
  const base = parseUnary(c, scope);
  skip(c);
  const isPower = c.text[c.at] === '^'
    || (c.text[c.at] === '*' && c.text[c.at + 1] === '*');
  if (!isPower) return base;
  c.at += c.text[c.at] === '^' ? 1 : 2;
  return Math.pow(base, parsePower(c, scope));
}

function parseUnary(c: Cursor, scope: Record<string, number>): number {
  skip(c);
  if (c.text[c.at] === '-') { c.at += 1; return -parseUnary(c, scope); }
  if (c.text[c.at] === '+') { c.at += 1; return parseUnary(c, scope); }
  return parsePrimary(c, scope);
}

function parsePrimary(c: Cursor, scope: Record<string, number>): number {
  skip(c);
  if (c.text[c.at] === '(') {
    c.at += 1;
    const value = parseExpression(c, scope);
    skip(c);
    if (c.text[c.at] === ')') c.at += 1;
    return value;
  }

  const number = /^\d+(\.\d+)?([eE][-+]?\d+)?/.exec(c.text.slice(c.at));
  if (number) { c.at += number[0].length; return Number(number[0]); }

  const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(c.text.slice(c.at));
  if (!name) throw new Error(`no se entiende: ${c.text.slice(c.at)}`);
  c.at += name[0].length;
  skip(c);

  if (c.text[c.at] === '(') {
    const fn = FUNCTIONS[name[0]];
    c.at += 1;
    const argument = parseExpression(c, scope);
    skip(c);
    if (c.text[c.at] === ')') c.at += 1;
    if (!fn) throw new Error(`funcion desconocida: ${name[0]}`);
    return fn(argument);
  }

  if (name[0] in CONSTANTS) return CONSTANTS[name[0]];
  const bound = scope[name[0]];
  if (bound === undefined) throw new Error(`simbolo sin valor: ${name[0]}`);
  return bound;
}

/**
 * Evalua una expresion del modelo.
 *
 * Devuelve `fallback` si no se puede: un simbolo sin valor todavia no es un
 * error, es un modelo a medio armar, y el canvas tiene que seguir dibujando.
 */
export function evalExpr(
  text: string | number | null | undefined,
  scope: Record<string, number>,
  fallback = 0,
): number {
  if (text === null || text === undefined || text === '') return fallback;
  if (typeof text === 'number') return Number.isFinite(text) ? text : fallback;
  try {
    const cursor: Cursor = { text: String(text), at: 0 };
    const value = parseExpression(cursor, scope);
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}
