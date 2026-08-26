# Workspace Funcional

Herramienta para modelar y resolver problemas de mecanica/estatica,
electromagnetismo y termodinamica de forma visual y simbolica, con un flujo
guiado de tres etapas.

## La idea central

Los cuerpos **no** se modelan con cargas puntuales fijas. Una carga es una
**funcion definida sobre el dominio del cuerpo**, y una carga puntual es
simplemente el caso en que esa funcion es una delta.

Concretamente, toda carga -- puntual, uniforme, triangular, trapezoidal,
polinomica o una expresion arbitraria de `x` -- se normaliza a una unica
densidad simbolica `q(x)` escrita en funciones de singularidad (Macaulay):

```
carga puntual P en x = a      ->  P * <x - a>^(-1)
uniforme w0 sobre [a, b]      ->  w0 * (<x - a>^0 - <x - b>^0)
triangular, trapezoidal, ...  ->  combinacion lineal de los anteriores
w0*sin(pi*x/L)                ->  ventana de Heaviside sobre la expresion
```

Y **lo mismo vale en los tres modulos**: una fuente de calor concentrada o una
carga electrica puntual son el mismo objeto matematico que una carga puntual en
una viga. Por eso los tres comparten canonicalizador, integrador y traza.

De ahi sale todo, con **una sola** maquinaria de integracion:

```
Estatica          Termo                 Electro
--------          -----                 -------
R  = ∫ q dx       Q_gen = ∫ g dx        Q   = ∫ λ dx
x̄  = ∫ x q / R    dQ/dx = g(x)          x̄   = ∫ x λ dx / Q
V(x) = ∫ q dx     dT/dx = -Q/(kA)       V(P) = k_e ∫ λ/|P-r(x)| dx
M(x) = ∫ V dx     2 condiciones borde   E(P) = -grad V
y'' = M/(EI) + κ_T(x)
```

Un sistema **hiperestatico** tampoco necesita otra teoria: el equilibrio deja
incognitas sin determinar y las que faltan son *las mismas* condiciones de
desplazamiento que ya cierran un isostatico. Se resuelve todo junto --
reacciones y constantes de integracion -- en un solo sistema lineal.

Un **cable** es la misma cuenta con la rigidez quitada: sin rigidez a flexion
no hay momento interno y la forma la sostiene la tension horizontal `H`, que es
constante pero desconocida:

```
H y''(x) = -q(x)      2 condiciones de apoyo + la flecha, que despeja H
```

Estatica y Termo son literalmente la misma ODE de segundo orden integrada dos
veces con dos condiciones de borde. Electro cambia en que el resultado no vive
sobre el dominio del cuerpo sino sobre el espacio: ahi lo exacto (carga total,
centroide, aporte de cada carga puntual) se resuelve simbolico y la parte
continua queda planteada como integral, con forma cerrada cuando existe y
cuadratura en el navegador cuando no.

El **modo rigido** y el **modo deformable** no son dos solvers: son el mismo
pipeline, truncado en distinto punto.

## Estado

Los tres modulos funcionando de punta a punta, con canvas editable.

| Area | Estado |
|---|---|
| Nucleo de cargas como funciones | listo |
| **Canvas editable**: colocar, arrastrar y borrar | listo |
| Estatica: vigas isostaticas, V/M/theta/y, termico, axial | listo |
| **Cables**: forma, tension horizontal, tensiones en apoyos, longitud | listo |
| Termo: conduccion 1D, generacion, T fija / flujo / conveccion / aislado | listo |
| Electro: linea cargada, cargas puntuales, Biot-Savart | listo |
| **Mapas 2D y superficie 3D** del campo, girables | listo |
| Etapas 1-2-3 con autoguardado y overlays | listo |
| **Hiperestaticos** por compatibilidad de desplazamientos | listo |
| Multi-cuerpo y conexiones | pendiente (se detectan y se reportan) |

## El sandbox

El canvas no es una vista previa: es donde se arma el problema. Se elige un
elemento de la paleta, se hace clic en el cuerpo para colocarlo, se arrastra
para moverlo y `Supr` lo quita.

**Arrastrar escribe una expresion simbolica, no un numero.** El puntero se
engancha a fracciones del dominio -- `L/4`, `2L/3`, `3L/8` -- y con `Alt` se
mueve libre escribiendo un multiplo decimal. Si el arrastre escribiera `2.87`
en vez de `3*L/4`, la etapa 2 dejaria de ser un planteamiento parametrico para
pasar a ser una cuenta, que es justo lo que esta herramienta no quiere ser.

