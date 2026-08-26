"""Derivacion: modelo (etapa 1) -> ecuaciones, pasos y funciones (etapa 2).

La funcion ``derive_payload`` es de nivel de modulo a proposito: tiene que ser
picklable para correr en el pool de procesos de :mod:`compute`.
"""

from __future__ import annotations

import sympy as sp

from wf_core.canonical import assemble, local_frame
from wf_core.jsprint import compile_function
from wf_core.model import (
    FullRegion, IntervalRegion, MechanicalLoad, PointRegion, ProblemModel,
    ScalarSource, ThermalField,
)
from wf_em import ModelError as EmError
from wf_em import PX, PY, PZ, solve_line
from wf_thermo import ModelError as ThermoError
from wf_thermo import solve_bar
from wf_statics import ModelError, solve_beam, solve_cable
from wf_statics.cable import ModelError as CableError

from .defaults import suggest


def _packaged(expr: sp.Expr, variable: sp.Symbol, *, emit_ast: bool = False) -> dict:
    """Una expresion lista para la UI: LaTeX para leer, JS para graficar.

    ``emit_ast`` agrega el arbol serializado. Solo hace falta en entornos donde
    no se puede compilar codigo (una pagina con CSP estricta), asi que no viaja
    por defecto: duplicaria el peso de cada respuesta sin que nadie lo use.
    """
    return {
        "latex": sp.latex(expr),
        "js": compile_function(expr, variable, emit_ast=emit_ast),
    }


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

        assert isinstance(spec, (MechanicalLoad, ScalarSource))
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


def _geometry(body, *, emit_ast: bool = False) -> dict:
    """Ubicacion del cuerpo en el mundo, ya compilada.

    Sale del ``embedding`` del dominio, que es donde vive la posicion: el eje
    del cuerpo va de ``origin`` a ``origin + L * direction``. El canvas dibuja
    con esto y no necesita saber nada del modulo.
    """
    x = sp.Symbol(body.domain.parameter)
    axis, transverse = local_frame(body.domain)
    origin = [sp.sympify(c) for c in body.domain.embedding.origin]
    return {
        "origin": [_packaged(c, x, emit_ast=emit_ast) for c in origin],
        "axis": [_packaged(c, x, emit_ast=emit_ast) for c in axis],
        "transverse": [_packaged(c, x, emit_ast=emit_ast) for c in transverse],
    }


def _reaction_arrows(supports, reactions, *, x, emit_ast: bool = False) -> list[dict]:
    """Las reacciones como vectores dibujables: donde actuan y en que sentido.

    Sin esto el canvas tendria que adivinar a que apoyo corresponde cada
    simbolo. El nombre ya lo dice (``R_A`` actua en el apoyo ``A``), pero
    hacerlo explicito evita que el dibujo dependa de como se arman los nombres.
    """
    arrows: list[dict] = []
    for support in supports:
        at = _packaged(sp.sympify(support.at), x, emit_ast=emit_ast)
        for prefix, component in (("R", "transverse"), ("H", "axial"), ("M", "moment")):
            name = f"{prefix}_{support.id}"
            if name not in reactions:
                continue
            arrows.append({
                "id": name,
                "support_id": support.id,
                "component": component,
                "at": at,
                "value": _packaged(reactions[name], x, emit_ast=emit_ast),
            })
    return arrows


