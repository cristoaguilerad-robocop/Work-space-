"""Conduccion estacionaria 1D en una barra o aleta.

La estructura es *identica* a la de una viga, y no por casualidad: ambos
problemas son una ODE de segundo orden con dos condiciones de borde, resuelta
integrando dos veces una densidad definida sobre el dominio.

    viga:   dV/dx = q(x)     dM/dx = V(x)      -> 2 condiciones de borde
    barra:  dQ/dx = g(x)     dT/dx = -Q/(k A)  -> 2 condiciones de borde

Por eso este modulo reusa el mismo canonicalizador, el mismo integrador y la
misma traza de pasos. Lo unico propio es la ley constitutiva (Fourier) y el
catalogo de condiciones de borde.

Convenio de signos: ``x`` a lo largo de la barra, ``Q(x)`` es la potencia
termica que atraviesa la seccion en el sentido ``+x`` (W), y ``g(x)`` es la
generacion por unidad de longitud (W/m).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import sympy as sp

from wf_core import singularity as sg
from wf_core.canonical import assemble, resultant
from wf_core.equations import EquationSet
from wf_core.expressions import parse, symbol
from wf_core.model import Body, BoundaryCondition
from wf_core.steps import StepTrace


class ModelError(ValueError):
    """El problema termico no se puede resolver tal como esta planteado."""


@dataclass
class BarSolution:
    body_id: str
    functions: dict[str, sp.Expr] = field(default_factory=dict)
    scalars: dict[str, sp.Expr] = field(default_factory=dict)
    residuals: dict[str, sp.Expr] = field(default_factory=dict)
    equations: EquationSet = field(default_factory=EquationSet)
    trace: StepTrace = field(default_factory=StepTrace)
    notes: list[str] = field(default_factory=list)


def solve_bar(body: Body, boundaries: list[BoundaryCondition]) -> BarSolution:
    domain = body.domain
    x = sp.Symbol(domain.parameter)
    L = parse(domain.end)

    if not body.constitutive.k:
        raise ModelError(
            f"el cuerpo {body.id!r} necesita la conductividad termica 'k'"
        )
    k = parse(body.constitutive.k)
    A = parse(body.constitutive.A) if body.constitutive.A else sp.Integer(1)
    kA = k * A

    sol = BarSolution(body_id=body.id)
    trace, eqs = sol.trace, sol.equations

    loading = assemble(body)
    g = loading.sources.get("heat_source", sp.S.Zero)

    trace.add(
        "canonical", "Generacion de calor canonica", g, lhs="g(x)", kind="algebra",
        detail=(
            "Fuentes puntuales y distribuidas quedan escritas como una unica densidad, "
            "igual que las cargas en una viga."
        ),
    )
    eqs.add(f"{body.id}:g", "Generacion de calor", g, lhs="g(x)", role="field")

    if sp.simplify(g) != 0:
        total = resultant(g, x, L)
        sol.scalars["generated"] = total
        trace.add("generated", "Potencia generada total", total, lhs="Q_{gen}",
                  kind="integrate", detail="Q_gen = int_0^L g(x) dx.")
        eqs.add(f"{body.id}:Qgen", "Potencia generada", total, lhs="Q_{gen}", role="result")

    # ------------------------------------------------------------------ campos
    # Dos constantes: el flujo entrante por la izquierda y la temperatura ahi.
    C_Q, C_T = symbol("C_Q"), symbol("C_T")

    Q0 = sg.antiderivative(g, x)
    Q = sp.expand(C_Q + Q0)

    T0 = sg.antiderivative(-Q0 / kA, x)
    T = sp.expand(C_T - C_Q * x / kA + T0)

    trace.add("flux-raw", "Balance de energia (primera integracion)", Q, lhs="Q(x)",
              kind="integrate", detail="dQ/dx = g(x).")
    trace.add("temp-raw", "Ley de Fourier (segunda integracion)", T, lhs="T(x)",
              kind="integrate", detail="dT/dx = -Q(x)/(k A).")

    # ------------------------------------------------------- condiciones de borde
    if len(boundaries) != 2:
        raise ModelError(
            f"el cuerpo {body.id!r} tiene {len(boundaries)} condiciones de borde; "
            "la conduccion 1D estacionaria necesita exactamente 2 (una en cada extremo)."
        )

    equations: list[sp.Eq] = []
    for bc in boundaries:
        at = parse(bc.at)
        T_at = sg.evaluate_at(T, x, at)
        Q_at = sg.evaluate_at(Q, x, at)
        left = sg._positive_sign(at - parse(domain.start)) == 0

        if bc.type == "temperature":
            if bc.value is None:
                raise ModelError(f"la condicion {bc.id!r} necesita una temperatura")
            equation = sp.Eq(T_at, parse(bc.value))
            title = f"Temperatura impuesta en {bc.id}"
        elif bc.type == "insulated":
            equation = sp.Eq(Q_at, 0)
            title = f"Extremo aislado en {bc.id}"
        elif bc.type == "flux":
            if bc.value is None:
                raise ModelError(f"la condicion {bc.id!r} necesita un flujo")
            equation = sp.Eq(Q_at, parse(bc.value))
            title = f"Flujo impuesto en {bc.id}"
        else:  # conveccion
            if bc.value is None or bc.h is None:
                raise ModelError(
                    f"la conveccion en {bc.id!r} necesita temperatura ambiente y 'h'"
                )
            h, T_inf = parse(bc.h), parse(bc.value)
            # Con Q positivo hacia +x: en el extremo izquierdo el ambiente
            # entrega calor a la barra, en el derecho la barra lo entrega al
            # ambiente. De ahi el cambio de signo.
            flow = h * A * (T_inf - T_at) if left else h * A * (T_at - T_inf)
            equation = sp.Eq(Q_at, flow)
            title = f"Conveccion en {bc.id}"

        equations.append(equation)
        eqs.add(f"{body.id}:bc_{bc.id}", title, equation, role="equilibrium")
        trace.add(f"bc_{bc.id}", title, equation, kind="algebra")

    solution = sp.solve(equations, [C_Q, C_T], dict=True)
    if not solution:
        raise ModelError(
            "las condiciones de borde no determinan el campo: revisa que no sean "
            "dos flujos impuestos incompatibles (el problema queda indeterminado)."
        )
    consts = solution[0]

    Q = sp.expand(Q.subs(consts))
    T = sp.expand(T.subs(consts))
    sol.functions["Q"] = Q
    sol.functions["T"] = T

    trace.add("constants", "Constantes de integracion",
              ", \\quad ".join(f"{sp.latex(key)} = {sp.latex(sp.simplify(value))}"
                               for key, value in consts.items()),
              kind="solve")
    trace.add("flux", "Flujo de calor", Q, lhs="Q(x)", kind="solve")
    trace.add("temp", "Campo de temperatura", T, lhs="T(x)", kind="solve")
    eqs.add(f"{body.id}:Q", "Flujo de calor", Q, lhs="Q(x)", role="field")
    eqs.add(f"{body.id}:T", "Temperatura", T, lhs="T(x)", role="field")

    # ------------------------------------------------------------ verificacion
    entering = sp.simplify(sg.evaluate_at(Q, x, parse(domain.start)))
    leaving = sp.simplify(sg.activate(Q, x, L))
    generated = sp.simplify(resultant(g, x, L)) if sp.simplify(g) != 0 else sp.S.Zero
    balance = sp.simplify(leaving - entering - generated)

    sol.scalars["Q_in"] = entering
    sol.scalars["Q_out"] = leaving
    sol.residuals["balance"] = balance
    trace.add(
        "check", "Balance global de energia",
        f"Q(L) - Q(0) - Q_{{gen}} = {sp.latex(balance)}",
        kind="check",
        detail="Lo que sale menos lo que entra debe ser exactamente lo generado.",
    )
    if balance != 0:
        sol.notes.append(f"El balance de energia no cierra: residuo {balance}.")

    eqs.add(f"{body.id}:Qin", "Calor entrante", entering, lhs="Q(0)", role="result")
    eqs.add(f"{body.id}:Qout", "Calor saliente", leaving, lhs="Q(L)", role="result")

    return sol
