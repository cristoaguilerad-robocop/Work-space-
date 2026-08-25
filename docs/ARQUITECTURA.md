# Decisiones de arquitectura

Documento vivo. Registra *por que* las cosas estan como estan, para no
re-discutirlas y para que un cambio futuro sepa que esta rompiendo.

## 1. El modelo de "Cuerpo": cinco capas separadas

```
Body
 ├─ placement    pose en el mundo. SOLO dibujo, no participa de la fisica.
 ├─ domain       parametrizacion intrinseca sobre la que se integra.
 ├─ fields[]     cargas y campos como FUNCIONES sobre ese dominio.
 ├─ constitutive material y seccion. Solo se usa en modo deformable.
 └─ analysis     rigido | deformable.
```

Por que separadas:

- **`placement` vs `domain`**: mover un cuerpo en el canvas no debe tocar el
  planteo. Ademas permite cachear la derivacion excluyendo `placement` del hash.
- **`domain` vs `fields`**: la misma maquinaria de integracion sirve para una
  barra recta, un arco de corriente (Electro) y una aleta curva (Termo). El
  dominio lleva su `jacobian` explicito para que "por unidad de longitud"
  signifique lo mismo en geometrias curvas.
- **`constitutive` aparte**: el modo rigido no necesita `E` ni `I`, asi que la
  UI no los pide y el solver no falla por su ausencia.

### Las cargas son funciones, no valores

`LoadSpec` = `region` (donde) + `distribution` (que forma) + `direction`.

La `region` es un tramo del **dominio parametrico**, no una posicion en
pantalla. La `distribution` es una union discriminada: `point`, `uniform`,
`linear` (cubre triangular y trapezoidal: son el mismo objeto matematico),
`polynomial`, `expression` (funcion arbitraria de `x`) y `piecewise`.

Internamente **todas** se normalizan a una densidad simbolica unica. Ver el
README para el detalle. La consecuencia practica: agregar un tipo de
distribucion nuevo es escribir su perfil `w(x)`; no toca el integrador, ni el
solver, ni la UI de graficos, ni el canvas.

### El campo termico guarda el gradiente, no el promedio

`ThermalProfileLinear` guarda `T_top` y `T_bottom` por separado. Si guardara
solo `T(x)` media seria imposible modelar flexion termica, y agregarlo despues
obligaria a migrar todos los documentos guardados.

Produce dos aportes distintos:

- `ε_T(x) = α (T_media(x) − T_ref)` → alargamiento axial
- `κ_T(x) = α (T_inf(x) − T_sup(x)) / h` → curvatura, que se **suma** a `M/EI`

### Los apoyos no son parte del cuerpo

`StructuralSupport` es una entidad del sistema, anclada a
`(body_id, coordenada parametrica)`. Anclarla a pixeles haria que mover el
cuerpo rompiera el modelo fisico.

### Ids estables, nunca posicionales

Las ecuaciones y los simbolos derivan su nombre de ids del modelo (`R_A`,
`bar1:sumF`, `w0`), nunca de indices en un array. Si el simbolo de la segunda
carga se llamara `w2` por su posicion, reordenar las cargas destruiria todos
los valores numericos de la etapa 3.

## 2. El documento y las tres etapas

Las etapas 2 y 3 **no guardan copias** de lo derivado. Guardan *overlays*:

```
ProblemDoc
 ├─ stage1  el modelo fisico
 ├─ stage2  { edits: { <id de ecuacion>: latex }, added: [] }
 └─ stage3  { bindings: { <simbolo>: valor }, quarantined: {} }
```

Al cambiar el modelo se re-deriva desde cero y se re-aplican los overlays por
id. Lo que queda sin correspondencia **no se borra**: pasa a `quarantined` y
vuelve intacto si el usuario deshace el cambio. Esa es la respuesta al
requisito "volver a un paso anterior sin perder el trabajo de los siguientes".

