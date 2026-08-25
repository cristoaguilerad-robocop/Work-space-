import { paletteFor, type Module } from '../lib/elements';

interface Props {
  module: Module;
  pending: string | null;
  onPick: (id: string | null) => void;
}

/**
 * Paleta de elementos. Se elige uno y despues se hace clic en el canvas para
 * colocarlo, que es como funcionan las herramientas de dibujo: el clic decide
 * la posicion, y esa posicion se guarda como expresion del dominio.
 */
export function Palette({ module, pending, onPick }: Props) {
  return (
    <div className="palette">
      {paletteFor(module).map((item) => (
        <button
          key={item.id}
          type="button"
          className="tool"
          aria-pressed={pending === item.id}
          title={item.hint}
          onClick={() => onPick(pending === item.id ? null : item.id)}
        >
          <b>{item.label}</b>
          <span>{item.hint}</span>
        </button>
      ))}
      {pending && (
        <p className="placing-hint">
          Hace clic en el canvas para colocarlo. Los cuerpos van en cualquier punto;
          las cargas, apoyos y bordes, sobre un cuerpo. Con <kbd>Alt</kbd> no engancha
          a fracciones del dominio.
        </p>
      )}
    </div>
  );
}
