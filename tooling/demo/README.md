# Demo publicable

Genera un unico HTML autocontenido con nueve modelos pre-derivados.

```bash
../../.venv/bin/python build_payloads.py   # deriva y congela los modelos
node render.mjs                            # arma index.html
```

## Por que pre-derivar

La derivacion simbolica necesita SymPy, que no corre en una pagina estatica.
La **evaluacion numerica** en cambio si: es la misma que usa la app real, asi
que la etapa 3 de la demo responde igual de rapido que la de verdad.

## Por que un AST y no el codigo JavaScript

El motor emite las dos formas de cada expresion. La app usa el codigo, que
compila con `new Function` y es mas rapido. La demo usa el arbol serializado,
que se recorre con un interprete de treinta lineas: las paginas publicadas
corren bajo una CSP que prohibe `eval`, y ahi `new Function` deja la pagina
muerta. Verificado sirviendo la pagina con `script-src 'unsafe-inline'` a secas.

Las fuentes de KaTeX se incrustan como data URIs y el LaTeX se rinde en tiempo
de build: la pagina no hace ni un pedido de red salvo Google Fonts, que tiene
fallback.
