import { useMemo } from 'react';
import katex from 'katex';

interface Props {
  text: string;
}

/**
 * Texto con matematica intercalada entre `$...$`.
 *
 * El cuaderno tiene que dejar escribir "planteo equilibrio en A" y la ecuacion
 * en la misma linea; separar prosa de formula en campos distintos obligaria a
 * pensar donde va cada cosa antes de poder anotarla.
 */
export function MathText({ text }: Props) {
  const parts = useMemo(() => {
    const out: { math: boolean; value: string }[] = [];
    let buffer = '';
    let math = false;
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] === '$' && text[i - 1] !== '\\') {
        out.push({ math, value: buffer });
        buffer = '';
        math = !math;
        continue;
      }
      buffer += text[i];
    }
    out.push({ math, value: buffer });
    return out.filter((part) => part.value !== '');
  }, [text]);

  return (
    <span className="mathtext">
      {parts.map((part, index) => {
        if (!part.math) {
          return part.value.split('\n').map((line, lineIndex, all) => (
            <span key={`${index}-${lineIndex}`}>
              {line}
              {lineIndex < all.length - 1 && <br />}
            </span>
          ));
        }
        let html: string;
        try {
          html = katex.renderToString(part.value, { throwOnError: false });
        } catch {
          return <code key={index} className="katex-fallback">{part.value}</code>;
        }
        return <span key={index} dangerouslySetInnerHTML={{ __html: html }} />;
      })}
    </span>
  );
}
