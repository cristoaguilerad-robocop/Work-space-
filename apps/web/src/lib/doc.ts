import type {
  Binding, DeriveResponse, DocSummary, Dimension, ProblemDoc, ProblemModel, UserStep,
} from '@wf/schema';

const STORAGE_PREFIX = 'wf:doc:';
const INDEX_KEY = 'wf:index';

export function createDoc(
  model: ProblemModel, title = 'Ejercicio nuevo', id = crypto.randomUUID(),
): ProblemDoc {
  const now = new Date().toISOString();
  return {
    version: 2,
    id,
    title,
    createdAt: now,
    updatedAt: now,
    dimension: '2d',
    stage1: model,
    stage2: { steps: [], edits: {}, added: [] },
    stage3: { steps: [], bindings: {}, quarantined: {} },
  };
}

/** Un paso vacio, listo para escribir. */
export function newStep(title = ''): UserStep {
  return {
    id: crypto.randomUUID().slice(0, 8),
    title,
    body: '',
    createdAt: new Date().toISOString(),
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

  return { ...doc, stage3: { ...doc.stage3, bindings, quarantined } };
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
    index.unshift(summarize(stamped));
    localStorage.setItem(INDEX_KEY, JSON.stringify(index.slice(0, 200)));
  } catch {
    // Modo privado o cuota llena: el trabajo en memoria sigue intacto.
  }
}

function summarize(doc: ProblemDoc): DocSummary {
  return {
    id: doc.id,
    title: doc.title || 'Sin titulo',
    module: doc.stage1.module ?? 'statics',
    updatedAt: doc.updatedAt,
    steps: doc.stage2.steps.length + doc.stage3.steps.length,
  };
}

/** Borra un ejercicio del disco y del indice. */
export function remove(id: string): void {
  try {
    localStorage.removeItem(STORAGE_PREFIX + id);
    localStorage.setItem(
      INDEX_KEY, JSON.stringify(listDocs().filter((entry) => entry.id !== id)),
    );
  } catch {
    // Nada que hacer: el indice se reconstruye al guardar el siguiente.
  }
}

/** Copia un ejercicio con id nuevo, para partir de uno que ya salio bien. */
export function duplicate(doc: ProblemDoc, title: string): ProblemDoc {
  const now = new Date().toISOString();
  return {
    ...structuredClone(doc),
    id: crypto.randomUUID(),
    title,
    createdAt: now,
    updatedAt: now,
  };
}

export function setDimension(doc: ProblemDoc, dimension: Dimension): ProblemDoc {
  return { ...doc, dimension };
}

export function load(id: string): ProblemDoc | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + id);
    return migrate(raw ? (JSON.parse(raw) as ProblemDoc) : null);
  } catch {
    return null;
  }
}

/**
 * Completa un documento guardado con una version anterior del esquema.
 *
 * Se migra en vez de descartar: lo que hay guardado es trabajo de la persona,
 * y perderlo porque el programa cambio de forma no es aceptable. Solo se
 * descarta lo que no tiene arreglo posible.
 */
function migrate(doc: ProblemDoc | null): ProblemDoc | null {
  if (!doc || !doc.stage1 || !Array.isArray(doc.stage1.bodies)) return null;
  return {
    ...doc,
    version: 2,
    title: doc.title || doc.stage1.title || 'Ejercicio sin titulo',
    createdAt: doc.createdAt || doc.updatedAt || new Date().toISOString(),
    dimension: doc.dimension ?? '2d',
    stage2: {
      steps: doc.stage2?.steps ?? [],
      edits: doc.stage2?.edits ?? {},
      added: doc.stage2?.added ?? [],
    },
    stage3: {
      steps: doc.stage3?.steps ?? [],
      bindings: doc.stage3?.bindings ?? {},
      quarantined: doc.stage3?.quarantined ?? {},
    },
  };
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
  return migrate(doc);
}

export function listDocs(): DocSummary[] {
  try {
    const raw = JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter((entry) => entry && typeof entry.id === 'string');
  } catch {
    return [];
  }
}
