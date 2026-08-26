"""Casos con solucion cerrada conocida.

Si un cambio en el motor rompe uno de estos, rompio la fisica, no el estilo.
"""

import sympy as sp
import pytest

from wf_core import singularity as sg
from wf_core.canonical import assemble, centroid, resultant
from wf_core.model import (
    Analysis, Body, Constitutive, Domain1D, FullRegion, IntervalRegion,
    LinearDistribution, MechanicalLoad, PointDistribution, PointRegion,
    StructuralSupport, ThermalField, ThermalProfileLinear, ThermalProfileUniform,
    UniformDistribution,
)
from wf_statics import ModelError, solve_beam

x, L, w0, P, E, I, A, alpha, h, dT, M0 = sp.symbols("x L w0 P E I A alpha h dT M0")

DOWN = {"frame": "global", "vector": ("0", "-1", "0")}


def beam(fields, *, mode="rigid", const=None, name="b1"):
    return Body(
        id=name,
        domain=Domain1D(parameter="x", start="0", end="L"),
        fields=fields,
        constitutive=const or Constitutive(),
        analysis=Analysis(mode=mode),
    )


def simply_supported():
    return [
        StructuralSupport(id="A", body_id="b1", at="0", type="pin"),
        StructuralSupport(id="B", body_id="b1", at="L", type="roller"),
    ]


def cantilever():
    return [StructuralSupport(id="A", body_id="b1", at="0", type="fixed")]


def eq(a, b):
    return sp.simplify(sp.expand(a - b)) == 0


# ---------------------------------------------------------------- resultantes

def test_uniform_resultant_and_centroid():
    body = beam([MechanicalLoad(id="q1", region=FullRegion(),
                                distribution=UniformDistribution(w="w0"), direction=DOWN)])
    lo = assemble(body)
    assert eq(resultant(lo.q_transverse, lo.x, L), -w0 * L)
    assert eq(centroid(lo.q_transverse, lo.x, L), L / 2)


def test_triangular_resultant_and_centroid():
    """Carga triangular creciente: R = w0 L / 2 aplicada en 2L/3."""
    body = beam([MechanicalLoad(id="q1", region=FullRegion(),
                                distribution=LinearDistribution(w_start="0", w_end="w0"),
                                direction=DOWN)])
    lo = assemble(body)
    assert eq(resultant(lo.q_transverse, lo.x, L), -w0 * L / 2)
    assert eq(centroid(lo.q_transverse, lo.x, L), 2 * L / 3)


def test_point_load_goes_through_the_same_integral():
    """Una carga puntual no es un caso especial: sale de la misma integral."""
    body = beam([MechanicalLoad(id="P1", region=PointRegion(at="3*L/4"),
                                distribution=PointDistribution(magnitude="P"),
                                direction=DOWN)])
    lo = assemble(body)
    assert eq(resultant(lo.q_transverse, lo.x, L), -P)
    assert eq(centroid(lo.q_transverse, lo.x, L), 3 * L / 4)


def test_partial_trapezoidal_resultant():
    """Trapecio w0 -> 2 w0 sobre [L/4, 3L/4]: R = 3 w0 L / 4."""
    body = beam([MechanicalLoad(id="q1", region=IntervalRegion(start="L/4", end="3*L/4"),
                                distribution=LinearDistribution(w_start="w0", w_end="2*w0"),
                                direction=DOWN)])
    lo = assemble(body)
    assert eq(resultant(lo.q_transverse, lo.x, L), -3 * w0 * L / 4)


def test_custom_expression_load():
    """Carga senoidal: R = 2 w0 L / pi."""
    body = beam([MechanicalLoad(id="q1", region=FullRegion(),
                                distribution={"type": "expression", "expr": "w0*sin(pi*x/L)"},
                                direction=DOWN)])
    lo = assemble(body)
    assert eq(sp.simplify(resultant(lo.q_transverse, lo.x, L)), -2 * w0 * L / sp.pi)


# ---------------------------------------------------------------- reacciones

def test_simply_supported_point_load_offcenter():
    body = beam([MechanicalLoad(id="P1", region=PointRegion(at="L/4"),
                                distribution=PointDistribution(magnitude="P"),
                                direction=DOWN)])
    sol = solve_beam(body, simply_supported())
    assert eq(sol.reactions["R_A"], 3 * P / 4)
    assert eq(sol.reactions["R_B"], P / 4)
    assert sol.residuals["V_end"] == 0 and sol.residuals["M_end"] == 0


def test_cantilever_uniform_reactions():
    body = beam([MechanicalLoad(id="q1", region=FullRegion(),
                                distribution=UniformDistribution(w="w0"), direction=DOWN)])
    sol = solve_beam(body, cantilever())
    assert eq(sol.reactions["R_A"], w0 * L)
    assert eq(sol.reactions["M_A"], w0 * L**2 / 2)
    # Momento flector en el empotramiento: hogging, -w0 L^2 / 2.
    assert eq(sg.evaluate_at(sol.functions["M"], x, sp.Integer(0)), -w0 * L**2 / 2)


def test_applied_couple_reactions():
    """Par M0 antihorario en el centro de una viga simplemente apoyada.

    Equilibrio de momentos respecto de A: R_B * L + M0 = 0, o sea el par se
    equilibra con una cupla de reacciones R_A hacia arriba y R_B hacia abajo.
    """
    body = beam([MechanicalLoad(id="C1", quantity="moment", region=PointRegion(at="L/2"),
                                distribution=PointDistribution(magnitude="M0"))])
    sol = solve_beam(body, simply_supported())
    assert eq(sol.reactions["R_A"], M0 / L)
    assert eq(sol.reactions["R_B"], -M0 / L)
    # El momento flector salta de +M0/2 a -M0/2 al pasar por el par.
    assert eq(sg.evaluate_at(sol.functions["M"], x, L / 4), M0 / 4)
    assert eq(sg.evaluate_at(sol.functions["M"], x, 3 * L / 4), -M0 / 4)


