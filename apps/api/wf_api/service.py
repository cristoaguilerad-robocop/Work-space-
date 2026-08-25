"""Derivacion: modelo (etapa 1) -> ecuaciones, pasos y funciones (etapa 2).

La funcion ``derive_payload`` es de nivel de modulo a proposito: tiene que ser
picklable para correr en el pool de procesos de :mod:`compute`.
"""

from __future__ import annotations

import sympy as sp

from wf_core.canonical import assemble
from wf_core.jsprint import compile_function, to_ast
from wf_core.model import (
    FullRegion, IntervalRegion, MechanicalLoad, PointRegion, ProblemModel, ThermalField,
)
from wf_statics import ModelError, solve_beam

from .defaults import suggest


def _packaged(expr: sp.Expr, variable: sp.Symbol, *, emit_ast: bool = False) -> dict:
    """Una expresion lista para la UI: LaTeX para leer, JS para graficar.

    ``emit_ast`` agrega el arbol serializado. Solo hace falta en entornos donde
    no se puede compilar codigo (una pagina con CSP estricta), asi que no viaja
    por defecto: duplicaria el peso de cada respuesta sin que nadie lo use.
    """
    out = {
        "latex": sp.latex(expr),
        "js": compile_function(expr, variable),
    }
    if emit_ast:
        out["ast"] = to_ast(expr)
    return out


def _load_descriptors(body, *, emit_ast: bool = False) -> list[dict]:
    """Perfiles de carga compilados, para que el canvas dibuje la forma real.

    El canvas no reimplementa las distribuciones: dibuja evaluando la misma
    densidad canonica que usa el motor. Una carga custom ``w0*sin(pi*x/L)`` se
    ve con su forma verdadera sin una sola linea de codigo extra en la UI.
    """
    x = sp.Symbol(body.domain.parameter)
    loading = assemble(body)
    out: list[dict] = []

    for spec in body.fields:
        if isinstance(spec, ThermalField):
            out.append({
                "id": spec.id,
                "label": spec.label or spec.id,
                "quantity": "temperature",
                "kind": "thermal",
            })
            continue

        assert isinstance(spec, MechanicalLoad)
        region = spec.region
        if isinstance(region, PointRegion):
            start = end = sp.sympify(region.at)
        elif isinstance(region, IntervalRegion):
            start, end = sp.sympify(region.start), sp.sympify(region.end)
        else:
            assert isinstance(region, FullRegion)
            start, end = sp.sympify(body.domain.start), sp.sympify(body.domain.end)

        if spec.quantity == "moment":
            kind = "couple"
        elif isinstance(region, PointRegion):
            kind = "point"
        else:
            kind = "distributed"

        descriptor = {
            "id": spec.id,
            "label": spec.label or spec.id,
            "quantity": spec.quantity,
            "kind": kind,
            "units": spec.units,
            "start": _packaged(start, x, emit_ast=emit_ast),
            "end": _packaged(end, x, emit_ast=emit_ast),
        }
        if kind == "distributed":
            descriptor["profile"] = _packaged(loading.by_load[spec.id], x, emit_ast=emit_ast)
        else:
            magnitude = getattr(spec.distribution, "magnitude", "0")
            descriptor["magnitude"] = _packaged(sp.sympify(magnitude), x, emit_ast=emit_ast)
        out.append(descriptor)

    return out


def derive_body(body, supports, *, emit_ast: bool = False) -> dict:
    x = sp.Symbol(body.domain.parameter)
    sol = solve_beam(body, supports)
    return {
        "loads": _load_descriptors(body, emit_ast=emit_ast),
        "supports": [
            {"id": s.id, "type": s.type, "at": _packaged(sp.sympify(s.at), x, emit_ast=emit_ast)}
            for s in supports
        ],
        "body_id": body.id,
        "name": body.name or body.id,
        "mode": sol.mode,
        "parameter": body.domain.parameter,
        "domain_end": sp.latex(sp.sympify(body.domain.end)),
        "length": _packaged(sp.sympify(body.domain.end), x, emit_ast=emit_ast),
        "reactions": {
            name: _packaged(value, x, emit_ast=emit_ast) for name, value in sol.reactions.items()
        },
        "functions": {
            name: _packaged(expr, x, emit_ast=emit_ast) for name, expr in sol.functions.items()
        },
        "scalars": {
            name: _packaged(expr, x, emit_ast=emit_ast) for name, expr in sol.scalars.items()
        },
        "residuals": {k: sp.latex(v) for k, v in sol.residuals.items()},
        "equations": sol.equations.to_list(),
        "steps": sol.trace.to_list(),
        "notes": sol.notes,
    }


def derive_payload(model_json: str, *, emit_ast: bool = False) -> dict:
    """Deriva todo el problema. Un cuerpo que falla no tumba a los demas."""
    model = ProblemModel.model_validate_json(model_json)

    bodies: list[dict] = []
    errors: list[dict] = []
    for body in model.bodies:
        try:
            bodies.append(derive_body(body, model.supports_for(body.id), emit_ast=emit_ast))
        except (ModelError, ValueError, NotImplementedError) as exc:
            errors.append({"body_id": body.id, "message": str(exc)})

    return {
        "module": model.module,
        "title": model.title,
        "symbols": [suggest(name) for name in sorted(model.free_symbols(), key=str.lower)],
        "bodies": bodies,
        "errors": errors,
    }
