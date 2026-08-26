"""Valores iniciales sugeridos para la etapa 3.

Arrancar con todos los campos vacios obliga al usuario a tipear diez numeros
antes de ver nada. Estas sugerencias son solo un punto de partida editable.
"""

from __future__ import annotations

import re

import sympy as sp

#: (valor, unidad, descripcion) por nombre de simbolo.
SUGGESTIONS: dict[str, tuple[float, str, str]] = {
    # Los valores mecanicos describen una barra de acero de seccion cuadrada
    # de 10 cm: A = 0.01 m2, I = 0.1^4/12 = 8.3e-6 m4, h = 0.1 m. Que sean
    # consistentes entre si importa: con una seccion y una inercia de
    # cuerpos distintos, los numeros de la etapa 3 no describen nada.
    "L": (4.0, "m", "Longitud del cuerpo"),
    "f": (0.4, "m", "Flecha del cable"),
    "hB": (0.8, "m", "Desnivel del apoyo derecho"),
    "H0": (5000.0, "N", "Tension horizontal impuesta"),
    "w0": (1000.0, "N/m", "Intensidad de carga distribuida"),
    "w1": (1000.0, "N/m", "Intensidad de carga distribuida"),
    "P": (5000.0, "N", "Carga puntual"),
    "M0": (2000.0, "N*m", "Par concentrado"),
    "E": (2.0e11, "Pa", "Modulo de Young (acero)"),
    "I": (8.0e-6, "m^4", "Momento de inercia de la seccion"),
    "A": (1.0e-2, "m^2", "Area de la seccion"),
    "alpha": (1.2e-5, "1/K", "Coeficiente de dilatacion termica (acero)"),
    # OJO: "h" es la altura de la seccion (Estatica). El coeficiente de
    # conveccion es "h_c": si compartieran nombre, poner un gradiente termico
    # en una viga cambiaria en silencio la conveccion de una barra.
    "h": (0.1, "m", "Altura de la seccion"),
    "h_c": (25.0, "W/(m^2*K)", "Coeficiente de conveccion"),
    "T_ref": (20.0, "C", "Temperatura de referencia"),
    "T0": (20.0, "C", "Temperatura base"),
    "dT": (30.0, "K", "Salto de temperatura"),
    "k": (200.0, "W/(m*K)", "Conductividad termica"),
    "rho": (7850.0, "kg/m^3", "Densidad"),
    # Electro
    "lam0": (3e-9, "C/m", "Densidad lineal de carga"),
    "q0": (5e-9, "C", "Carga puntual"),
    "I0": (10.0, "A", "Corriente"),
    "k_e": (8.9875517923e9, "N*m^2/C^2", "Constante de Coulomb, 1/(4 pi eps0)"),
    "k_m": (1e-7, "T*m/A", "mu0 / (4 pi)"),
    "d": (0.5, "m", "Distancia al punto de observacion"),
    # Termo
    "g0": (100.0, "W/m", "Generacion de calor por unidad de longitud"),
    "Q0": (400.0, "W", "Fuente de calor concentrada"),
    "T1": (100.0, "C", "Temperatura impuesta"),
    "T2": (20.0, "C", "Temperatura impuesta"),
    "T_inf": (20.0, "C", "Temperatura ambiente"),
}


#: Reglas por prefijo, para los simbolos que el usuario crea sobre la marcha.
#: Cada cuerpo nuevo estrena su propio simbolo de longitud (`L1`, `L2`, ...) y
#: sin esto naceria de 1 m, casi invisible en el canvas.
_PREFIXED: list[tuple[re.Pattern[str], tuple[float, str, str]]] = [
    (re.compile(r"^L\d+$"), (4.0, "m", "Longitud del cuerpo")),
    (re.compile(r"^w\d+$"), (1000.0, "N/m", "Intensidad de carga distribuida")),
    (re.compile(r"^P\d+$"), (5000.0, "N", "Carga puntual")),
    # Figuras rigidas: radio, lado, masa y constante de resorte. Mismos valores
    # que sugiere el canvas al colocarlas (apps/web/src/lib/elements.ts), asi
    # que un cuerpo puesto sin backend no cambia de tamano cuando lo hay.
    (re.compile(r"^R\d+$"), (0.5, "m", "Radio")),
    (re.compile(r"^a\d+$"), (1.0, "m", "Lado del bloque")),
    (re.compile(r"^b\d+$"), (0.6, "m", "Alto del bloque")),
    (re.compile(r"^m\d+$"), (2.0, "kg", "Masa")),
    (re.compile(r"^k\d+$"), (1000.0, "N/m", "Constante del resorte")),
]


def suggest(name: str) -> dict:
    fallback = (1.0, "", "")
    for pattern, guess in _PREFIXED:
        if pattern.match(name):
            fallback = guess
            break
    value, units, description = SUGGESTIONS.get(name, fallback)
    return {
        "name": name,
        # SymPy sabe que "alpha" se escribe \alpha y que "T_ref" lleva el
        # subindice completo entre llaves. Mandar el nombre crudo a KaTeX
        # renderiza "T_ref" como T_r ef.
        "latex": sp.latex(sp.Symbol(name)),
        "value": value,
        "units": units,
        "description": description,
    }
