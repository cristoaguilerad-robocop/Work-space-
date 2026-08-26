import { useCallback, useRef, useState } from 'react';
import type { UserStep } from '@wf/schema';

import { insertKey, type MathKey } from '../lib/mathkeys';
import { MathKeyboard } from './MathKeyboard';
import { MathText } from './MathText';

interface Props {
  title: string;
  hint: string;
  steps: UserStep[];
  onChange: (steps: UserStep[]) => void;
  /** Textos que se pueden traer de lo que el motor derivo. */
  suggestions?: { label: string; latex: string }[];
}

/**
 * Bitacora del ejercicio: los pasos que la persona escribe.
 *
 * Es el contenido que el programa existe para guardar. Lo que el motor deduce
 * es material de consulta -- se puede traer con un boton -- pero el registro
 * de lo que uno hizo, y en que orden, lo escribe uno.
 */
export function Notebook({ title, hint, steps, onChange, suggestions = [] }: Props) {
  const [focused, setFocused] = useState<string | null>(null);
  const areas = useRef(new Map<string, HTMLTextAreaElement>());

  const patch = useCallback((id: string, next: Partial<UserStep>) => {
    onChange(steps.map((step) => (step.id === id ? { ...step, ...next } : step)));
  }, [steps, onChange]);

  const add = (body = '', stepTitle = '') => {
    const step: UserStep = {
      id: crypto.randomUUID().slice(0, 8),
      title: stepTitle,
      body,
      createdAt: new Date().toISOString(),
    };
    onChange([...steps, step]);
    setFocused(step.id);
  };

  const move = (index: number, delta: number) => {
    const next = [...steps];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const insert = (key: MathKey) => {
    const id = focused ?? steps[steps.length - 1]?.id;
    if (!id) return;
    const area = areas.current.get(id);
    const step = steps.find((s) => s.id === id);
    if (!area || !step) return;
    const { text, caret } = insertKey(step.body, area.selectionStart, area.selectionEnd, key);
    patch(id, { body: text });
    // El valor se aplica en el siguiente render, asi que el cursor tambien.
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(caret, caret);
    });
  };

  return (
    <section className="plate notebook">
      <div className="panel-head">
        <h2>{title}</h2>
        <button type="button" onClick={() => add()}>+ Paso</button>
      </div>
      <p className="hint">{hint}</p>

      {steps.length === 0 && (
        <p className="hint">
          Todavia no escribiste ningun paso. <button type="button" onClick={() => add()}>
            Escribir el primero
          </button>
        </p>
      )}

      <ol className="usersteps">
        {steps.map((step, index) => (
          <li key={step.id}>
            <div className="step-bar">
              <span className="step-n">{index + 1}</span>
              <input
                className="step-title"
                value={step.title}
                placeholder="Que hago en este paso"
                onChange={(e) => patch(step.id, { title: e.target.value })}
              />
              <button type="button" onClick={() => move(index, -1)}
                      disabled={index === 0} aria-label="Subir">↑</button>
              <button type="button" onClick={() => move(index, 1)}
                      disabled={index === steps.length - 1} aria-label="Bajar">↓</button>
              <button type="button" aria-label="Quitar paso"
                      onClick={() => onChange(steps.filter((s) => s.id !== step.id))}>
                ✕
              </button>
            </div>

            <textarea
              ref={(node) => {
                if (node) areas.current.set(step.id, node);
                else areas.current.delete(step.id);
              }}
              value={step.body}
              placeholder="Escribi aca. La matematica va entre signos peso: $\sum F_y = 0$"
              onFocus={() => setFocused(step.id)}
              onChange={(e) => patch(step.id, { body: e.target.value })}
              rows={3}
            />

            {step.body.trim() !== '' && (
              <div className="step-preview"><MathText text={step.body} /></div>
            )}
          </li>
        ))}
      </ol>

      {steps.length > 0 && (
        <MathKeyboard onInsert={insert} />
      )}

      {suggestions.length > 0 && (
        <details className="suggestions">
          <summary>Traer algo de lo que dedujo el motor ({suggestions.length})</summary>
          <p className="hint">
            Se agrega como paso nuevo, para que puedas editarlo y decir con tus palabras
            por que lo usaste.
          </p>
          <ul>
            {suggestions.map((suggestion) => (
              <li key={suggestion.label + suggestion.latex}>
                <button type="button"
                        onClick={() => add(`$${suggestion.latex}$`, suggestion.label)}>
                  {suggestion.label}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
