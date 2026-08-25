import type { DeriveResponse, ProblemModel } from '@wf/schema';

export interface Example {
  id: string;
  title: string;
  description: string;
  model: ProblemModel;
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
  return request<DeriveResponse>('/api/derive', {
    method: 'POST',
    body: JSON.stringify({ model }),
    signal,
  });
}

export function fetchExamples(): Promise<{ examples: Example[] }> {
  return request('/api/examples');
}
