# La app, en un archivo

`docs/index.html` (en la raiz del repo) es la aplicacion entera —el canvas donde se pone y se saca, el 3D,
el cuaderno y el teclado— empaquetada en un solo archivo que se abre sin
servidor. No es la demo: la demo (`tooling/demo`) es un catalogo de casos ya
resueltos, para leer; esto es para trabajar.

Lo unico que no viaja es el motor simbolico, que es Python. En su lugar van los
ejemplos ya derivados. Por eso:

- los ejemplos del selector se abren con ecuaciones y curvas;
- lo que armes vos se dibuja, se mueve, se mira en 3D y se guarda, pero no se
  resuelve solo (la pagina lo dice, no falla).

Para tener el motor hay que correr la app de verdad (`pnpm dev` + `uvicorn`).

## Rehacerlo

```sh
../../.venv/bin/python build_bundle.py   # deriva los ejemplos -> bundle.json
cd ../../apps/web && npx vite build      # compila la app
cd - && node pack.mjs                    # todo junto -> ../../docs/index.html
```

Sale a `docs/` porque es una de las dos carpetas que GitHub Pages sabe publicar
(la otra es la raiz). El mismo archivo que se abre a mano es el que tiene URL:
sin un paso de copia que alguien se olvide de hacer.


`build_bundle.py` indexa cada derivacion por la identidad fisica del modelo,
con la misma clave que calcula el cliente (`apps/web/src/lib/physicskey.ts`).
Si las dos no coinciden al byte, el navegador simplemente no encuentra el
resultado: no se rompe nada, el ejemplo aparece sin resolver.

El destino corre con una CSP que prohibe compilar codigo, asi que las funciones
del motor viajan tambien como arbol serializado y el cliente las evalua
recorriendolo (`emit_ast`).
