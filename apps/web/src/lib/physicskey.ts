import type { ProblemModel } from '@wf/schema';

/**
 * Serializa con las claves ordenadas.
 *
 * `JSON.stringify` respeta el orden en que se escribieron las claves, asi que
 * dos modelos identicos armados por caminos distintos dan cadenas distintas.
 * Aca el orden lo fija el alfabeto, y la cadena depende solo del contenido:
 * es lo que permite que el mismo modelo se busque igual desde el navegador y
 * desde el script que precalcula los ejemplos.
 */
export function stableKey(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableKey(v)}`).join(',')}}`;
}

/**
 * La identidad fisica del problema.
 *
 * Solo entra lo que cambia el resultado. El titulo y las etiquetas quedan
 * afuera: renombrar un ejercicio no obliga a rederivarlo. La ubicacion de los
 * cuerpos SI entra -- en Electro mover una linea cargada cambia el campo.
 */
export function physicsKey(model: ProblemModel): string {
  return stableKey({
    module: model.module,
    bodies: model.bodies,
    supports: model.supports,
    boundaries: model.boundaries,
    probes: model.probes,
  });
}
