import { useMemo } from 'react';
import katex from 'katex';

interface Props {
  latex: string;
  display?: boolean;
}

/** Renderiza LaTeX. Ante un error muestra la fuente en vez de romper la pagina. */
export function Katex({ latex, display = false }: Props) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(latex, { displayMode: display, throwOnError: false });
    } catch {
      return null;
    }
  }, [latex, display]);

  if (html === null) return <code className="katex-fallback">{latex}</code>;
  return (
    <span
      className={display ? 'katex-block' : 'katex-inline'}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
