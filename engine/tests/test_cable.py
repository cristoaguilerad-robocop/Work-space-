"""Cables flexibles contra los resultados de manual."""

import sympy as sp
import pytest

from wf_core import singularity as sg
from wf_core.model import (
    Analysis, Body, CableSpec, Domain1D, FullRegion, IntervalRegion, MechanicalLoad,
    PointDistribution, PointRegion, StructuralSupport, UniformDistribution,
)
from wf_statics import solve_cable
from wf_statics.cable import ModelError

x, L, w0, f, P, H0, hB = sp.symbols("x L w0 f P H0 hB")

DOWN = {"frame": "global", "vector": ("0", "-1", "0")}


def cable(fields, spec=None):
    return Body(
        id="c1", type="cable",
        domain=Domain1D(parameter="x", start="0", end="L"),
        fields=list(fields),
        analysis=Analysis(dof="cable"),
        cable=spec if spec is not None else CableSpec(sag="f", at="L/2"),
    )


def ends(left_elevation="0", right_elevation="0"):
    return [
        StructuralSupport(id="A", body_id="c1", at="0", type="pin",
                          elevation=left_elevation),
        StructuralSupport(id="B", body_id="c1", at="L", type="pin",
                          elevation=right_elevation),
    ]


def eq(a, b):
    return sp.simplify(sp.expand(a - b)) == 0


def load(load_id, region, distribution):
    return MechanicalLoad(id=load_id, region=region, distribution=distribution,
                          direction=DOWN)


def test_uniform_cable_horizontal_tension():
    """El resultado clasico: H = w0 L^2 / (8 f)."""
    sol = solve_cable(cable([load("q1", FullRegion(), UniformDistribution(w="w0"))]), ends())
    assert eq(sol.scalars["H"], w0 * L**2 / (8 * f))


def test_uniform_cable_passes_through_the_sag():
    """La flecha impuesta tiene que cumplirse exactamente."""
    sol = solve_cable(cable([load("q1", FullRegion(), UniformDistribution(w="w0"))]), ends())
    assert eq(sg.evaluate_at(sol.functions["y"], x, L / 2), -f)


def test_uniform_cable_end_tensions():
    """T = sqrt(H^2 + (w0 L / 2)^2), igual en los dos apoyos por simetria."""
    sol = solve_cable(cable([load("q1", FullRegion(), UniformDistribution(w="w0"))]), ends())
    H = w0 * L**2 / (8 * f)
    expected = sp.sqrt(H**2 + (w0 * L / 2) ** 2)
    assert eq(sp.simplify(sol.scalars["T_A"] ** 2), sp.simplify(expected**2))
    assert eq(sp.simplify(sol.scalars["T_B"] ** 2), sp.simplify(expected**2))


def test_uniform_cable_length_expansion():
    """Para flecha chica, s -> L (1 + 8 f^2 / (3 L^2)).

    El desarrollo se hace con simbolos positivos: sin esa suposicion SymPy no
    puede reducir sqrt(L**4) a L**2 y la comparacion nunca cierra.
    """
    sol = solve_cable(cable([load("q1", FullRegion(), UniformDistribution(w="w0"))]), ends())
    span = sp.Symbol("Lp", positive=True)
    ratio = sp.Symbol("r", positive=True)  # r = f / L
    length = sol.scalars["length"].subs({L: span}).subs({f: ratio * span})
    series = sp.series(length.rewrite(sp.log), ratio, 0, 3).removeO()
    assert eq(sp.simplify(series - (span + 8 * ratio**2 * span / 3)), 0)


def test_point_load_cable():
    """Carga puntual centrada: H = P L / (4 f), y el cable queda en dos rectas."""
    sol = solve_cable(
        cable([load("P1", PointRegion(at="L/2"), PointDistribution(magnitude="P"))]),
        ends(),
    )
    assert eq(sol.scalars["H"], P * L / (4 * f))
    assert eq(sg.evaluate_at(sol.functions["y"], x, L / 2), -f)
    # En cada tramo la pendiente es constante: +-2f/L.
    assert eq(sg.evaluate_at(sol.functions["slope"], x, L / 4), -2 * f / L)
    assert eq(sg.evaluate_at(sol.functions["slope"], x, 3 * L / 4), 2 * f / L)


def test_point_load_cable_reports_the_kink():
    """Con un quiebre interior no hay una sola integral cerrada para la longitud."""
    sol = solve_cable(
        cable([load("P1", PointRegion(at="L/2"), PointDistribution(magnitude="P"))]),
        ends(),
    )
    assert "length" not in sol.scalars
    assert any("quiebre" in note for note in sol.notes)


def test_supports_at_different_heights():
    """Con apoyos desnivelados el cable pasa por las dos cotas."""
    sol = solve_cable(
        cable([load("q1", FullRegion(), UniformDistribution(w="w0"))]),
        ends(right_elevation="hB"),
    )
    assert eq(sg.evaluate_at(sol.functions["y"], x, sp.Integer(0)), 0)
    assert eq(sg.activate(sol.functions["y"], x, L), hB)


def test_sag_is_measured_from_the_chord():
    """Con apoyos desnivelados, la flecha se mide desde la cuerda."""
    sol = solve_cable(
        cable([load("q1", FullRegion(), UniformDistribution(w="w0"))]),
        ends(right_elevation="hB"),
    )
    chord_mid = hB / 2
    assert eq(chord_mid - sg.evaluate_at(sol.functions["y"], x, L / 2), f)
    # La tension horizontal no depende del desnivel en una carga uniforme.
    assert eq(sol.scalars["H"], w0 * L**2 / (8 * f))


def test_given_tension_mode():
    """Si se da H, la flecha sale como consecuencia."""
    sol = solve_cable(
        cable([load("q1", FullRegion(), UniformDistribution(w="w0"))],
              spec=CableSpec(mode="tension", H="H0")),
        ends(),
    )
    assert eq(sol.scalars["H"], H0)
    assert eq(sg.evaluate_at(sol.functions["y"], x, L / 2), -w0 * L**2 / (8 * H0))


def test_partial_load_still_works():
    """Carga sobre medio vano: sigue habiendo solucion, sin longitud cerrada."""
    sol = solve_cable(
        cable([load("q1", IntervalRegion(start="0", end="L/2"),
                    UniformDistribution(w="w0"))]),
        ends(),
    )
    assert eq(sg.evaluate_at(sol.functions["y"], x, L / 2), -f)
    assert sp.simplify(sol.scalars["H"]) != 0


def test_missing_cable_spec_is_reported():
    body = cable([load("q1", FullRegion(), UniformDistribution(w="w0"))])
    body.cable = None
    with pytest.raises(ModelError, match="como se cierra"):
        solve_cable(body, ends())


def test_wrong_support_count_is_reported():
    with pytest.raises(ModelError, match="2 apoyos"):
        solve_cable(cable([load("q1", FullRegion(), UniformDistribution(w="w0"))]),
                    ends()[:1])
