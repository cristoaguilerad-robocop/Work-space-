"""Electromagnetismo: linea cargada y conductor recto.

El test que mas cubre es el cruzado: la forma cerrada que encuentra SymPy tiene
que coincidir con la cuadratura numerica del integrando que se le manda al
cliente. Si esos dos se separan, la pagina muestra un numero que no es el de la
formula que tiene arriba.
"""

import math

import sympy as sp
import pytest

from wf_core.model import (
    Body, Constitutive, Domain1D, FullRegion, IntervalRegion, LinearDistribution,
    PointDistribution, PointRegion, Probe, ScalarSource, UniformDistribution,
)
from wf_em import K_E, K_M, PX, PY, PZ, ModelError, solve_line

x, L, lam0, q0, I0, d = sp.symbols("x L lam0 q0 I0 d")

VALUES = {L: 2.0, lam0: 3e-9, q0: 5e-9, I0: 4.0, K_E: 8.9875517923e9, K_M: 1e-7}


def line(fields, body_id="l1", kind="charged_line"):
    return Body(id=body_id, type=kind, domain=Domain1D(parameter="x", start="0", end="L"),
                fields=list(fields), constitutive=Constitutive())


def charge(source_id, region, distribution):
    return ScalarSource(id=source_id, quantity="charge_density",
                        region=region, distribution=distribution, units="C/m")


def current(source_id, region, distribution):
    return ScalarSource(id=source_id, quantity="current",
                        region=region, distribution=distribution, units="A")


def numeric(expr, probe, extra=None):
    """Evalua una expresion en un punto de observacion, con valores concretos."""
    subs = dict(VALUES)
    subs.update({PX: probe[0], PY: probe[1], PZ: probe[2]})
    if extra:
        subs.update(extra)
    return float(sp.sympify(expr).subs(subs).evalf())


def quadrature(setup, probe, steps=400):
    """Simpson por tramos sobre los integrandos, igual que hace el cliente."""
    subs = dict(VALUES)
    subs.update({PX: probe[0], PY: probe[1], PZ: probe[2]})
    total = float(sp.sympify(setup.discrete).subs(subs).evalf()) if setup.discrete != 0 else 0.0

    for part in setup.parts:
        start = float(sp.sympify(part.start).subs(subs).evalf())
        end = float(sp.sympify(part.end).subs(subs).evalf())
        f = sp.lambdify(x, sp.sympify(part.integrand).subs(subs), "math")
        h = (end - start) / steps
        acc = f(start) + f(end)
        for i in range(1, steps):
            acc += f(start + i * h) * (4 if i % 2 else 2)
        total += acc * h / 3
    return total


# ---------------------------------------------------------------- fuente

def test_uniform_line_total_and_centroid():
    sol = solve_line(line([charge("lam", FullRegion(), UniformDistribution(w="lam0"))]), [])
    assert sp.simplify(sol.scalars["total"] - lam0 * L) == 0
    assert sp.simplify(sol.scalars["centroid"] - L / 2) == 0


def test_triangular_line_centroid():
    """Densidad 0 -> lam0: el centroide de carga esta en 2L/3."""
    sol = solve_line(line([charge("lam", FullRegion(),
                                  LinearDistribution(w_start="0", w_end="lam0"))]), [])
    assert sp.simplify(sol.scalars["total"] - lam0 * L / 2) == 0
    assert sp.simplify(sol.scalars["centroid"] - 2 * L / 3) == 0


def test_point_charges_are_the_same_machinery():
    sol = solve_line(line([
        charge("q1", PointRegion(at="0"), PointDistribution(magnitude="q0")),
        charge("q2", PointRegion(at="L"), PointDistribution(magnitude="q0")),
    ]), [])
    assert sp.simplify(sol.scalars["total"] - 2 * q0) == 0
    assert sp.simplify(sol.scalars["centroid"] - L / 2) == 0


# ---------------------------------------------------------------- campos

def test_point_charge_potential_is_exact_coulomb():
    """Una carga puntual no se integra: sale de Coulomb directo."""
    sol = solve_line(line([charge("q1", PointRegion(at="0"),
                                  PointDistribution(magnitude="q0"))]), [])
    probe = (0.0, 0.5, 0.0)
    got = numeric(sol.setups["V"].discrete, probe)
    want = VALUES[K_E] * VALUES[q0] / 0.5
    assert math.isclose(got, want, rel_tol=1e-12)


def test_uniform_line_closed_form_matches_quadrature():
    """La forma cerrada y la cuadratura del integrando deben coincidir."""
    sol = solve_line(line([charge("lam", FullRegion(), UniformDistribution(w="lam0"))]), [])
    closed = sol.setups["V"].closed_form
    assert closed is not None, "SymPy deberia resolver el caso uniforme"
    for probe in [(1.0, 0.5, 0.0), (0.2, 1.5, 0.0), (3.0, 0.8, 0.0), (1.0, 0.4, 0.3)]:
        assert math.isclose(numeric(closed, probe),
                            quadrature(sol.setups["V"], probe),
                            rel_tol=1e-6), probe


def test_field_components_match_quadrature():
    sol = solve_line(line([charge("lam", FullRegion(),
                                  LinearDistribution(w_start="0", w_end="lam0"))]), [])
    for component in ("Ex", "Ey"):
        setup = sol.setups[component]
        if setup.closed_form is None:
            continue
        for probe in [(1.0, 0.6, 0.0), (2.5, 1.0, 0.0)]:
            assert math.isclose(numeric(setup.closed_form, probe),
                                quadrature(setup, probe),
                                rel_tol=1e-6), (component, probe)


def test_partial_segment_only_integrates_its_tramo():
    """Una densidad sobre [0, L/2] no debe aportar campo desde el resto."""
    sol = solve_line(line([charge("lam", IntervalRegion(start="0", end="L/2"),
                                  UniformDistribution(w="lam0"))]), [])
    probe = (1.0, 0.5, 0.0)
    closed = sol.setups["V"].closed_form
    assert closed is not None
    assert math.isclose(numeric(closed, probe),
                        quadrature(sol.setups["V"], probe), rel_tol=1e-6)


def test_infinite_wire_limit():
    """Biot-Savart en el centro de un hilo muy largo tiende a 2 k_m I / r."""
    sol = solve_line(line([current("I1", FullRegion(), UniformDistribution(w="I0"))],
                          body_id="w1", kind="wire"), [])
    Bz = sol.setups["Bz"].closed_form
    assert Bz is not None
    centred = sp.simplify(Bz.subs({PX: L / 2, PZ: 0}))
    assert sp.simplify(sp.limit(centred, L, sp.oo) - 2 * K_M * I0 / PY) == 0


def test_custom_density_still_produces_an_integrand():
    """Sin forma cerrada el motor no falla: deja el planteo y el integrando."""
    sol = solve_line(line([charge("lam", FullRegion(),
                                  {"type": "expression", "expr": "lam0*exp(-x/L)"})]), [])
    assert sol.setups["V"].parts
    probe = (1.0, 0.7, 0.0)
    assert math.isfinite(quadrature(sol.setups["V"], probe))


# ---------------------------------------------------------------- diagnostico

def test_charge_and_current_together_is_reported():
    with pytest.raises(ModelError, match="carga o corriente"):
        solve_line(line([
            charge("lam", FullRegion(), UniformDistribution(w="lam0")),
            current("I1", FullRegion(), UniformDistribution(w="I0")),
        ]), [])


def test_empty_body_is_reported():
    with pytest.raises(ModelError, match="carga o corriente"):
        solve_line(line([]), [])
