"""Conduccion estacionaria 1D contra soluciones cerradas conocidas."""

import sympy as sp
import pytest

from wf_core import singularity as sg
from wf_core.model import (
    Body, BoundaryCondition, Constitutive, Domain1D, FullRegion, PointRegion,
    PointDistribution, ScalarSource, UniformDistribution,
)
from wf_thermo import ModelError, solve_bar

x, L, k, A, T1, T2, T_inf, g0, h, Q0 = sp.symbols("x L k A T1 T2 T_inf g0 h Q0")


def bar(sources=(), const=None):
    return Body(
        id="b1", type="bar",
        domain=Domain1D(parameter="x", start="0", end="L"),
        fields=list(sources),
        constitutive=const or Constitutive(k="k", A="A"),
    )


def bc(bc_id, at, kind, value=None, film=None):
    return BoundaryCondition(id=bc_id, body_id="b1", at=at, type=kind, value=value, h=film)


def eq(a, b):
    return sp.simplify(sp.expand(a - b)) == 0


def eq_on_domain(expr, expected, points=(sp.Rational(1, 4), sp.Rational(1, 2), sp.Rational(3, 4))):
    """Compara dos expresiones evaluandolas dentro del dominio.

    La solucion sale escrita en funciones de singularidad, que son correctas
    pero no se simplifican contra la forma polinomica del manual. Evaluar en
    varios puntos interiores compara lo que importa: el valor del campo.
    """
    for fraction in points:
        at = fraction * L
        got = sg.evaluate_at(expr, x, at)
        want = sp.simplify(expected.subs(x, at))
        if sp.simplify(got - want) != 0:
            return False
    return True


def heat(source_id, region, distribution):
    return ScalarSource(id=source_id, quantity="heat_source",
                        region=region, distribution=distribution, units="W/m")


def test_flat_wall_is_linear():
    """Sin generacion, el perfil es lineal y el flujo constante."""
    sol = solve_bar(bar(), [bc("I", "0", "temperature", "T1"),
                            bc("D", "L", "temperature", "T2")])
    assert eq(sol.functions["T"], T1 + (T2 - T1) * x / L)
    assert eq(sol.functions["Q"], k * A * (T1 - T2) / L)
    assert sol.residuals["balance"] == 0


def test_uniform_generation_is_parabolic():
    """Generacion uniforme con ambos extremos a T1: T_max = T1 + g0 L^2 / (8 k A)."""
    sol = solve_bar(
        bar([heat("g1", FullRegion(), UniformDistribution(w="g0"))]),
        [bc("I", "0", "temperature", "T1"), bc("D", "L", "temperature", "T1")],
    )
    assert eq_on_domain(sol.functions["T"], T1 + g0 * x * (L - x) / (2 * k * A))
    assert eq(sg.evaluate_at(sol.functions["T"], x, L / 2), T1 + g0 * L**2 / (8 * k * A))
    assert eq(sol.scalars["generated"], g0 * L)
    assert sol.residuals["balance"] == 0


def test_insulated_end_pushes_all_heat_the_other_way():
    sol = solve_bar(
        bar([heat("g1", FullRegion(), UniformDistribution(w="g0"))]),
        [bc("I", "0", "insulated"), bc("D", "L", "temperature", "T2")],
    )
    assert eq(sg.activate(sol.functions["Q"], x, L), g0 * L)
    assert eq(sg.evaluate_at(sol.functions["T"], x, sp.Integer(0)),
              T2 + g0 * L**2 / (2 * k * A))
    assert sol.residuals["balance"] == 0


def test_convection_end_behaves_like_series_resistances():
    """Conduccion y conveccion en serie: Q = A (T1 - T_inf) / (L/k + 1/h)."""
    sol = solve_bar(bar(), [bc("I", "0", "temperature", "T1"),
                            bc("D", "L", "convection", "T_inf", film="h")])
    assert eq(sol.functions["Q"], A * (T1 - T_inf) / (L / k + 1 / h))
    assert sol.residuals["balance"] == 0


def test_concentrated_source_is_not_a_special_case():
    """Una fuente puntual sale de la misma integral que una distribuida."""
    sol = solve_bar(
        bar([heat("Q1", PointRegion(at="L/2"), PointDistribution(magnitude="Q0"))]),
        [bc("I", "0", "temperature", "T1"), bc("D", "L", "temperature", "T1")],
    )
    assert eq(sol.scalars["generated"], Q0)
    # Simetrico: la mitad sale por cada extremo.
    assert eq(sg.evaluate_at(sol.functions["Q"], x, sp.Integer(0)), -Q0 / 2)
    assert eq(sg.activate(sol.functions["Q"], x, L), Q0 / 2)
    # Pico de temperatura bajo la fuente.
    assert eq(sg.evaluate_at(sol.functions["T"], x, L / 2), T1 + Q0 * L / (4 * k * A))


def test_two_insulated_ends_with_generation_is_reported():
    """No hay estado estacionario si se genera calor y no puede salir."""
    with pytest.raises((ModelError, Exception)):
        solve_bar(
            bar([heat("g1", FullRegion(), UniformDistribution(w="g0"))]),
            [bc("I", "0", "insulated"), bc("D", "L", "insulated")],
        )


def test_wrong_number_of_boundaries_is_reported():
    with pytest.raises(ModelError, match="exactamente 2"):
        solve_bar(bar(), [bc("I", "0", "temperature", "T1")])


def test_missing_conductivity_is_reported():
    with pytest.raises(ModelError, match="conductividad"):
        solve_bar(bar(const=Constitutive(A="A")),
                  [bc("I", "0", "temperature", "T1"), bc("D", "L", "temperature", "T2")])