def derive_cable_body(body, supports, *, emit_ast: bool = False) -> dict:
    """Un cable: misma densidad canonica, otra ley constitutiva.

    Se devuelve ``shape`` aparte de las funciones para que el canvas dibuje la
    curva real en vez de una recta: en un cable la forma *es* el resultado.
    """
    x = sp.Symbol(body.domain.parameter)
    sol = solve_cable(body, supports)
    return {
        "body_id": body.id,
        "name": body.name or body.id,
        "module": "statics",
        "kind": "cable",
        "mode": "cable",
        "parameter": body.domain.parameter,
        "domain_end": sp.latex(sp.sympify(body.domain.end)),
        "length": _packaged(sp.sympify(body.domain.end), x, emit_ast=emit_ast),
        "geometry": _geometry(body, emit_ast=emit_ast),
        "shape": _packaged(sol.functions["y"], x, emit_ast=emit_ast),
        "loads": _load_descriptors(body, emit_ast=emit_ast),
        "supports": [
            {"id": s.id, "type": s.type,
             "at": _packaged(sp.sympify(s.at), x, emit_ast=emit_ast),
             "elevation": _packaged(sp.sympify(s.elevation), x, emit_ast=emit_ast)}
            for s in supports
        ],
        "reactions": {},
        "functions": {n: _packaged(e, x, emit_ast=emit_ast) for n, e in sol.functions.items()},
        "scalars": {n: _packaged(e, x, emit_ast=emit_ast) for n, e in sol.scalars.items()},
        "residuals": {},
        "equations": sol.equations.to_list(),
        "steps": sol.trace.to_list(),
        "notes": sol.notes,
    }


