import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'katex/dist/katex.min.css';

import { App } from './App';
import './styles.css';

/**
 * Asegura el viewport.
 *
 * Sin `<meta name="viewport">`, un iPad supone que la pagina fue escrita para
 * un monitor: la maqueta a 980 px y la achica para que entre. Todo queda chico
 * y cada toque cae dos pixeles al lado de donde uno cree. Cuando la pagina se
 * publica embebida, el `<head>` no es nuestro, asi que se pone desde aca --
 * agregarlo por script sirve igual.
 */
function ensureViewport(): void {
  if (document.querySelector('meta[name="viewport"]')) return;
  const meta = document.createElement('meta');
  meta.name = 'viewport';
  meta.content = 'width=device-width, initial-scale=1';
  document.head.appendChild(meta);
}

ensureViewport();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
