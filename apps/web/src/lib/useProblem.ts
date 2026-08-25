import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DeriveResponse, ProblemDoc, ProblemModel } from '@wf/schema';

import { derive } from './api';
import type { Dimension, UserStep } from '@wf/schema';

import {
  createDoc, duplicate, listDocs, load, loadLatest, numericBindings, orphanedEdits,
  reconcile, remove, save,
} from './doc';

export type Status = 'idle' | 'deriving' | 'error';

/** Espera antes de re-derivar. Absorbe el tipeo sin que se sienta lento. */
const DEBOUNCE_MS = 300;

const EMPTY: ProblemModel = {
  module: 'statics', title: 'Ejercicio nuevo',
  bodies: [], supports: [], boundaries: [], probes: [],
};

export function useProblem() {
  // Se retoma lo ultimo que quedo guardado; si no hay nada, se empieza limpio.
  const [doc, setDoc] = useState<ProblemDoc>(() => loadLatest() ?? createDoc(EMPTY));
  const [libraryTick, setLibraryTick] = useState(0);
  const [derived, setDerived] = useState<DeriveResponse | null>(null);
  const [status, setStatus] = useState<Status>('deriving');
  const [error, setError] = useState<string | null>(null);

  const model = doc.stage1;

  // Todo lo que describe el problema dispara re-derivacion, la ubicacion de
  // los cuerpos incluida: en Electro mover una linea cargada cambia el campo.
  // Fuera quedan el titulo y las etiquetas, que son texto para el usuario.
  const physicsKey = useMemo(
    () =>
      JSON.stringify({
        module: model.module,
        bodies: model.bodies,
        supports: model.supports,
        boundaries: model.boundaries,
        probes: model.probes,
      }),
    [model],
  );

  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => {
    setStatus('deriving');
    const timer = setTimeout(() => {
      // Cancelar lo anterior: si el usuario siguio editando, ese resultado ya
      // no le sirve a nadie y solo compite por el pool del backend.
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;

      derive(model, controller.signal)
        .then((response) => {
          if (controller.signal.aborted) return;
          setDerived(response);
          setDoc((prev) => reconcile(prev, response));
          setError(null);
          setStatus('idle');
        })
        .catch((err: Error) => {
          if (controller.signal.aborted || err.name === 'AbortError') return;
          setError(err.message);
          setStatus('error');
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // `model` se lee dentro, pero la dependencia real es la fisica.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [physicsKey]);

  // Guardar y avisar que el indice cambio. Sin el aviso la biblioteca se lee
  // durante el render, o sea ANTES de que este efecto escriba, y muestra
  // siempre un guardado de atraso: el ejercicio que acabas de crear no aparece.
  useEffect(() => {
    save(doc);
    setLibraryTick((n) => n + 1);
  }, [doc]);

  const setModel = useCallback((update: (current: ProblemModel) => ProblemModel) => {
    setDoc((prev) => ({ ...prev, stage1: update(prev.stage1) }));
  }, []);

  const setBinding = useCallback((name: string, value: number) => {
    setDoc((prev) => ({
      ...prev,
      stage3: {
        ...prev.stage3,
        bindings: {
          ...prev.stage3.bindings,
          [name]: { units: prev.stage3.bindings[name]?.units ?? '', value },
        },
      },
    }));
  }, []);

  const setEquationEdit = useCallback((id: string, latex: string | null) => {
    setDoc((prev) => {
      const edits = { ...prev.stage2.edits };
      if (latex === null) delete edits[id];
      else edits[id] = latex;
      return { ...prev, stage2: { ...prev.stage2, edits } };
    });
  }, []);

  const setSteps = useCallback((stage: 'stage2' | 'stage3', steps: UserStep[]) => {
    setDoc((prev) => ({ ...prev, [stage]: { ...prev[stage], steps } }));
  }, []);

  const setTitle = useCallback((title: string) => {
    setDoc((prev) => ({ ...prev, title }));
  }, []);

  const setDimension = useCallback((dimension: Dimension) => {
    setDoc((prev) => ({ ...prev, dimension }));
  }, []);

  // La biblioteca se relee del indice, que es la unica fuente de verdad: si se
  // mantuviera una copia en memoria, borrar un ejercicio en otra pestana
  // dejaria la lista mintiendo.
  const library = useMemo(() => listDocs(), [libraryTick]);

  const openDoc = useCallback((id: string) => {
    const next = load(id);
    if (next) setDoc(next);
  }, []);

  const newDoc = useCallback((module: ProblemModel['module']) => {
    setDoc(createDoc(
      { module, title: 'Ejercicio nuevo', bodies: [], supports: [], boundaries: [], probes: [] },
      'Ejercicio nuevo',
    ));
  }, []);

  const duplicateDoc = useCallback(() => {
    setDoc((prev) => duplicate(prev, `${prev.title} (copia)`));
  }, []);

  const deleteDoc = useCallback((id: string) => {
    remove(id);
    setLibraryTick((n) => n + 1);
    setDoc((prev) => (prev.id !== id ? prev : loadLatest() ?? createDoc({
      module: prev.stage1.module, title: 'Ejercicio nuevo',
      bodies: [], supports: [], boundaries: [], probes: [],
    })));
  }, []);

  const replaceDoc = useCallback((next: ProblemDoc) => setDoc(next), []);

  return {
    doc,
    derived,
    status,
    error,
    bindings: numericBindings(doc),
    orphans: derived ? orphanedEdits(doc, derived) : [],
    setModel,
    setBinding,
    setEquationEdit,
    setSteps,
    setTitle,
    setDimension,
    library,
    openDoc,
    newDoc,
    duplicateDoc,
    deleteDoc,
    replaceDoc,
  };
}
