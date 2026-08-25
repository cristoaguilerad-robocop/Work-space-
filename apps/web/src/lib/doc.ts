import type { Binding, DeriveResponse, ProblemDoc, ProblemModel } from '@wf/schema';

const STORAGE_PREFIX = 'wf:doc:';
const INDEX_KEY = 'wf:index';

export function createDoc(model: ProblemModel, id = crypto.randomUUID()): ProblemDoc {
  return {
    version: 1,
    id,
    updatedAt: new Date().toISOString(),
    stage1: model,
    stage2: { edits: {}, added: [] },
    stage3: { bindings: {}, quarantined: {} },
  };
}

/**
 * Re-aplica los overlays de las etapas 2 y 3 sobre una derivacion nueva.
 *
 * Este es el mecanismo que permite volver a la etapa 1, cambiar el modelo y no
 * perder el trabajo posterior. Las etapas 2 y 3 no guardan copias de lo
 * derivado: guardan parches indexados por id estable. Al re-derivar:
 *
 * - los simbolos nuevos entran con el valor sugerido por el motor,
 * - los que siguen estando conservan el valor que el usuario ya habia puesto,
 * - los que desaparecieron NO se borran: pasan a cuarentena, y si el usuario
 *   deshace el cambio en el modelo vuelven con su valor intacto.
 */
export function reconcile(doc: ProblemDoc, derived: DeriveResponse): ProblemDoc {
  const bindings: Record<string, Binding> = {};
  const quarantined: Record<string, Binding> = { ...doc.stage3.quarantined };
  const live = new Set(derived.symbols.map((s) => s.name));

  for (const suggestion of derived.symbols) {
    const existing = doc.stage3.bindings[suggestion.name] ?? quarantined[suggestion.name];
    delete quarantined[suggestion.name];
    bindings[suggestion.name] = existing ?? {
      value: suggestion.value,
      units: suggestion.units,
    };
  }

  for (const [name, binding] of Object.entries(doc.stage3.bindings)) {
    if (!live.has(name)) quarantined[name] = binding;
  }

  return { ...doc, stage3: { bindings, quarantined } };
}

/** Ids de ecuacion que ya no existen: sus ediciones quedan huerfanas. */
export function orphanedEdits(doc: ProblemDoc, derived: DeriveResponse): string[] {
  const live = new Set(derived.bodies.flatMap((b) => b.equations.map((e) => e.id)));
  return Object.keys(doc.stage2.edits).filter((id) => !live.has(id));
}

export function numericBindings(doc: ProblemDoc): Record<string, number> {
  return Object.fromEntries(
    Object.entries(doc.stage3.bindings).map(([k, v]) => [k, v.value]),
  );
}

// ---------------------------------------------------------------- persistencia

/**
 * Autoguardado optimista en el navegador.
 *
 * Escribir local es instantaneo y no puede fallar por red; el sync al servidor
 * es la capa de arriba. En el sprint 1 solo existe la capa local.
 */
export function save(doc: ProblemDoc): void {
  const stamped = { ...doc, updatedAt: new Date().toISOString() };
  try {
    localStorage.setItem(STORAGE_PREFIX + doc.id, JSON.stringify(stamped));
    const index = listDocs().filter((entry) => entry.id !== doc.id);
    index.unshift({ id: doc.id, title: doc.stage1.title ?? 'Sin titulo', updatedAt: stamped.updatedAt });
    localStorage.setItem(INDEX_KEY, JSON.stringify(index.slice(0, 50)));
  } catch {
    // Modo privado o cuota llena: el trabajo en memoria sigue intacto.
  }
}

export function load(id: string): ProblemDoc | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + id);
    return raw ? (JSON.parse(raw) as ProblemDoc) : null;
  } catch {
    return null;
  }
}

/**
 * Recupera el ultimo documento guardado.
 *
 * Sin esto el autoguardado no sirve de nada: cada recarga estrenaba un
 * documento vacio y el trabajo anterior quedaba en localStorage sin forma de
 * volver a el. Un documento de una version vieja del esquema se descarta en
 * silencio, que es mejor que arrancar roto.
 */
export function loadLatest(): ProblemDoc | null {
  const [recent] = listDocs();
  if (!recent) return null;
  const doc = load(recent.id);
  if (!doc || !doc.stage1 || !Array.isArray(doc.stage1.bodies)) return null;
  if (!doc.stage2?.edits || !doc.stage3?.bindings) return null;
  return doc;
}

export function listDocs(): { id: string; title: string; updatedAt: string }[] {
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]');
  } catch {
    return [];
  }
}
