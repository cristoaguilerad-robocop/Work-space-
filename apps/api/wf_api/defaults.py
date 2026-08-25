"""Valores iniciales sugeridos para la etapa 3.

Arrancar con todos los campos vacios obliga al usuario a tipear diez numeros
antes de ver nada. Estas sugerencias son solo un punto de partida editable.
"""

from __future__ import annotations

import sympy as sp

#: (valor, unidad, descripcion) por nombre de simbolo.
SUGGESTIONS: dict[str, tuple[float, str, str]] = {
    "L": (4.0, "m", "Longitud del cuerpo"),
    "w0": (1000.0, "N/m", "Intensidad de carga distribuida"),
    "w1": (1000.0, "N/m", "Intensidad de carga distribuida"),
    "P": (5000.0, "N", "Carga puntual"),
    "M0": (2000.0, "N*m", "Par concentrado"),
    "E": (2.0e11, "Pa", "Modulo de Young (acero)"),
    "I": (8.0e-6, "m^4", "Momento de inercia de la seccion"),
    "A": (2.0e-3, "m^2", "Area de la seccion"),
    "alpha": (1.2e-5, "1/K", "Coeficiente de dilatacion termica (acero)"),
    "h": (0.2, "m", "Altura de la seccion"),
    "T_ref": (20.0, "C", "Temperatura de referencia"),
    "T0": (20.0, "C", "Temperatura base"),
    "dT": (30.0, "K", "Salto de temperatura"),
    "k": (50.0, "W/(m*K)", "Conductividad termica"),
    "rho": (7850.0, "kg/m^3", "Densidad"),
}


def suggest(name: str) -> dict:
    value, units, description = SUGGESTIONS.get(name, (1.0, "", ""))
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
