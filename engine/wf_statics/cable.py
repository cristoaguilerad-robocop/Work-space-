"""Cables flexibles bajo carga transversal.

Un cable es el mismo problema que una viga con la rigidez quitada. Sin rigidez
a flexion no hay momento interno: la forma la sostiene la componente horizontal
de la tension, que es constante a lo largo del cable. El equilibrio vertical de
un tramo da

    d/dx ( H dy/dx ) + q(x) = 0    ->    H y''(x) = -q(x)

que es otra vez integrar dos veces la misma densidad canonica ``q(x)``. Por eso
este modulo no reimplementa nada: toma ``q`` del canonicalizador, igual que la
viga, el flujo de calor y la densidad de carga.

La diferencia esta en que ``H`` es una incognita mas. Con dos apoyos hay dos
condiciones de borde para las constantes de integracion, y hace falta un dato
adicional para cerrar: la flecha en un punto, o directamente ``H``.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import sympy as sp

from wf_core import singularity as sg
from wf_core.canonical import assemble
from wf_core.equations import EquationSet
from wf_core.expressions import parse, symbol
from wf_core.model import Body, StructuralSupport
from wf_core.steps import StepTrace


class ModelError(ValueError):
    """El cable no se puede resolver tal como esta planteado."""


@dataclass
class CableSolution:
    body_id: str
    functions: dict[str, sp.Expr] = field(default_factory=dict)
    scalars: dict[str, sp.Expr] = field(default_factory=dict)
    residuals: dict[str, sp.Expr] = field(default_factory=dict)
    equations: EquationSet = field(default_factory=EquationSet)
    trace: StepTrace = field(default_factory=StepTrace)
    notes: list[str] = field(default_factory=list)


def solve_cable(body: Body, supports: list[StructuralSupport]) -> CableSolution:
    domain = body.domain
    x = sp.Symbol(domain.parameter)
    L = parse(domain.end)

    if len(supports) != 2:
        raise ModelError(
            f"el cable {body.id!r} necesita exactamente 2 apoyos, tiene {len(supports)}"
        )
    if body.cable is None:
        raise ModelError(
            f"el cable {body.id!r} no dice como se cierra: falta la flecha o la tension "
            "horizontal."
        )

    left, right = sorted(supports, key=lambda s: sg._positive_sign(parse(s.at)) or 0)
    xA, xB = parse(left.at), parse(right.at)
    yA, yB = parse(left.elevation), parse(right.elevation)

    sol = CableSolution(body_id=body.id)
    trace, eqs = sol.trace, sol.equations

    loading = assemble(body)
    q = loading.q_transverse
    trace.add("canonical", "Densidad de carga canonica", q, lhs="q(x)", kind="algebra",
              detail="La misma densidad que usa una viga. Un cable no tiene rigidez, "
                     "pero la carga se describe igual.")
    eqs.add(f"{body.id}:q", "Densidad de carga", q, lhs="q(x)", role="field")

    # ------------------------------------------------------------------ forma
    H = symbol("H") if body.cable.mode == "sag" else parse(body.cable.H or "H")
    C1, C2 = symbol("C1"), symbol("C2")

    double = sg.antiderivative(sg.antiderivative(q, x), x)
    y = sp.expand(-double / H + C1 * x + C2)

    trace.add("shape-raw", "Ecuacion de la curva", y, lhs="y(x)", kind="integrate",
              detail="H y'' = -q(x), integrada dos veces.")

    bc_left = sp.Eq(sg.evaluate_at(y, x, xA), yA)
    bc_right = sp.Eq(sg.evaluate_at(y, x, xB), yB)
    for index, (name, equation) in enumerate([("izquierdo", bc_left), ("derecho", bc_right)]):
        eqs.add(f"{body.id}:bc{index}", f"Apoyo {name}", equation, role="equilibrium")
        trace.add(f"bc{index}", f"Apoyo {name}", equation, kind="algebra")

    constants = sp.solve([bc_left, bc_right], [C1, C2], dict=True)
    if not constants:
        raise ModelError("los apoyos no determinan la curva del cable")
    y = sp.expand(y.subs(constants[0]))

    # ------------------------------------------------------- cierre por flecha
    if body.cable.mode == "sag":
        at = parse(body.cable.at) if body.cable.at else sp.simplify((xA + xB) / 2)
        sag = parse(body.cable.sag or "f")

        # La flecha se mide desde la cuerda, no desde la horizontal: con apoyos
        # a distinta altura son cosas distintas, y la que usa el enunciado de un
        # problema es siempre la primera.
        chord = yA + (yB - yA) * (at - xA) / (xB - xA)
        equation = sp.Eq(chord - sg.evaluate_at(y, x, at), sag)
        eqs.add(f"{body.id}:sag", "Flecha impuesta", equation, role="equilibrium",
                detail="Distancia vertical de la cuerda al cable en el punto de medida.")
        trace.add("sag", "Flecha impuesta", equation, kind="algebra")

        solution = sp.solve(equation, H, dict=True)
        if not solution:
            raise ModelError(
                "la flecha no determina la tension horizontal: revisa que el punto de "
                "medida no coincida con un apoyo."
            )
        H_value = sp.simplify(solution[0][H])
        y = sp.simplify(y.subs({H: H_value}))
        sol.scalars["H"] = H_value
        trace.add("H", "Tension horizontal", H_value, lhs="H", kind="solve")
        eqs.add(f"{body.id}:H", "Tension horizontal", H_value, lhs="H", role="result")
        H = H_value
    else:
        sol.scalars["H"] = H

    sol.functions["y"] = y
    trace.add("shape", "Curva del cable", y, lhs="y(x)", kind="solve")
    eqs.add(f"{body.id}:y", "Curva del cable", y, lhs="y(x)", role="field")

    # ------------------------------------------------------------- tensiones
    slope = sp.expand(sp.diff(y, x))
    vertical = sp.expand(H * slope)
    tension = sp.sqrt(H**2 + vertical**2)

    sol.functions["slope"] = slope
    sol.functions["V"] = vertical
    sol.functions["T"] = tension
    trace.add("tension-v", "Componente vertical de la tension", vertical, lhs="V(x)",
              kind="algebra", detail="V(x) = H y'(x): la tension es tangente al cable.")
    trace.add("tension", "Tension total", tension, lhs="T(x)", kind="algebra",
              detail="T(x) = sqrt(H^2 + V(x)^2).")
    eqs.add(f"{body.id}:V", "Componente vertical", vertical, lhs="V(x)", role="field")
    eqs.add(f"{body.id}:T", "Tension", tension, lhs="T(x)", role="field")

    # La tension maxima esta donde la pendiente es maxima, y en un cable con
    # carga hacia abajo eso es siempre uno de los dos apoyos.
    ends = [sg.evaluate_at(vertical, x, xA), sg.activate(vertical, x, xB)]
    T_ends = [sp.sqrt(H**2 + value**2) for value in ends]
    sol.scalars["T_A"] = sp.simplify(T_ends[0])
    sol.scalars["T_B"] = sp.simplify(T_ends[1])
    eqs.add(f"{body.id}:TA", "Tension en el apoyo izquierdo", sol.scalars["T_A"],
            lhs="T_A", role="result")
    eqs.add(f"{body.id}:TB", "Tension en el apoyo derecho", sol.scalars["T_B"],
            lhs="T_B", role="result")
    trace.add("tension-ends", "Tension en los apoyos",
              f"T_A = {sp.latex(sol.scalars['T_A'])}, \\quad T_B = {sp.latex(sol.scalars['T_B'])}",
              kind="solve",
              detail="La tension maxima esta donde la pendiente lo es, y con carga hacia "
                     "abajo eso es siempre un apoyo.")

    # ------------------------------------------------------------- longitud
    #
    # La longitud necesita el polinomio del interior: sqrt(1 + y'^2) no se
    # integra contra funciones de singularidad. Con una carga que entra o sale
    # en un punto interior el cable es genuinamente partido y no hay una sola
    # forma polinomica, asi que ahi se reporta en vez de forzarlo.
    inner = sg.interior_form(slope, x, xA, xB)
    if inner is None:
        sol.notes.append(
            "El cable tiene un quiebre interior (una carga concentrada o un tramo de "
            "carga que empieza dentro del vano), asi que la longitud no sale de una "
            "sola integral cerrada."
        )
    else:
        length = sg.integrate_positive(sp.sqrt(1 + inner**2), x, xA, xB)
        if length is None:
            sol.notes.append(
                "La longitud del cable no tiene forma cerrada elemental para esta carga."
            )
        else:
            sol.scalars["length"] = length
            trace.add("length", "Longitud del cable", length, lhs="s", kind="integrate",
                      detail="s = int sqrt(1 + y'^2) dx sobre el vano.")
            eqs.add(f"{body.id}:length", "Longitud", length, lhs="s", role="result")

    return sol
