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

De ahi sale todo, con **una sola** maquinaria de integracion:

```
R  = ∫ q dx                    resultante
x̄  = ∫ x q dx / R              punto de aplicacion
V(x) = ∫ q dx                  cortante
M(x) = ∫ V dx                  momento flector
y''  = M/(EI) + κ_T(x)         elastica, con curvatura termica
θ, y = integrando dos veces mas
```

El **modo rigido** y el **modo deformable** no son dos solvers: son el mismo
pipeline, truncado en distinto punto.

## Estado

Sprint 1 completo: modulo de Estatica, cuerpo tipo barra/viga 1D, las tres
etapas funcionando de punta a punta.

| Area | Estado |
|---|---|
| Nucleo de cargas como funciones | listo |
| Vigas isostaticas (simplemente apoyada, voladizo) | listo |
| Cortante, momento, pendiente, deflexion | listo |
| Campo termico (dilatacion + curvatura por gradiente) | listo |
| Fuerza axial y alargamiento | listo |
| Etapas 1-2-3 con autoguardado y overlays | listo |
| Vista 3D | pendiente |
| Modulos Electro y Termo | pendiente |
| Sistemas hiperestaticos, multi-cuerpo | pendiente (se detectan y se reportan) |

## Estructura

```
apps/
  web/        React + TypeScript + Vite: canvas, stepper, graficos
  api/        FastAPI: capa HTTP delgada. Sin fisica.
packages/
  schema/     JSON Schema generado desde Pydantic -> tipos TypeScript
engine/
  wf_core/    dominios, cargas como funciones, integracion simbolica
  wf_statics/ solver de vigas
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

1. **Modelar** — canvas visual: cuerpo, dominio, cargas como funciones, apoyos.
2. **Plantear** — ecuaciones derivadas del modelo, en LaTeX, editables, con el
   desarrollo paso a paso.
3. **Valorizar** — valores numericos y diagramas en vivo, con lo definido en
   las etapas 1 y 2 siempre a la vista.

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

Todo esto esta validado en `engine/tests/` contra soluciones de manual.
