"""Campos de una linea cargada o de un conductor con corriente.

Reusa exactamente la misma idea que Estatica y Termo: la fuente es una
**funcion sobre el dominio del cuerpo**, no un valor puntual. Una carga
puntual es el caso en que ``lambda(x)`` es una delta, igual que una carga
concentrada en una viga.

Lo que cambia respecto de los otros dos modulos es que aca el resultado no es
un campo sobre el propio dominio, sino sobre el **espacio**: hay que evaluar en
un punto de observacion. Por eso la salida tiene dos partes:

* lo que se resuelve simbolicamente y de forma exacta -- carga total, centroide
  de carga, y el aporte de cada carga puntual, que es Coulomb directo;
* el aporte de la parte continua, que queda planteado como una integral. Se
  intenta la forma cerrada, y ademas se emite el integrando para que el cliente
  lo integre numericamente. Asi funciona para *cualquier* ``lambda(x)``,
  incluida una expresion custom que SymPy no sepa integrar.

El planteamiento simbolico se muestra siempre: es justamente lo que un alumno
tiene que ver escrito antes de que aparezca un numero.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import sympy as sp

from wf_core import singularity as sg
from wf_core.canonical import _profile_expr, _region_bounds, centroid, density_of, local_frame, resultant
from wf_core.equations import EquationSet
from wf_core.expressions import ExpressionError, parse
from wf_core.model import Body, PointDistribution, Probe, ScalarSource
from wf_core.steps import StepTrace

#: Coordenadas reservadas del punto de observacion. Se dejan simbolicas para
#: que el cliente pueda barrer una grilla y dibujar el mapa 2D.
PX, PY, PZ = sp.symbols("px py pz", real=True)

#: Constante de Coulomb, 1/(4 pi eps0). Simbolica para que sea valorizable.
K_E = sp.Symbol("k_e")
#: mu0 / (4 pi), para Biot-Savart.
K_M = sp.Symbol("k_m")


class ModelError(ValueError):
    """El problema electromagnetico no se puede resolver tal como esta planteado."""


@dataclass
class Segment:
    """Un tramo continuo con su perfil SIN ventanear.

    Para la integral de campo los limites de integracion ya acotan el tramo,
    asi que ventanear el perfil con funciones de singularidad solo le agrega a
    SymPy un obstaculo que le impide encontrar la forma cerrada.
    """

    id: str
    profile: sp.Expr
    start: sp.Expr
    end: sp.Expr


@dataclass
class PointSource:
    """Una fuente concentrada: se resuelve exacto, sin integrar."""

    id: str
    magnitude: sp.Expr
    position: sp.Matrix


@dataclass
class FieldPart:
    """Un integrando con sus limites propios."""

    integrand: sp.Expr
    start: sp.Expr
    end: sp.Expr


@dataclass
class FieldSetup:
    """Planteamiento de un campo en el punto de observacion.

    La parte continua va **por tramos**, cada uno con su perfil limpio y sus
    propios limites, en vez de un solo integrando ventaneado sobre todo el
    dominio. No es cosmetico: una densidad que cubre medio cuerpo tiene un
    salto, y una cuadratura de Simpson que lo atraviesa pierde precision de
    forma visible. Integrando cada tramo por separado el integrando es suave
    y la cuadratura del cliente vuelve a ser exacta.
    """

    #: Integrandos de la parte continua, funcion de x y de (px, py, pz).
    parts: list[FieldPart] = field(default_factory=list)
    #: Aporte exacto de las fuentes concentradas.
    discrete: sp.Expr = sp.S.Zero
    #: Forma cerrada de la integral, si SymPy la resuelve.
    closed_form: sp.Expr | None = None


@dataclass
class LineSolution:
    body_id: str
    kind: str  # charge | current
    scalars: dict[str, sp.Expr] = field(default_factory=dict)
    setups: dict[str, FieldSetup] = field(default_factory=dict)
    probes: list[dict] = field(default_factory=list)
    equations: EquationSet = field(default_factory=EquationSet)
    trace: StepTrace = field(default_factory=StepTrace)
    notes: list[str] = field(default_factory=list)


def _split_sources(body: Body, quantity: str):
    """Separa la fuente en tres formas, cada una para lo que sirve.

    * la densidad canonica ventaneada, para la carga total y el centroide y
      para la cuadratura numerica del cliente;
    * los tramos continuos con su perfil limpio, para intentar forma cerrada;
    * las fuentes concentradas, que se resuelven exacto por Coulomb.
    """
    domain = body.domain
    x = sp.Symbol(domain.parameter)
    axis, _ = local_frame(domain)
    origin = sp.Matrix([parse(c) for c in domain.embedding.origin])

    windowed = sp.S.Zero
    segments: list[Segment] = []
    points: list[PointSource] = []

    for spec in body.fields:
        if not isinstance(spec, ScalarSource) or spec.quantity != quantity:
            continue
        if isinstance(spec.distribution, PointDistribution):
            at = parse(spec.region.at)
            points.append(PointSource(
                id=spec.id,
                magnitude=parse(spec.distribution.magnitude),
                position=origin + at * axis,
            ))
            continue

        windowed += density_of(spec, domain)
        a, b = _region_bounds(spec, domain)
        if spec.distribution.type == "piecewise":
            for piece in spec.distribution.pieces:
                pa, pb = parse(piece.start), parse(piece.end)
                segments.append(Segment(spec.id, _profile_expr(piece.distribution, x, pa, pb), pa, pb))
        else:
            segments.append(Segment(spec.id, _profile_expr(spec.distribution, x, a, b), a, b))

    return sp.expand(windowed), segments, points


def _geometry(body: Body):
    domain = body.domain
    x = sp.Symbol(domain.parameter)
    axis, _ = local_frame(domain)
    origin = sp.Matrix([parse(c) for c in domain.embedding.origin])
    position = origin + x * axis                      # r(x)
    separation = sp.Matrix([PX, PY, PZ]) - position   # P - r(x)
    distance = sp.sqrt(sum(component**2 for component in separation))
    return x, axis, position, separation, distance


def _closed_form(integrand: sp.Expr, x: sp.Symbol, start: sp.Expr, end: sp.Expr):
    """Intenta la forma cerrada. Si no sale, no es un error: se integra numerico.

    ``conds="none"`` evita que SymPy devuelva un Piecewise con las condiciones
    de convergencia: nuestras distancias son positivas por construccion.
    """
    try:
        result = sp.integrate(integrand, (x, start, end), conds="none")
    except Exception:  # pragma: no cover - SymPy puede fallar de muchas formas
        return None
    result = sg.resolve_piecewise(result)
    if result.has(sp.Integral) or result.has(sp.Piecewise):
        return None
    # polar_lift viene de la continuacion analitica compleja de SymPy. Nuestras
    # distancias son reales y positivas, asi que no aporta nada y ensucia el
    # LaTeX y la serializacion.
    result = result.replace(sp.polar_lift, lambda arg: arg)
    return sp.simplify(result)


def _is_polynomial(profile: sp.Expr, x: sp.Symbol) -> bool:
    try:
        return bool(sp.Poly(profile, x)) or not profile.has(x)
    except (sp.PolynomialError, sp.GeneratorsNeeded):
        return not profile.has(x)


def _closed_over_segments(kernel: sp.Expr, segments, x: sp.Symbol):
    """Forma cerrada de la suma de los tramos, o ``None`` si alguno no sale.

    Solo se intenta con perfiles polinomicos. Una densidad como
    ``lam0*exp(-x/L)`` contra un nucleo ``1/sqrt(...)`` no tiene primitiva
    elemental, y pedirsela a SymPy cuesta segundos o minutos para terminar
    devolviendo lo mismo que si no se hubiera intentado. Esos casos van
    directo a cuadratura numerica, que es exacta hasta el error de Simpson y
    responde igual de rapido para cualquier densidad.
    """
    total = sp.S.Zero
    for segment in segments:
        if not _is_polynomial(segment.profile, x):
            return None
        piece = _closed_form(segment.profile * kernel, x, segment.start, segment.end)
        if piece is None:
            return None
        total += piece
    return sp.simplify(total)


def solve_line(body: Body, probes: list[Probe]) -> LineSolution:
    """Resuelve una linea cargada o un conductor con corriente."""
    domain = body.domain
    start, end = parse(domain.start), parse(domain.end)
    x, axis, _position, separation, distance = _geometry(body)

    has_charge = any(
        isinstance(f, ScalarSource) and f.quantity == "charge_density" for f in body.fields
    )
    has_current = any(
        isinstance(f, ScalarSource) and f.quantity == "current" for f in body.fields
    )
    if has_charge == has_current:
        raise ModelError(
            f"el cuerpo {body.id!r} debe tener densidad de carga o corriente, no ambas "
            "ni ninguna."
        )

    kind = "charge" if has_charge else "current"
    sol = LineSolution(body_id=body.id, kind=kind)
    trace, eqs = sol.trace, sol.equations

    quantity = "charge_density" if has_charge else "current"
    continuous, segments, points = _split_sources(body, quantity)

    label = "\\lambda(x)" if has_charge else "I(x)"
    total_symbol = "Q" if has_charge else "I_{tot}"

    density_total = continuous + sum(
        (p.magnitude * sp.SingularityFunction(x, (p.position - sp.Matrix(
            [parse(c) for c in domain.embedding.origin])).dot(axis), -1) for p in points),
        sp.S.Zero,
    )
    trace.add("canonical", "Densidad canonica de la fuente", density_total,
              lhs=label, kind="algebra",
              detail="Cargas puntuales y densidad continua, en una sola expresion.")
    eqs.add(f"{body.id}:density", "Densidad de fuente", density_total, lhs=label, role="field")

    total = sp.expand(resultant(density_total, x, end))
    sol.scalars["total"] = total
    trace.add("total", "Carga total" if has_charge else "Corriente total", total,
              lhs=total_symbol, kind="integrate")
    eqs.add(f"{body.id}:total", "Total", total, lhs=total_symbol, role="result")

    if sp.simplify(total) != 0:
        try:
            centre = centroid(density_total, x, end)
            sol.scalars["centroid"] = centre
            trace.add("centroid", "Centroide de la fuente", centre, lhs="\\bar{x}",
                      kind="integrate")
            eqs.add(f"{body.id}:centroid", "Centroide", centre, lhs="\\bar{x}", role="result")
        except ExpressionError:
            pass

    # ------------------------------------------------------------- campos
    if has_charge:
        _setup_electrostatics(sol, continuous, segments, points, x, start, end, separation, distance)
    else:
        _setup_magnetostatics(sol, continuous, segments, points, x, start, end, separation, distance, axis)

    # ------------------------------------------------------------- sondas
    for probe in probes:
        at = [parse(c) for c in probe.at]
        substitution = {PX: at[0], PY: at[1], PZ: at[2]}
        sol.probes.append({
            "id": probe.id,
            "label": probe.label or probe.id,
            "at": at,
            "substitution": substitution,
        })

    return sol


def _setup_electrostatics(sol, continuous, segments, points, x, start, end, separation, distance):
    observer = sp.Matrix([PX, PY, PZ])

    def parts_for(kernel):
        return [FieldPart(sp.together(segment.profile * kernel), segment.start, segment.end)
                for segment in segments]

    discrete_v = sum(
        (K_E * p.magnitude / sp.sqrt(sum(c**2 for c in (observer - p.position)))
         for p in points),
        sp.S.Zero,
    )

    plan = sp.Integral(K_E * continuous / distance, (x, start, end)) + discrete_v
    sol.trace.add("V-setup", "Planteamiento del potencial", plan, lhs="V(P)",
                  kind="algebra",
                  detail="V = k_e * int lambda(x) / |P - r(x)| dx, mas Coulomb directo "
                         "para cada carga puntual.")
    sol.equations.add("V", "Potencial electrico", plan, lhs="V(P)", role="field",
                      detail="Planteamiento simbolico. La parte continua se integra en "
                             "forma cerrada cuando existe, y numericamente si no.")

    closed = _closed_over_segments(K_E / distance, segments, x)
    if closed is not None:
        total = sp.simplify(closed + discrete_v)
        sol.trace.add("V-closed", "Forma cerrada del potencial", total, lhs="V(P)",
                      kind="solve")
        sol.equations.add("V_closed", "Potencial (forma cerrada)", total, lhs="V(P)",
                          role="result")
    elif segments:
        sol.notes.append(
            "La integral del potencial no tiene forma cerrada elemental para esta "
            "densidad: se evalua por cuadratura numerica."
        )

    sol.setups["V"] = FieldSetup(
        parts=parts_for(K_E / distance), discrete=discrete_v, closed_form=closed,
    )

    for index, component in enumerate("xyz"):
        discrete_e = sum(
            (K_E * p.magnitude * (observer - p.position)[index]
             / sp.sqrt(sum(c**2 for c in (observer - p.position)))**3
             for p in points),
            sp.S.Zero,
        )
        # Las componentes no llevan forma cerrada: son tres integrales mas, cada
        # una tan cara como la del potencial, y en la pagina se muestran como
        # numero. La cuadratura las da con el mismo integrando y sin ese costo.
        sol.setups[f"E{component}"] = FieldSetup(
            parts=parts_for(K_E * separation[index] / distance**3),
            discrete=discrete_e,
        )

    sol.equations.add(
        "E", "Campo electrico",
        sp.Integral(K_E * continuous * separation[1] / distance**3, (x, start, end)),
        lhs="E_y(P)", role="field",
        detail="Cada componente se integra igual que el potencial. E = -grad V.")


def _setup_magnetostatics(sol, continuous, segments, points, x, start, end, separation, distance, axis):
    """Biot-Savart para un conductor recto: dB = k_m I (dl x r_hat) / r^2."""
    if points:
        sol.notes.append(
            "Una corriente concentrada en un punto no tiene sentido fisico; se ignoran "
            "las fuentes puntuales de corriente."
        )

    cross = axis.cross(separation)
    for index, component in enumerate("xyz"):
        kernel = K_M * cross[index] / distance**3
        # Solo B_z lleva forma cerrada: es la componente que se muestra escrita.
        sol.setups[f"B{component}"] = FieldSetup(
            parts=[FieldPart(sp.together(segment.profile * kernel), segment.start, segment.end)
                   for segment in segments],
            closed_form=_closed_over_segments(kernel, segments, x) if component == "z" else None,
        )

    plan = sp.Integral(K_M * continuous * cross[2] / distance**3, (x, start, end))
    sol.trace.add("B-setup", "Planteamiento de Biot-Savart", plan, lhs="B_z(P)",
                  kind="algebra",
                  detail="B = k_m * int I (dl x r_hat) / r^2, con k_m = mu0 / (4 pi).")
    sol.equations.add("B", "Campo magnetico", plan, lhs="B_z(P)", role="field")

    closed = sol.setups["Bz"].closed_form
    if closed is not None:
        sol.trace.add("B-closed", "Forma cerrada", closed, lhs="B_z(P)", kind="solve")
        sol.equations.add("B_closed", "Campo magnetico (forma cerrada)", closed,
                          lhs="B_z(P)", role="result")
