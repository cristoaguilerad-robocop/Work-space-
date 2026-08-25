"""Canonicalizacion: ``LoadSpec[]`` -> una unica densidad simbolica ``q(x)``.

Aca vive el requisito critico del proyecto. Una carga puntual **no** es un tipo
especial de objeto en el motor: es una densidad con una delta. Por eso la
resultante de una carga distribuida y la de una puntual salen de la misma
integral, y por eso el modo rigido y el deformable comparten pipeline (el
rigido simplemente se detiene dos integraciones antes).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import sympy as sp

from . import singularity as sg
from .expressions import ExpressionError, parse
from .model import (
    Body,
    Domain1D,
    FullRegion,
    IntervalRegion,
    MechanicalLoad,
    PiecewiseDistribution,
    PointDistribution,
    PointRegion,
    ThermalField,
    ThermalProfileLinear,
)


@dataclass
class ThermalTerms:
    """Aportes termicos separados por efecto."""

    #: Deformacion axial libre por dilatacion, ``alpha * (T_media - T_ref)``.
    eps: sp.Expr
    #: Curvatura impuesta por el gradiente en la seccion.
    kappa: sp.Expr


@dataclass
class BodyLoading:
    """Densidades canonicas de un cuerpo, listas para integrar."""

    x: sp.Symbol
    start: sp.Expr
    end: sp.Expr
    #: Densidad transversal total: distribuidas + deltas + pares concentrados.
    q_transverse: sp.Expr = sp.S.Zero
    #: Densidad axial total.
    q_axial: sp.Expr = sp.S.Zero
    thermal: ThermalTerms | None = None
    #: Aporte transversal desglosado por id de carga (para la UI y la traza).
    by_load: dict[str, sp.Expr] = field(default_factory=dict)


# --------------------------------------------------------------------------
# Marco local del cuerpo
# --------------------------------------------------------------------------

def local_frame(domain: Domain1D) -> tuple[sp.Matrix, sp.Matrix]:
    """Versores axial y transversal del cuerpo, en coordenadas globales."""
    if domain.embedding.type != "straight":
        raise NotImplementedError(
            f"marco local no implementado para embedding {domain.embedding.type!r}"
        )
    d = sp.Matrix([parse(c) for c in domain.embedding.direction])
    norm = sp.sqrt(sum(c**2 for c in d))
    if norm == 0:
        raise ExpressionError("la direccion del cuerpo no puede ser nula")
    axial = d / norm
    # transversal = z_hat x axial: para axial = +x da +y ("arriba").
    transverse = sp.Matrix([-axial[1], axial[0], sp.S.Zero])
    return axial, transverse


def _direction_components(load: MechanicalLoad, domain: Domain1D) -> tuple[sp.Expr, sp.Expr]:
    """Proyecta la direccion de la carga sobre los ejes locales -> (axial, transversal)."""
    v = sp.Matrix([parse(c) for c in load.direction.vector])
    norm = sp.sqrt(sum(c**2 for c in v))
    if norm == 0:
        raise ExpressionError(f"la carga {load.id!r} tiene direccion nula")
    v = v / norm
    if load.direction.frame == "local":
        return sp.simplify(v[0]), sp.simplify(v[1])
    axial, transverse = local_frame(domain)
    return sp.simplify(v.dot(axial)), sp.simplify(v.dot(transverse))


# --------------------------------------------------------------------------
# Distribucion -> expresion en el parametro
# --------------------------------------------------------------------------

def _region_bounds(load: MechanicalLoad, domain: Domain1D) -> tuple[sp.Expr, sp.Expr]:
    region = load.region
    if isinstance(region, FullRegion):
        return parse(domain.start), parse(domain.end)
    if isinstance(region, IntervalRegion):
        return parse(region.start), parse(region.end)
    raise ExpressionError(f"la carga {load.id!r} no define un intervalo")


def _profile_expr(dist, x: sp.Symbol, a: sp.Expr, b: sp.Expr) -> sp.Expr:
    """Intensidad ``w(x)`` de una distribucion continua, sin recortar al tramo."""
    t = dist.type
    if t == "uniform":
        return parse(dist.w)
    if t == "linear":
        w0, w1 = parse(dist.w_start), parse(dist.w_end)
        span = sp.simplify(b - a)
        if span == 0:
            raise ExpressionError("un tramo de carga lineal no puede tener longitud nula")
        return w0 + (w1 - w0) * (x - a) / span
    if t == "polynomial":
        return sum(
            (parse(c) * (x - a) ** i for i, c in enumerate(dist.coeffs)), sp.S.Zero
        )
    if t == "expression":
        return parse(dist.expr)
    raise ExpressionError(f"distribucion continua desconocida: {t!r}")


def density_of(load: MechanicalLoad, domain: Domain1D) -> sp.Expr:
    """Densidad canonica escalar de una carga, sin proyectar direccion.

    El resultado es siempre una expresion en el parametro del dominio, valida
    en todo ``[start, end]``: fuera de la region de la carga vale cero por
    construccion.
    """
    x = sp.Symbol(domain.parameter)
    dist = load.distribution

    if load.quantity == "moment":
        if not isinstance(load.region, PointRegion):
            raise ExpressionError(f"el par {load.id!r} debe aplicarse en un punto")
        if not isinstance(dist, PointDistribution):
            raise ExpressionError(f"el par {load.id!r} necesita una magnitud puntual")
        return sg.couple_term(parse(dist.magnitude), x, parse(load.region.at))

    if isinstance(dist, PointDistribution):
        if not isinstance(load.region, PointRegion):
            raise ExpressionError(
                f"la carga puntual {load.id!r} necesita una region de tipo 'point'"
            )
        return sg.point_term(parse(dist.magnitude), x, parse(load.region.at))

    if isinstance(load.region, PointRegion):
        raise ExpressionError(
            f"la carga distribuida {load.id!r} no puede aplicarse en un solo punto"
        )

    a, b = _region_bounds(load, domain)

    if isinstance(dist, PiecewiseDistribution):
        total = sp.S.Zero
        for piece in dist.pieces:
            pa, pb = parse(piece.start), parse(piece.end)
            if isinstance(piece.distribution, PointDistribution):
                total += sg.point_term(parse(piece.distribution.magnitude), x, pa)
            else:
                total += sg.windowed(_profile_expr(piece.distribution, x, pa, pb), x, pa, pb)
        return total

    return sg.windowed(_profile_expr(dist, x, a, b), x, a, b)


# --------------------------------------------------------------------------
# Termico
# --------------------------------------------------------------------------

def thermal_terms(fieldspec: ThermalField, body: Body) -> ThermalTerms:
    """Deformacion axial y curvatura impuestas por el campo de temperatura.

    Signo de la curvatura: si la fibra inferior esta mas caliente se alarga mas
    que la superior, la fibra de abajo queda del lado exterior del arco y la
    viga queda concava hacia arriba, es decir ``y'' > 0``. De ahi
    ``kappa_T = alpha * (T_inf - T_sup) / h``.
    """
    alpha = parse(body.constitutive.alpha) if body.constitutive.alpha else sp.S.Zero
    T_ref = parse(fieldspec.T_ref)
    profile = fieldspec.profile

    if isinstance(profile, ThermalProfileLinear):
        T_top, T_bot = parse(profile.T_top), parse(profile.T_bottom)
        T_mean = (T_top + T_bot) / 2
        if not body.constitutive.h:
            raise ExpressionError(
                f"el gradiente termico {fieldspec.id!r} necesita la altura de seccion 'h'"
            )
        h = parse(body.constitutive.h)
        kappa = alpha * (T_bot - T_top) / h
    else:
        T_mean = parse(profile.T)
        kappa = sp.S.Zero

    return ThermalTerms(eps=sp.expand(alpha * (T_mean - T_ref)), kappa=sp.expand(kappa))


# --------------------------------------------------------------------------
# Ensamblado por cuerpo
# --------------------------------------------------------------------------

def assemble(body: Body) -> BodyLoading:
    """Reune todos los campos del cuerpo en las densidades canonicas."""
    domain = body.domain
    x = sp.Symbol(domain.parameter)
    loading = BodyLoading(x=x, start=parse(domain.start), end=parse(domain.end))

    for spec in body.fields:
        if isinstance(spec, ThermalField):
            if loading.thermal is not None:
                raise ExpressionError("por ahora se admite un solo campo termico por cuerpo")
            loading.thermal = thermal_terms(spec, body)
            continue

        q = density_of(spec, domain)
        if spec.quantity == "moment":
            loading.q_transverse += q
            loading.by_load[spec.id] = q
            continue

        c_axial, c_transverse = _direction_components(spec, domain)
        q_t = sp.expand(q * c_transverse)
        loading.q_transverse += q_t
        loading.q_axial += sp.expand(q * c_axial)
        loading.by_load[spec.id] = q_t

    loading.q_transverse = sp.expand(loading.q_transverse)
    loading.q_axial = sp.expand(loading.q_axial)
    return loading


# --------------------------------------------------------------------------
# Modo rigido: resultante y punto de aplicacion
# --------------------------------------------------------------------------

def resultant(q: sp.Expr, x: sp.Symbol, end: sp.Expr) -> sp.Expr:
    """``R = integral(q dx)`` sobre todo el dominio."""
    return sg.activate(sg.antiderivative(q, x), x, end)


def moment_about_origin(q: sp.Expr, x: sp.Symbol, end: sp.Expr) -> sp.Expr:
    """``integral(x * q dx)``, calculado sin integrar contra deltas.

    Integrando dos veces y usando ``int_0^L int_0^x q = L*R - int_0^L x*q``, el
    momento sale de la misma maquinaria que el cortante y el flector. Ademas
    funciona igual para pares concentrados, que aportan momento pero no fuerza.
    """
    first = sg.antiderivative(q, x)
    second = sg.antiderivative(first, x)
    R = sg.activate(first, x, end)
    return sp.expand(end * R - sg.activate(second, x, end))


def centroid(q: sp.Expr, x: sp.Symbol, end: sp.Expr) -> sp.Expr:
    """Punto de aplicacion de la resultante."""
    R = resultant(q, x, end)
    if sp.simplify(R) == 0:
        raise ExpressionError("resultante nula: el punto de aplicacion no esta definido")
    return sp.simplify(moment_about_origin(q, x, end) / R)