def derive_body(body, supports, *, emit_ast: bool = False) -> dict:
    x = sp.Symbol(body.domain.parameter)
    sol = solve_beam(body, supports)
    return {
        "geometry": _geometry(body, emit_ast=emit_ast),
        "reaction_arrows": _reaction_arrows(supports, sol.reactions, x=x, emit_ast=emit_ast),
        "loads": _load_descriptors(body, emit_ast=emit_ast),
        "supports": [
            {"id": s.id, "type": s.type,
             "at": _packaged(sp.sympify(s.at), x, emit_ast=emit_ast),
             "elevation": _packaged(sp.sympify(s.elevation), x, emit_ast=emit_ast)}
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


def derive_thermo_body(body, boundaries, *, emit_ast: bool = False) -> dict:
    x = sp.Symbol(body.domain.parameter)
    sol = solve_bar(body, boundaries)
    return {
        "body_id": body.id,
        "name": body.name or body.id,
        "module": "thermo",
        "mode": body.analysis.mode,
        "parameter": body.domain.parameter,
        "domain_end": sp.latex(sp.sympify(body.domain.end)),
        "length": _packaged(sp.sympify(body.domain.end), x, emit_ast=emit_ast),
        "geometry": _geometry(body, emit_ast=emit_ast),
        "loads": _load_descriptors(body, emit_ast=emit_ast),
        "supports": [],
        "boundaries": [
            {
                "id": bc.id, "type": bc.type,
                "at": _packaged(sp.sympify(bc.at), x, emit_ast=emit_ast),
                "label": bc.label or bc.id,
            }
            for bc in boundaries
        ],
        "reactions": {},
        "functions": {n: _packaged(e, x, emit_ast=emit_ast) for n, e in sol.functions.items()},
        "scalars": {n: _packaged(e, x, emit_ast=emit_ast) for n, e in sol.scalars.items()},
        "residuals": {k: sp.latex(v) for k, v in sol.residuals.items()},
        "equations": sol.equations.to_list(),
        "steps": sol.trace.to_list(),
        "notes": sol.notes,
    }


def derive_em_body(body, probes, *, emit_ast: bool = False) -> dict:
    """En Electro el resultado vive en el espacio, no sobre el dominio.

    Por eso en vez de ``functions`` viaja ``field_setups``: los integrandos por
    tramo, el aporte exacto de las cargas puntuales y la forma cerrada cuando
    existe. El cliente los usa tanto para el valor en una sonda como para
    barrer la grilla del mapa 2D.
    """
    x = sp.Symbol(body.domain.parameter)
    sol = solve_line(body, probes)

    def pack_field(setup) -> dict:
        return {
            "parts": [
                {
                    "integrand": _packaged(part.integrand, x, emit_ast=emit_ast),
                    "start": _packaged(part.start, x, emit_ast=emit_ast),
                    "end": _packaged(part.end, x, emit_ast=emit_ast),
                }
                for part in setup.parts
            ],
            "discrete": _packaged(setup.discrete, x, emit_ast=emit_ast),
            "closed_form": (
                _packaged(setup.closed_form, x, emit_ast=emit_ast)
                if setup.closed_form is not None else None
            ),
        }

    return {
        "body_id": body.id,
        "name": body.name or body.id,
        "module": "em",
        "kind": sol.kind,
        "mode": body.analysis.mode,
        "parameter": body.domain.parameter,
        "domain_end": sp.latex(sp.sympify(body.domain.end)),
        "length": _packaged(sp.sympify(body.domain.end), x, emit_ast=emit_ast),
        "geometry": _geometry(body, emit_ast=emit_ast),
        "loads": _load_descriptors(body, emit_ast=emit_ast),
        "supports": [],
        "probes": [
            {
                "id": probe["id"], "label": probe["label"],
                "at": [_packaged(c, x, emit_ast=emit_ast) for c in probe["at"]],
            }
            for probe in sol.probes
        ],
        "field_setups": {name: pack_field(setup) for name, setup in sol.setups.items()},
        "observer": [PX.name, PY.name, PZ.name],
        "reactions": {},
        "functions": {},
        "scalars": {n: _packaged(e, x, emit_ast=emit_ast) for n, e in sol.scalars.items()},
        "residuals": {},
        "equations": sol.equations.to_list(),
        "steps": sol.trace.to_list(),
        "notes": sol.notes,
    }


#: Como nombrar cada figura rigida cuando hay que explicar que no se resuelve.
SHAPE_NAMES = {
    "disc": "Disco", "sphere": "Esfera", "block": "Bloque",
    "rod": "Barra rigida", "ideal_cable": "Cable ideal", "spring": "Resorte",
}


def derive_payload(model_json: str, *, emit_ast: bool = False) -> dict:
    """Deriva todo el problema. Un cuerpo que falla no tumba a los demas."""
    model = ProblemModel.model_validate_json(model_json)

    bodies: list[dict] = []
    errors: list[dict] = []
    for body in model.bodies:
        try:
            if body.is_rigid_shape:
                # Un disco o un bloque no tienen q(x): su equilibrio es otra
                # teoria, no la de vigas. Mandarlos igual al solver daria un
                # resultado inventado, que es peor que no dar ninguno.
                raise NotImplementedError(
                    f"{SHAPE_NAMES.get(body.type, body.type)}: todavia no se resuelve solo. "
                    "Se puede armar, medir y escribir el procedimiento a mano."
                )
            if model.module == "thermo":
                bodies.append(derive_thermo_body(
                    body, model.boundaries_for(body.id), emit_ast=emit_ast))
            elif model.module == "em":
                bodies.append(derive_em_body(body, model.probes, emit_ast=emit_ast))
            elif body.analysis.dof == "cable":
                bodies.append(derive_cable_body(
                    body, model.supports_for(body.id), emit_ast=emit_ast))
            else:
                bodies.append(derive_body(
                    body, model.supports_for(body.id), emit_ast=emit_ast))
        except (ModelError, CableError, ThermoError, EmError,
                ValueError, NotImplementedError) as exc:
            errors.append({"body_id": body.id, "message": str(exc)})

    # Las constantes fisicas no aparecen en el modelo: las introduce el motor al
    # plantear el campo. Igual hay que poder valorizarlas, asi que se recogen de
    # lo derivado. Las coordenadas del observador quedan fuera: no son un valor
    # del problema, las mueve la sonda o la grilla del mapa.
    observer = {PX.name, PY.name, PZ.name}

    def packaged_params(node) -> set[str]:
        """Parametros de cualquier expresion empaquetada dentro de ``node``."""
        if isinstance(node, dict):
            if "js" in node:
                return set(node["js"]["params"])
            return set().union(*(packaged_params(v) for v in node.values()), set())
        if isinstance(node, list):
            return set().union(*(packaged_params(v) for v in node), set())
        return set()

    extra: set[str] = set()
    for derived in bodies:
        extra |= packaged_params(derived.get("field_setups", {}))
        extra.discard(derived.get("parameter", "x"))
    extra -= observer

    names = sorted(model.free_symbols() | extra, key=str.lower)

    return {
        "module": model.module,
        "title": model.title,
        "symbols": [suggest(name) for name in names],
        "bodies": bodies,
        "errors": errors,
    }
