import type { DeriveResponse, ProblemModel } from '@wf/schema';

import { physicsKey } from './physicskey';

export interface Example {
  id: string;
  title: string;
  description: string;
  model: ProblemModel;
}

/**
 * Lo que la pagina lleva adentro cuando se publica como archivo unico.
 *
 * Ahi no hay backend: viajan los ejemplos y sus derivaciones ya calculadas,
 * indexadas por la identidad fisica del modelo. Armar, mover, borrar y ver en
 * 3D no dependen de esto -- el canvas dibuja el modelo, no la derivacion --,
 * asi que la pagina sirve igual para trabajar aunque no haya un solo resultado
 * que mostrar.
 */
interface Offline {
  examples: Example[];
  derived: Record<string, DeriveResponse>;
}

let offline: Offline | null | undefined;

function bundle(): Offline | null {
  if (offline === undefined) {
    const node = document.getElementById('wf-offline');
    try {
      offline = node ? (JSON.parse(node.textContent ?? '') as Offline) : null;
    } catch {
      offline = null;
    }
  }
  return offline;
}

/** Se lanza cuando no hay motor y el modelo no viene precalculado. */
export class NoEngine extends Error {
  constructor() {
    super('sin motor de calculo');
    this.name = 'NoEngine';
  }
}

export function offlineMode(): boolean {
  return bundle() !== null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(body.detail ?? `Error ${response.status}`);
  }
  return response.json() as Promise<T>;
}

/** Etapa 1 -> etapa 2. Devuelve ecuaciones, pasos y funciones compiladas. */
export function derive(model: ProblemModel, signal?: AbortSignal): Promise<DeriveResponse> {
  const local = bundle();
  if (local) {
    const hit = local.derived[physicsKey(model)];
    return hit ? Promise.resolve(hit) : Promise.reject(new NoEngine());
  }
  return request<DeriveResponse>('/api/derive', {
    method: 'POST',
    body: JSON.stringify({ model }),
    signal,
  });
}

export function fetchExamples(): Promise<{ examples: Example[] }> {
  const local = bundle();
  if (local) return Promise.resolve({ examples: local.examples });
  return request('/api/examples');
}
