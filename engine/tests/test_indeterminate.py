"""Vigas hiperestaticas resueltas por compatibilidad.

El equilibrio deja incognitas sin determinar y las que faltan son las mismas
condiciones de desplazamiento que ya cierran un isostatico. No hay dos teorias:
hay una sola lista de condiciones y a veces sobran.
"""

import sympy as sp
import pytest

from wf_core import singularity as sg
from wf_core.model import (
    Analysis, Body, Constitutive, Domain1D, FullRegion, MechanicalLoad,
    PointDistribution, PointRegion, StructuralSupport, UniformDistribution,
)
from wf_statics import ModelError, solve_beam

x, L, w0, P, E, I = sp.symbols("x L w0 P E I")
DOWN = {"frame": "global", "vector": ("0", "-1", "0")}
DEFORMABLE = Constitutive(E="E", I="I")


def beam(fields, mode="deformable", const=None):
    return Body(
        id="b1",
        domain=Domain1D(parameter="x", start="0", end="L"),
        fields=list(fields),
        constitutive=const if const is not None else DEFORMABLE,
        analysis=Analysis(mode=mode),
    )


def support(support_id, at, kind):
    return StructuralSupport(id=support_id, body_id="b1", at=at, type=kind)


def uniform():
    return [MechanicalLoad(id="q1", region=FullRegion(),
                           distribution=UniformDistribution(w="w0"), direction=DOWN)]


def eq(a, b):
    return sp.simplify(sp.expand(a - b)) == 0


def test_propped_cantilever():
    """Empotrada-apoyada con carga uniforme: R_B = 3 w0 L / 8, M_A = w0 L^2 / 8."""
    sol = solve_beam(beam(uniform()),
                     [support("A", "0", "fixed"), support("B", "L", "roller")])
    assert eq(sol.reactions["R_A"], 5 * w0 * L / 8)
    assert eq(sol.reactions["R_B"], 3 * w0 * L / 8)
    assert eq(sol.reactions["M_A"], w0 * L**2 / 8)
    assert sol.residuals["V_end"] == 0 and sol.residuals["M_end"] == 0


def test_propped_cantilever_satisfies_its_own_boundary_conditions():
    sol = solve_beam(beam(uniform()),
                     [support("A", "0", "fixed"), support("B", "L", "roller")])
    y, theta = sol.functions["y"], sol.functions["theta"]
    assert eq(sg.evaluate_at(y, x, sp.Integer(0)), 0)
    assert eq(sg.evaluate_at(theta, x, sp.Integer(0)), 0)
    assert eq(sg.evaluate_at(y, x, L), 0)


def test_fixed_fixed_beam():
    """Biempotrada con carga uniforme: momentos de empotramiento w0 L^2 / 12."""
    sol = solve_beam(beam(uniform()),
                     [support("A", "0", "fixed"), support("B", "L", "fixed")])
    assert eq(sol.reactions["R_A"], w0 * L / 2)
    assert eq(sol.reactions["R_B"], w0 * L / 2)
    assert eq(sol.reactions["M_A"], w0 * L**2 / 12)
    assert eq(sol.reactions["M_B"], -w0 * L**2 / 12)
    # Flecha en el centro: w0 L^4 / (384 E I), la cuarta parte de la biapoyada.
    assert eq(sg.evaluate_at(sol.functions["y"], x, L / 2), -w0 * L**4 / (384 * E * I))


def test_fixed_fixed_point_load():
    """Biempotrada con puntual centrada: M = P L / 8 y flecha P L^3 / (192 E I)."""
    sol = solve_beam(
        beam([MechanicalLoad(id="P1", region=PointRegion(at="L/2"),
                             distribution=PointDistribution(magnitude="P"), direction=DOWN)]),
        [support("A", "0", "fixed"), support("B", "L", "fixed")],
    )
    assert eq(sol.reactions["R_A"], P / 2)
    assert eq(sol.reactions["M_A"], P * L / 8)
    assert eq(sg.evaluate_at(sol.functions["y"], x, L / 2), -P * L**3 / (192 * E * I))


def test_continuous_beam_over_three_supports():
    """Dos vanos iguales: el apoyo central toma 5/8 de la carga total."""
    sol = solve_beam(
        beam(uniform()),
        [support("A", "0", "roller"), support("B", "L/2", "roller"),
         support("C", "L", "roller")],
    )
    assert eq(sol.reactions["R_B"], 5 * w0 * L / 8)
    assert eq(sol.reactions["R_A"], 3 * w0 * L / 16)
    assert eq(sol.reactions["R_C"], 3 * w0 * L / 16)
    # El cuerpo apoya en los tres puntos.
    for at in (sp.Integer(0), L / 2):
        assert eq(sg.evaluate_at(sol.functions["y"], x, at), 0)
    assert eq(sg.activate(sol.functions["y"], x, L), 0)
    assert sol.residuals["V_end"] == 0 and sol.residuals["M_end"] == 0


def test_indeterminate_reports_its_degree():
    sol = solve_beam(beam(uniform()),
                     [support("A", "0", "fixed"), support("B", "L", "roller")])
    assert any("grado 1" in note for note in sol.notes)


def test_indeterminate_in_rigid_mode_is_reported():
    """En modo rigido no hay compatibilidad que invocar: hay que decirlo."""
    with pytest.raises(ModelError, match="modo deformable"):
        solve_beam(beam(uniform(), mode="rigid", const=Constitutive()),
                   [support("A", "0", "fixed"), support("B", "L", "roller")])


def test_indeterminate_without_stiffness_is_reported():
    """En un hiperestatico la rigidez decide el reparto: sin E e I no hay respuesta."""
    with pytest.raises(ModelError, match="E e I"):
        solve_beam(beam(uniform(), const=Constitutive()),
                   [support("A", "0", "fixed"), support("B", "L", "roller")])


def test_mechanism_is_reported():
    """Un solo apoyo movil no sostiene nada."""
    with pytest.raises(ModelError, match="mecanismo"):
        solve_beam(beam(uniform()), [support("A", "0", "roller")])