La paleta sale de un catalogo por modulo (`apps/web/src/lib/elements.ts`), asi
que agregar un elemento nuevo es agregar una entrada: ni el canvas ni el
inspector se tocan.

## Estructura

```
apps/
  web/        React + TypeScript + Vite: canvas, stepper, graficos
  api/        FastAPI: capa HTTP delgada. Sin fisica.
packages/
  schema/     JSON Schema generado desde Pydantic -> tipos TypeScript
engine/
  wf_core/    dominios, cargas como funciones, integracion simbolica
  wf_statics/ solvers de vigas y cables
  wf_thermo/  conduccion estacionaria 1D
  wf_em/      lineas cargadas y conductores
  tests/      casos con solucion cerrada conocida
tooling/      generacion de tipos
```

`engine/` es una libreria Python pura, sin ninguna dependencia web. Esa
separacion es deliberada: permite servirla con FastAPI hoy y empaquetarla en
Pyodide manana sin reescribir una sola formula.

## Como correrlo

```bash
uv venv .venv --python 3.11
uv pip install --python .venv/bin/python -e ./engine -e ./apps/api
pnpm install
pnpm gen:types          # tipos TS desde los modelos Pydantic

pnpm api                # backend en :8000
pnpm dev                # frontend en :5173
```

Tests del motor:

```bash
pnpm test:engine
```

## Donde corre el motor, y por que

La derivacion simbolica corre en **Python en el servidor**; la evaluacion
numerica corre en **el navegador**.

SymPy nativo es varias veces mas rapido que en WASM, se puede cancelar de
verdad (matando un proceso, porque SymPy no es interrumpible) y se puede
cachear y depurar. Pyodide costaria 10-25 MB de descarga y varios segundos de
arranque, sin cancelacion real.

Pero la latencia de red no es el problema: la derivacion tarda 100-500 ms y la
red 20-80 ms. Lo que hace que la herramienta se sienta en vivo es **partir el
calculo en dos**:

1. **Derivar** (caro, cacheado por hash del contenido fisico, con debounce):
   modelo -> expresiones de `V(x)`, `M(x)`, `y(x)` en funcion de simbolos.
2. **Evaluar** (barato): el backend devuelve esas expresiones **traducidas a
   JavaScript**, y el cliente las compila una vez. Mover un valor en la etapa 3
   redibuja los diagramas sin tocar la red.

Mover un cuerpo en el canvas cambia `placement`, que queda fuera del hash: no
re-deriva nada.

## Las tres etapas

1. **Armar** — canvas editable: cuerpo, dominio, fuentes como funciones, apoyos
   y condiciones de borde.
2. **Plantear** — ecuaciones derivadas del modelo, en LaTeX, editables, con el
   desarrollo paso a paso.
3. **Valorizar** — valores numericos, diagramas y mapas en vivo, con lo
   definido en las etapas 1 y 2 siempre a la vista.

En Electro el resultado no es una curva sobre el dominio sino un campo en el
espacio, asi que ahi la etapa 3 muestra un **mapa 2D** y una **superficie 3D**
girable. Las dos salen de la misma grilla, integrada en el navegador con los
integrandos que manda el motor: cambiar un valor las redibuja sin pedir nada.

Volver a una etapa anterior **no destruye** el trabajo de las siguientes. Las
etapas 2 y 3 no guardan copias de lo derivado: guardan *overlays* indexados por
id estable. Al cambiar el modelo se re-deriva y se re-aplican los parches; lo
que quedo sin correspondencia pasa a cuarentena y se puede recuperar, nunca se
borra en silencio.

## Convenio de signos

Eje `x` a lo largo del cuerpo, transversal `y` positivo hacia arriba.

- `q(x)` positiva hacia arriba
- `dV/dx = q`, `dM/dx = V` — `M` positivo es momento *sagging*
- `E I y'' = M` mas la curvatura termica impuesta
- pares aplicados positivos en sentido antihorario (+z)
- `κ_T = α (T_inf − T_sup) / h`: cara inferior mas caliente, viga concava
  hacia arriba

En Termo, `Q(x)` es la potencia que atraviesa la seccion en el sentido `+x` y
`g(x)` la generacion por unidad de longitud. **`h` es la altura de la seccion y
`h_c` el coeficiente de conveccion**: si compartieran nombre, poner un gradiente
termico en una viga cambiaria en silencio la conveccion de una barra.

Todo esto esta validado en `engine/tests/` contra soluciones de manual: flecha
de viga, pared plana, generacion parabolica, resistencias en serie, limite de
hilo infinito de Biot-Savart, y forma cerrada contra cuadratura numerica.