# ---------------------------------------------------------------- deflexiones

DEFORMABLE = Constitutive(E="E", I="I")


def test_cantilever_uniform_tip_deflection():
    """delta = w0 L^4 / (8 E I) hacia abajo."""
    body = beam([MechanicalLoad(id="q1", region=FullRegion(),
                                distribution=UniformDistribution(w="w0"), direction=DOWN)],
                mode="deformable", const=DEFORMABLE)
    sol = solve_beam(body, cantilever())
    tip = sg.evaluate_at(sol.functions["y"], x, L)
    assert eq(tip, -w0 * L**4 / (8 * E * I))


def test_cantilever_tip_point_load_deflection():
    """delta = P L^3 / (3 E I)."""
    body = beam([MechanicalLoad(id="P1", region=PointRegion(at="L"),
                                distribution=PointDistribution(magnitude="P"), direction=DOWN)],
                mode="deformable", const=DEFORMABLE)
    sol = solve_beam(body, cantilever())
    assert eq(sg.evaluate_at(sol.functions["y"], x, L), -P * L**3 / (3 * E * I))


def test_simply_supported_center_load_deflection():
    """delta_centro = P L^3 / (48 E I)."""
    body = beam([MechanicalLoad(id="P1", region=PointRegion(at="L/2"),
                                distribution=PointDistribution(magnitude="P"), direction=DOWN)],
                mode="deformable", const=DEFORMABLE)
    sol = solve_beam(body, simply_supported())
    assert eq(sg.evaluate_at(sol.functions["y"], x, L / 2), -P * L**3 / (48 * E * I))


def test_simply_supported_uniform_deflection():
    """delta_centro = 5 w0 L^4 / (384 E I)."""
    body = beam([MechanicalLoad(id="q1", region=FullRegion(),
                                distribution=UniformDistribution(w="w0"), direction=DOWN)],
                mode="deformable", const=DEFORMABLE)
    sol = solve_beam(body, simply_supported())
    assert eq(sg.evaluate_at(sol.functions["y"], x, L / 2),
              -5 * w0 * L**4 / (384 * E * I))


def test_simply_supported_triangular_deflection():
    """Carga triangular 0 -> w0: delta(L/2) = 5 w0 L^4 / (768 E I)."""
    body = beam([MechanicalLoad(id="q1", region=FullRegion(),
                                distribution=LinearDistribution(w_start="0", w_end="w0"),
                                direction=DOWN)],
                mode="deformable", const=DEFORMABLE)
    sol = solve_beam(body, simply_supported())
    assert eq(sg.evaluate_at(sol.functions["y"], x, L / 2),
              -5 * w0 * L**4 / (768 * E * I))


# ---------------------------------------------------------------- termico

def test_free_thermal_elongation():
    """Barra con un solo apoyo axial: delta = alpha * dT * L."""
    body = beam(
        [ThermalField(id="T1", T_ref="0",
                      profile=ThermalProfileUniform(T="dT"))],
        mode="rigid",
        const=Constitutive(E="E", A="A", alpha="alpha"),
    )
    sol = solve_beam(body, simply_supported())
    assert eq(sol.scalars["elongation"], alpha * dT * L)


def test_thermal_gradient_camber():
    """Gradiente con la cara superior mas caliente arquea la viga hacia arriba:
    y(L/2) = + alpha dT L^2 / (8 h)."""
    body = beam(
        [ThermalField(id="T1", T_ref="0",
                      profile=ThermalProfileLinear(T_top="dT", T_bottom="0"))],
        mode="deformable",
        const=Constitutive(E="E", I="I", A="A", alpha="alpha", h="h"),
    )
    sol = solve_beam(body, simply_supported())
    assert eq(sg.evaluate_at(sol.functions["y"], x, L / 2), alpha * dT * L**2 / (8 * h))


def test_thermal_and_mechanical_superpose():
    """El aporte termico se suma al mecanico, no lo reemplaza."""
    fields = [
        MechanicalLoad(id="q1", region=FullRegion(),
                       distribution=UniformDistribution(w="w0"), direction=DOWN),
        ThermalField(id="T1", T_ref="0",
                     profile=ThermalProfileLinear(T_top="dT", T_bottom="0")),
    ]
    const = Constitutive(E="E", I="I", A="A", alpha="alpha", h="h")
    sol = solve_beam(beam(fields, mode="deformable", const=const), simply_supported())
    mid = sg.evaluate_at(sol.functions["y"], x, L / 2)
    expected = -5 * w0 * L**4 / (384 * E * I) + alpha * dT * L**2 / (8 * h)
    assert eq(mid, expected)


# ---------------------------------------------------------------- diagnostico

def test_mechanism_is_reported_not_guessed():
    """Con menos de dos incognitas no hay estructura, hay un mecanismo."""
    body = beam([MechanicalLoad(id="q1", region=FullRegion(),
                                distribution=UniformDistribution(w="w0"), direction=DOWN)])
    with pytest.raises(ModelError, match="mecanismo"):
        solve_beam(body, [StructuralSupport(id="A", body_id="b1", at="0", type="roller")])


def test_deformable_without_material_is_reported():
    body = beam([MechanicalLoad(id="q1", region=FullRegion(),
                                distribution=UniformDistribution(w="w0"), direction=DOWN)],
                mode="deformable")
    with pytest.raises(ModelError, match="E e I"):
        solve_beam(body, simply_supported())
