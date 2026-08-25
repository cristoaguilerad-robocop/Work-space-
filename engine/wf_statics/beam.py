"""Solver de vigas/barras determinadas en el plano.

Convenio de signos (validado contra casos de manual en ``tests/``):

* eje ``x`` a lo largo del cuerpo, transversal ``y`` positivo "hacia arriba"
* ``q(x)`` positiva hacia arriba
* ``dV/dx = q``  y  ``dM/dx = V``  -> ``M`` positivo es momento *sagging*
* ``E I y'' = M``  mas la curvatura termica impuesta
* pares aplicados positivos en sentido antihorario (+z)

Estrategia: primero se resuelven las reacciones por equilibrio global, y recien
despues se integra ``q`` incluyendo esas reacciones, arrancando "desde la
izquierda de todo". Asi ``V`` y ``M`` salen sin constantes de integracion y
``V(L) = M(L) = 0`` queda como verificacion automatica del resultado.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import sympy as sp

from wf_core import singularity as sg
from wf_core.canonical import assemble, centroid, moment_about_origin, resultant
from wf_core.equations import EquationSet
from wf_core.expressions import ExpressionError, parse, symbol
from wf_core.model import Body, StructuralSupport
from wf_core.steps import StepTrace

#: Apoyos que restringen el desplazamiento transversal.
_TRANSVERSE_RESTRAINT = {"pin", "roller", "fixed"}
#: Apoyos que restringen el desplazamiento axial.
_AXIAL_RESTRAINT = {"pin", "fixed"}


class ModelError(ValueError):
    """El modelo no se puede resolver tal como esta planteado."""


@dataclass
class BeamSolution:
    body_id: str
    mode: str
    reactions: dict[str, sp.Expr] = field(default_factory=dict)
    functions: dict[str, sp.Expr] = field(default_factory=dict)
    scalars: dict[str, sp.Expr] = field(default_factory=dict)
    residuals: dict[str, sp.Expr] = field(default_factory=dict)
    equations: EquationSet = field(default_factory=EquationSet)
    trace: StepTrace = field(default_factory=StepTrace)
    notes: list[str] = field(default_factory=list)


def solve_beam(body: Body, supports: list[StructuralSupport]) -> BeamSolution:
    domain = body.domain
    x = sp.Symbol(domain.parameter)
    x0, L = parse(domain.start), parse(domain.end)
    if sp.simplify(x0) != 0:
        raise ModelError("por ahora el dominio del cuerpo debe empezar en 0")

    sol = BeamSolution(body_id=body.id, mode=body.analysis.mode)
    trace, eqs = sol.trace, sol.equations
    loading = assemble(body)

    # ---------------------------------------------------------------- etapa A
    trace.add(
        "canonical",
        "Densidad de carga canonica",
        loading.q_transverse,
        lhs="q(x)",
        kind="algebra",
        detail=(
            "Cargas puntuales, distribuidas y pares quedan escritos como una unica "
            "densidad usando funciones de singularidad. A partir de aca no hay casos "
            "especiales: todo se integra igual."
        ),
    )
    eqs.add(
        f"{body.id}:q",
        "Densidad de carga",
        loading.q_transverse,
        lhs="q(x)",
        role="field",
    )

    for load_id, q_i in loading.by_load.items():
        R_i = resultant(q_i, x, L)
        detail = f"Resultante de la carga {load_id}."
        if sp.simplify(R_i) != 0:
            detail += f" Punto de aplicacion: {sp.latex(centroid(q_i, x, L))}."
        trace.add(
            f"resultant:{load_id}",
            f"Resultante de {load_id}",
            R_i,
            lhs=f"R_{{{load_id}}}",
            kind="integrate",
            detail=detail,
        )

    # ---------------------------------------------------------------- etapa B
    unknowns: list[sp.Symbol] = []
    q_react = sp.S.Zero
    for s in supports:
        if s.type not in _TRANSVERSE_RESTRAINT:
            continue
        at = parse(s.at)
        R = symbol(f"R_{s.id}")
        q_react += sg.point_term(R, x, at)
        unknowns.append(R)
        if s.type == "fixed":
            Mr = symbol(f"M_{s.id}")
            q_react += sg.couple_term(Mr, x, at)
            unknowns.append(Mr)

    if len(unknowns) != 2:
        raise ModelError(
            f"el cuerpo {body.id!r} tiene {len(unknowns)} incognitas de reaccion en el "
            "plano transversal; esta version resuelve solo sistemas isostaticos "
            "(exactamente 2). Revisa los apoyos."
        )

    q_total = sp.expand(loading.q_transverse + q_react)

    sum_f = resultant(q_total, x, L)
    sum_m = moment_about_origin(q_total, x, L)
    eq_f = sp.Eq(sum_f, 0)
    eq_m = sp.Eq(sum_m, 0)

    eqs.add(f"{body.id}:sumF", "Equilibrio de fuerzas", eq_f, role="equilibrium",
            detail="Suma de fuerzas transversales igual a cero.")
    eqs.add(f"{body.id}:sumM", "Equilibrio de momentos", eq_m, role="equilibrium",
            detail="Suma de momentos respecto del origen del dominio igual a cero.")
    trace.add("sumF", "Equilibrio de fuerzas", eq_f, kind="algebra")
    trace.add("sumM", "Equilibrio de momentos respecto del origen", eq_m, kind="algebra")

    solution = sp.solve([eq_f, eq_m], unknowns, dict=True)
    if not solution:
        raise ModelError(
            "el sistema de equilibrio no tiene solucion: la configuracion de apoyos "
            "es inestable o esta mal planteada"
        )
    reactions = {str(k): sp.simplify(v) for k, v in solution[0].items()}
    sol.reactions = reactions

    for name, value in reactions.items():
        trace.add(f"reaction:{name}", f"Reaccion {name}", value, lhs=name, kind="solve")
        eqs.add(f"{body.id}:{name}", f"Reaccion {name}", value, lhs=name, role="result")

    subs = {sp.Symbol(k): v for k, v in reactions.items()}
    q_solved = sp.expand(q_total.subs(subs))
    sol.functions["q"] = q_solved

    # ---------------------------------------------------------------- etapa C
    V = sg.antiderivative(q_solved, x)
    M = sg.antiderivative(V, x)
    sol.functions["V"] = V
    sol.functions["M"] = M

    trace.add("shear", "Cortante por integracion de la carga", V, lhs="V(x)",
              kind="integrate", detail="V(x) = int_0^x q(s) ds, sin constante: se integra "
                                       "desde la izquierda de todas las cargas.")
    trace.add("moment", "Momento flector por integracion del cortante", M, lhs="M(x)",
              kind="integrate", detail="M(x) = int_0^x V(s) ds.")
    eqs.add(f"{body.id}:V", "Cortante", V, lhs="V(x)", role="field")
    eqs.add(f"{body.id}:M", "Momento flector", M, lhs="M(x)", role="field")

    res_v = sp.simplify(sg.activate(V, x, L))
    res_m = sp.simplify(sg.activate(M, x, L))
    sol.residuals = {"V_end": res_v, "M_end": res_m}
    trace.add(
        "check", "Verificacion en el extremo libre",
        f"V(L) = {sp.latex(res_v)}, \\quad M(L) = {sp.latex(res_m)}",
        kind="check",
        detail="Ambos deben anularse si las reacciones son correctas.",
    )
    if res_v != 0 or res_m != 0:
        sol.notes.append(
            f"Residuo no nulo en el extremo (V={res_v}, M={res_m}): revisar el modelo."
        )

    _solve_axial(body, supports, loading, sol, x, L)

    if body.analysis.mode == "deformable":
        _solve_deflection(body, supports, loading, sol, x, L)

    return sol


def _solve_axial(body, supports, loading, sol, x, L) -> None:
    """Fuerza axial, y alargamiento incluyendo dilatacion termica."""
    eps_T = loading.thermal.eps if loading.thermal else sp.S.Zero
    if sp.simplify(loading.q_axial) == 0 and sp.simplify(eps_T) == 0:
        return

    restraints = [s for s in supports if s.type in _AXIAL_RESTRAINT]
    if len(restraints) > 1:
        sol.notes.append(
            "El cuerpo esta restringido axialmente en mas de un punto: el problema axial "
            "es hiperestatico y esta version no lo resuelve. Se omite N(x) y el alargamiento."
        )
        return
    if not restraints and sp.simplify(loading.q_axial) != 0:
        sol.notes.append("Hay carga axial sin ningun apoyo que la equilibre.")
        return

    q_axial = loading.q_axial
    if restraints:
        s = restraints[0]
        H = symbol(f"H_{s.id}")
        q_axial = sp.expand(q_axial + sg.point_term(H, x, parse(s.at)))
        value = sp.solve(sp.Eq(resultant(q_axial, x, L), 0), H, dict=True)
        if value:
            H_val = sp.simplify(value[0][H])
            sol.reactions[str(H)] = H_val
            q_axial = sp.expand(q_axial.subs({H: H_val}))
            sol.trace.add(f"reaction:{H}", f"Reaccion axial {H}", H_val, lhs=str(H),
                          kind="solve")
            sol.equations.add(f"{body.id}:{H}", f"Reaccion axial {H}", H_val, lhs=str(H),
                              role="result")

    N = sp.expand(-sg.antiderivative(q_axial, x))
    sol.functions["N"] = N
    sol.trace.add("axial", "Fuerza axial interna", N, lhs="N(x)", kind="integrate",
                  detail="dN/dx = -q_axial(x).")
    sol.equations.add(f"{body.id}:N", "Fuerza axial", N, lhs="N(x)", role="field")

    E, A = body.constitutive.E, body.constitutive.A
    if E and A:
        integrand = N / (parse(E) * parse(A)) + eps_T
    elif sp.simplify(eps_T) != 0:
        integrand = eps_T
        sol.notes.append("Sin E y A definidos, el alargamiento incluye solo el aporte termico.")
    else:
        return

    delta = sp.simplify(sg.activate(sg.antiderivative(integrand, x), x, L))
    sol.scalars["elongation"] = delta
    sol.trace.add("elongation", "Alargamiento total", delta, lhs=r"\delta",
                  kind="integrate",
                  detail="delta = int_0^L (N/(EA) + alpha*(T_media - T_ref)) dx.")
    sol.equations.add(f"{body.id}:delta", "Alargamiento", delta, lhs=r"\delta", role="result")


def _solve_deflection(body, supports, loading, sol, x, L) -> None:
    """Pendiente y deflexion, con el aporte de curvatura termica."""
    E, I = body.constitutive.E, body.constitutive.I
    if not (E and I):
        raise ModelError(
            f"el cuerpo {body.id!r} esta en modo deformable pero no define E e I"
        )
    EI = parse(E) * parse(I)
    kappa_T = loading.thermal.kappa if loading.thermal else sp.S.Zero

    curvature = sp.expand(sol.functions["M"] / EI + kappa_T)
    sol.functions["curvature"] = curvature
    detail = "y'' = M(x)/(E I)"
    if sp.simplify(kappa_T) != 0:
        detail += " + kappa_T(x), con kappa_T = alpha (T_inf - T_sup)/h"
    sol.trace.add("curvature", "Ecuacion de la elastica", curvature, lhs="y''(x)",
                  kind="algebra", detail=detail + ".")
    sol.equations.add(f"{body.id}:curvature", "Curvatura", curvature, lhs="y''(x)",
                      role="field")

    C1, C2 = symbol("C1"), symbol("C2")
    theta0 = sg.antiderivative(curvature, x)
    theta = sp.expand(theta0 + C1)
    y0 = sg.antiderivative(theta0, x)
    y = sp.expand(y0 + C1 * x + C2)

    sol.trace.add("slope-raw", "Pendiente (primera integracion)", theta, lhs=r"\theta(x)",
                  kind="integrate")
    sol.trace.add("defl-raw", "Deflexion (segunda integracion)", y, lhs="y(x)",
                  kind="integrate")

    bcs: list[sp.Eq] = []
    for s in supports:
        at = parse(s.at)
        if s.type in _TRANSVERSE_RESTRAINT:
            bcs.append(sp.Eq(sg.evaluate_at(y, x, at), 0))
        if s.type == "fixed":
            bcs.append(sp.Eq(sg.evaluate_at(theta, x, at), 0))

    if len(bcs) != 2:
        raise ModelError(
            f"se necesitan exactamente 2 condiciones de borde de desplazamiento, "
            f"hay {len(bcs)}"
        )
    for i, bc in enumerate(bcs):
        sol.equations.add(f"{body.id}:bc{i}", f"Condicion de borde {i + 1}", bc,
                          role="equilibrium")
        sol.trace.add(f"bc{i}", f"Condicion de borde {i + 1}", bc, kind="algebra")

    consts = sp.solve(bcs, [C1, C2], dict=True)
    if not consts:
        raise ModelError("no se pudieron determinar las constantes de integracion")
    csubs = consts[0]

    theta = sp.expand(theta.subs(csubs))
    y = sp.expand(y.subs(csubs))
    sol.functions["theta"] = theta
    sol.functions["y"] = y

    sol.trace.add("constants", "Constantes de integracion",
                  ", \\quad ".join(f"{sp.latex(k)} = {sp.latex(sp.simplify(v))}"
                                   for k, v in csubs.items()),
                  kind="solve")
    sol.trace.add("slope", "Pendiente", theta, lhs=r"\theta(x)", kind="solve")
    sol.trace.add("deflection", "Deflexion", y, lhs="y(x)", kind="solve")
    sol.equations.add(f"{body.id}:theta", "Pendiente", theta, lhs=r"\theta(x)", role="field")
    sol.equations.add(f"{body.id}:y", "Deflexion", y, lhs="y(x)", role="field")
