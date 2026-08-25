import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DeriveResponse, ProblemDoc, ProblemModel } from '@wf/schema';

import { derive } from './api';
import { createDoc, numericBindings, orphanedEdits, reconcile, save } from './doc';

export type Status = 'idle' | 'deriving' | 'error';

/** Espera antes de re-derivar. Absorbe el tipeo sin que se sienta lento. */
const DEBOUNCE_MS = 300;

export function useProblem(initial: ProblemModel) {
  const [doc, setDoc] = useState<ProblemDoc>(() => createDoc(initial));
  const [derived, setDerived] = useState<DeriveResponse | null>(null);
  const [status, setStatus] = useState<Status>('deriving');
  const [error, setError] = useState<string | null>(null);

  const model = doc.stage1;

  // Solo la fisica dispara una re-derivacion. Mover un cuerpo en el canvas
  // cambia `placement`, que queda fuera de esta clave (igual que del hash del
  // backend): arrastrar una barra no debe recalcular una sola ecuacion.
  const physicsKey = useMemo(
    () =>
      JSON.stringify({
        module: model.module,
        supports: model.supports,
        bodies: model.bodies.map(({ placement: _placement, ...rest }) => rest),
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

  useEffect(() => { save(doc); }, [doc]);

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
    replaceDoc,
  };
}
