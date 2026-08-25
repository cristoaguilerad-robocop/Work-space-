"""La evaluacion en el navegador debe coincidir con SymPy.

La etapa 3 grafica en el cliente sin tocar la red: si el JS generado se
desviara de SymPy, el usuario veria curvas que no corresponden a las ecuaciones
que la etapa 2 le mostro. Estos tests cierran ese hueco ejecutando el codigo
generado en Node y comparando contra SymPy punto a punto.
"""

import json
import shutil
import subprocess

import pytest
import sympy as sp

from wf_core.jsprint import JS_RUNTIME, compile_function
from wf_core.model import (
    Analysis, Body, Constitutive, Domain1D, FullRegion, IntervalRegion,
    LinearDistribution, MechanicalLoad, PointDistribution, PointRegion,
    StructuralSupport,
)
from wf_statics import solve_beam

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node no disponible")

x = sp.Symbol("x")
DOWN = {"frame": "global", "vector": ("0", "-1", "0")}
VALUES = {"L": 4.0, "w0": 1000.0, "P": 5000.0, "E": 2.0e11, "I": 8.0e-6}
SAMPLES = [0.0, 0.37, 1.0, 2.0, 3.1, 3.99]


def run_in_node(compiled: dict, values: dict) -> list[float]:
    args = ", ".join(compiled["params"])
    call = ", ".join(str(values[p]) for p in compiled["params"])
    script = (
        f"{JS_RUNTIME}\n"
        f"const f = ({compiled['variable']}{', ' + args if args else ''}) => "
        f"({compiled['source']});\n"
        f"console.log(JSON.stringify({json.dumps(SAMPLES)}"
        f".map(v => f(v{', ' + call if call else ''}))));\n"
    )
    out = subprocess.run(["node", "--input-type=module", "-e", script],
                         capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def in_sympy(expr: sp.Expr, values: dict) -> list[float]:
    subs = {sp.Symbol(k): v for k, v in values.items()}
    return [float(expr.subs(subs).subs(x, v).evalf()) for v in SAMPLES]


def assert_matches(expr: sp.Expr) -> None:
    js = run_in_node(compile_function(expr, x), VALUES)
    py = in_sympy(expr, VALUES)
    for a, b in zip(py, js):
        assert abs(a - b) <= 1e-9 * max(1.0, abs(a)), f"sympy={a} js={b}"


@pytest.fixture
def mixed_beam():
    body = Body(
        id="b1",
        domain=Domain1D(parameter="x", start="0", end="L"),
        constitutive=Constitutive(E="E", I="I"),
        analysis=Analysis(mode="deformable"),
        fields=[
            MechanicalLoad(id="q1", region=IntervalRegion(start="0", end="L/2"),
                           distribution=LinearDistribution(w_start="0", w_end="w0"),
                           direction=DOWN),
            MechanicalLoad(id="P1", region=PointRegion(at="3*L/4"),
                           distribution=PointDistribution(magnitude="P"), direction=DOWN),
        ],
    )
    return solve_beam(body, [
        StructuralSupport(id="A", body_id="b1", at="0", type="pin"),
        StructuralSupport(id="B", body_id="b1", at="L", type="roller"),
    ])


@pytest.mark.parametrize("name", ["V", "M", "theta", "y"])
def test_js_matches_sympy(mixed_beam, name):
    assert_matches(mixed_beam.functions[name])


def test_custom_expression_load_compiles_and_matches():
    """Una carga senoidal no es polinomica: sigue otro camino de integracion."""
    body = Body(
        id="b1",
        domain=Domain1D(parameter="x", start="0", end="L"),
        constitutive=Constitutive(E="E", I="I"),
        analysis=Analysis(mode="deformable"),
        fields=[MechanicalLoad(
            id="q1", region=FullRegion(),
            distribution={"type": "expression", "expr": "w0*sin(pi*x/L)"}, direction=DOWN,
        )],
    )
    sol = solve_beam(body, [
        StructuralSupport(id="A", body_id="b1", at="0", type="pin"),
        StructuralSupport(id="B", body_id="b1", at="L", type="roller"),
    ])
    # Reacciones exactas: cada apoyo toma la mitad de 2 w0 L / pi.
    assert sp.simplify(sol.reactions["R_A"] - sp.Symbol("w0") * sp.Symbol("L") / sp.pi) == 0
    for name in ("V", "M", "y"):
        assert_matches(sol.functions[name])


# ---------------------------------------------------------------- AST

def evaluate_ast(node, x_value, params):
    """Referencia en Python del interprete que corre en el cliente."""
    import math
    if isinstance(node, (int, float)):
        return float(node)
    if "v" in node:
        return x_value if node["v"] == "x" else params[node["v"]]
    args = [evaluate_ast(a, x_value, params) for a in node["a"]]
    op = node["f"]
    if op == "+":
        return sum(args)
    if op == "*":
        out = 1.0
        for a in args:
            out *= a
        return out
    if op == "^":
        return args[0] ** args[1]
    if op == "sf":
        xv, a, n = args
        if n < 0 or xv < a:
            return 0.0
        return 1.0 if n == 0 else (xv - a) ** n
    if op == "hv":
        return 0.0 if args[0] < 0 else 1.0
    return getattr(math, op)(*args)


@pytest.mark.parametrize("name", ["V", "M", "theta", "y"])
def test_ast_matches_sympy(mixed_beam, name):
    """El AST tiene que dar lo mismo que el codigo compilado y que SymPy."""
    from wf_core.jsprint import to_ast
    expr = mixed_beam.functions[name]
    tree = to_ast(expr)
    expected = in_sympy(expr, VALUES)
    for sample, want in zip(SAMPLES, expected):
        got = evaluate_ast(tree, sample, VALUES)
        assert abs(got - want) <= 1e-9 * max(1.0, abs(want)), f"x={sample}"