## 3. Donde corre el motor

**Derivacion simbolica en el servidor, evaluacion numerica en el cliente.**

La velocidad percibida no depende de donde corre Python, sino de partir el
calculo. Ver README para el razonamiento completo.

`engine/` es una libreria Python pura, sin dependencias web. Si manana el modo
offline pasa a ser un requisito duro, se empaqueta el mismo wheel en Pyodide
detras de la misma interfaz, sin reescribir formulas. La puerta queda abierta;
no la cruzamos ahora.

## 4. Contrato de tipos: una sola fuente

El modelo se define **una vez**, en `engine/wf_core/model.py` (Pydantic). De
ahi se genera el JSON Schema y de ahi los tipos de TypeScript
(`pnpm gen:types`). Definirlo dos veces garantiza que se desincronicen.

El schema se genera en modo *serializacion* y se marcan todas las propiedades
como requeridas: describen lo que viaja por la red y lo que se guarda en disco,
donde `model_dump_json` siempre emite todos los campos.

## 5. Lo que el motor se niega a adivinar

Un solver que devuelve un numero plausible cuando el modelo esta mal planteado
es peor que uno que se planta. Se reportan como error, no se resuelven:

- mas o menos de 2 incognitas de reaccion en el plano transversal
  (hiperestatico o inestable)
- modo deformable sin `E` e `I`
- gradiente termico sin altura de seccion `h`
- restriccion axial en mas de un punto (hiperestatico axial)
- carga distribuida aplicada en un solo punto, o par aplicado en un tramo

Ademas, cada solucion trae `V(L)` y `M(L)` como **residuos**: si las reacciones
son correctas ambos se anulan. Es una verificacion que corre siempre y que la
etapa 2 muestra.

## 6. El canvas editable

Arrastrar produce una **expresion simbolica**, no un numero. Es la decision que
sostiene todo el proyecto: el puntero se engancha a fracciones del dominio
(`positionExpression` en `apps/web/src/lib/symbolic.ts`) y con `Alt` escribe un
multiplo decimal, que sigue siendo simbolico en el dominio.

Mientras dura el arrastre el elemento se dibuja en la posicion del cursor sin
esperar al motor. La derivacion tarda cientos de milisegundos; si el elemento
esperara, llegaria despues del dedo.

Lo que se dibuja depende de lo que la magnitud *es*, no de como se guarda: una
fuerza lleva flecha porque tiene sentido de aplicacion; una densidad de carga o
una generacion de calor se dibujan con su signo, porque son escalares y una
flecha insinuaria una direccion que el modelo no tiene.

## 7. Deuda conocida y proximos pasos

**Hecho** — Termo (conduccion 1D) y Electro (lineas cargadas, Biot-Savart,
mapa 2D), sobre el mismo nucleo. Canvas editable en los tres modulos.

**Proximo** — multi-cuerpo y conexiones; hiperestaticos (por compatibilidad de
desplazamientos, reusando la elastica que ya se calcula); vista 3D; dominios
curvos en Electro (el `Domain` ya lleva el jacobiano explicito y el
discriminador `kind`, pero `ArcEmbedding` todavia no tiene marco local).

**Riesgos vigilados**

- `sympy.solve` colgandose: hay timeout con cancelacion real, pero el fallback
  numerico todavia no esta.
- Unidades: hoy son una etiqueta, no se validan ni se convierten. La decision
  tomada es llevarlas explicitas en el schema pero **resolver adimensionalizado**
  y convertir solo en la frontera; meter unidades dentro de SymPy lo vuelve
  mucho mas lento.
- El modulo Electro va a estresar `Domain`: integrales de linea sobre arcos,
  campos vectoriales, dominios 2D/3D. Conviene bocetar un problema de
  Biot-Savart contra el schema actual antes de darlo por cerrado.
- El sync al servidor de los documentos no existe: hoy el autoguardado es solo
  local (IndexedDB/localStorage).
