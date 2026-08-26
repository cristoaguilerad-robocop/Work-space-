"""Modelo de datos de "Cuerpo" y del problema.

Cuatro capas separadas a proposito dentro de :class:`Body`:

``domain``       donde esta el cuerpo y sobre que se integra: su parametrizacion
                 y su ubicacion en el mundo, que son la misma cosa.
``fields``       cargas y campos como FUNCIONES sobre ese dominio.
``constitutive`` material y seccion. Solo se usa en modo deformable.
``analysis``     rigido o deformable.

Hubo una quinta capa, ``placement``, que guardaba la pose en el mundo aparte del
dominio con el argumento de que mover un cuerpo en el canvas no debia tocar el
planteo. Eso vale para una viga -- sus esfuerzos internos no dependen de donde
este -- pero es falso para una linea cargada: ahi mover el cuerpo cambia el
campo en cualquier punto de observacion. Con Electro en el proyecto, la posicion
es un dato fisico, y tener dos lugares donde vive la misma informacion solo
garantiza que se desincronicen. El ``embedding`` del dominio ES la ubicacion.

Separar ``domain`` de ``fields`` es lo que permite que la misma maquinaria
integre una barra recta, un arco de corriente o una aleta curva.

Todo se guarda como *string simbolico*, nunca como numero: los valores
numericos aparecen recien en la etapa 3 como bindings. Asi la etapa 2 puede
mostrar la solucion parametrica.
"""

from __future__ import annotations

from typing import Annotated, Literal, Union, get_args, get_origin

from pydantic import BaseModel, ConfigDict, Field

from .expressions import free_names

Expr = str  # expresion simbolica serializada

#: Campos de texto que nunca contienen expresiones.
_NON_EXPR_FIELDS = frozenset({"id", "label", "name", "title", "units", "body_id", "parameter"})


class _Base(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


# --------------------------------------------------------------------------
# Dominio
# --------------------------------------------------------------------------

class StraightEmbedding(_Base):
    """Recta: ``r(x) = origin + x * direction``."""

    type: Literal["straight"] = "straight"
    origin: tuple[Expr, Expr, Expr] = ("0", "0", "0")
    direction: tuple[Expr, Expr, Expr] = ("1", "0", "0")


class ArcEmbedding(_Base):
    """Arco de radio constante en el plano XY. Reservado para Electro/Termo."""

    type: Literal["arc"] = "arc"
    center: tuple[Expr, Expr, Expr] = ("0", "0", "0")
    radius: Expr = "R"
    start_angle: Expr = "0"


Embedding = Annotated[Union[StraightEmbedding, ArcEmbedding], Field(discriminator="type")]


class Domain1D(_Base):
    """Dominio parametrico de un cuerpo idealizado como curva."""

    kind: Literal["curve1d"] = "curve1d"
    #: Simbolo del parametro de integracion.
    parameter: str = "x"
    #: Extremos simbolicos. ``L`` es un simbolo, no un numero.
    start: Expr = "0"
    end: Expr = "L"
    embedding: Embedding = Field(default_factory=StraightEmbedding)
    #: |dr/dparam|. Vale 1 en una barra recta parametrizada por longitud de arco.
    jacobian: Expr = "1"


# --------------------------------------------------------------------------
# Region de aplicacion de una carga (sobre el dominio, no sobre el mundo)
# --------------------------------------------------------------------------

class PointRegion(_Base):
    type: Literal["point"] = "point"
    at: Expr


class IntervalRegion(_Base):
    type: Literal["interval"] = "interval"
    start: Expr
    end: Expr


class FullRegion(_Base):
    """Todo el dominio del cuerpo."""

    type: Literal["full"] = "full"


Region = Annotated[Union[PointRegion, IntervalRegion, FullRegion], Field(discriminator="type")]


# --------------------------------------------------------------------------
# Distribuciones
# --------------------------------------------------------------------------

class PointDistribution(_Base):
    """Concentrada. Internamente es una delta, no un caso especial."""

    type: Literal["point"] = "point"
    magnitude: Expr


class UniformDistribution(_Base):
    type: Literal["uniform"] = "uniform"
    w: Expr


class LinearDistribution(_Base):
    """Cubre triangular y trapezoidal: es el mismo objeto matematico."""

    type: Literal["linear"] = "linear"
    w_start: Expr
    w_end: Expr


class PolynomialDistribution(_Base):
    """``sum(coeffs[i] * (s - inicio_region)**i)``."""

    type: Literal["polynomial"] = "polynomial"
    coeffs: list[Expr]


class ExpressionDistribution(_Base):
    """Funcion arbitraria del parametro del dominio."""

    type: Literal["expression"] = "expression"
    expr: Expr


class PiecewisePiece(_Base):
    start: Expr
    end: Expr
    distribution: "Distribution"


class PiecewiseDistribution(_Base):
    type: Literal["piecewise"] = "piecewise"
    pieces: list[PiecewisePiece]


Distribution = Annotated[
    Union[
        PointDistribution,
        UniformDistribution,
        LinearDistribution,
        PolynomialDistribution,
        ExpressionDistribution,
        PiecewiseDistribution,
    ],
    Field(discriminator="type"),
]

PiecewisePiece.model_rebuild()


# --------------------------------------------------------------------------
# Campos sobre el cuerpo
# --------------------------------------------------------------------------

class Direction(_Base):
    frame: Literal["global", "local"] = "global"
    vector: tuple[Expr, Expr, Expr] = ("0", "-1", "0")


class MechanicalLoad(_Base):
    """Carga mecanica: fuerza distribuida/puntual o par concentrado."""

    kind: Literal["load"] = "load"
    id: str
    label: str = ""
    quantity: Literal["force", "moment"] = "force"
    region: Region
    distribution: Distribution
    direction: Direction = Field(default_factory=Direction)
    units: str = ""


class ThermalProfileUniform(_Base):
    """Temperatura constante en la seccion, variable a lo largo del dominio."""

    type: Literal["uniform_through_section"] = "uniform_through_section"
    T: Expr


class ThermalProfileLinear(_Base):
    """Gradiente lineal en la seccion. Es lo que permite flexion termica.

    Guardar solo ``T(x)`` media hace imposible modelar curvatura termica, y
    agregarlo despues obliga a tocar el schema y todos los documentos guardados.
    """

    type: Literal["linear_through_section"] = "linear_through_section"
    T_top: Expr
    T_bottom: Expr


ThermalProfile = Annotated[
    Union[ThermalProfileUniform, ThermalProfileLinear], Field(discriminator="type")
]


class ThermalField(_Base):
    kind: Literal["thermal"] = "thermal"
    id: str
    label: str = ""
    T_ref: Expr = "T_ref"
    profile: ThermalProfile


class ScalarSource(_Base):
    """Fuente escalar distribuida sobre el dominio.

    Es la misma idea que :class:`MechanicalLoad` sin direccion: generacion de
    calor por unidad de longitud, densidad lineal de carga o corriente. Comparte
    ``region`` y ``distribution``, asi que hereda gratis todo el catalogo de
    formas -- incluida la puntual, que aca es una carga puntual o una fuente
    concentrada, y la expresion custom.
    """

    kind: Literal["source"] = "source"
    id: str
    label: str = ""
    quantity: Literal["heat_source", "charge_density", "current"]
    region: Region
    distribution: Distribution
    units: str = ""


BodyField = Annotated[
    Union[MechanicalLoad, ThermalField, ScalarSource], Field(discriminator="kind")
]


# --------------------------------------------------------------------------
# Material, analisis, cuerpo
# --------------------------------------------------------------------------

class Constitutive(_Base):
    """Material y seccion. Todo opcional: el modo rigido no necesita nada."""

    E: Expr | None = None
    I: Expr | None = None
    A: Expr | None = None
    #: Coeficiente de dilatacion termica.
    alpha: Expr | None = None
    #: Altura de la seccion, necesaria para la curvatura termica.
    h: Expr | None = None
    k: Expr | None = None          # conductividad termica (Termo)
    rho: Expr | None = None
    #: Permitividad relativa del medio (Electro).
    epsilon_r: Expr | None = None


class CableSpec(_Base):
    """Como se cierra el problema de un cable.

    Un cable no tiene rigidez a flexion: su forma la fija la tension horizontal
    ``H``, que es constante a lo largo del cable pero desconocida. Hace falta
    un dato mas para determinarla, y hay dos formas usuales de darlo: la flecha
    en un punto (lo habitual en un problema de curso) o directamente ``H``.
    """

    #: ``sag`` fija la flecha y despeja H; ``tension`` toma H como dato.
    mode: Literal["sag", "tension"] = "sag"
    #: Flecha: distancia vertical de la cuerda al cable, medida en ``at``.
    sag: Expr | None = "f"
    at: Expr | None = None
    #: Tension horizontal impuesta, si ``mode`` es ``tension``.
    H: Expr | None = None


class Analysis(_Base):
    mode: Literal["rigid", "deformable"] = "rigid"
    dof: Literal["1d_beam", "cable"] = "1d_beam"


#: Cuerpos que no son una curva con carga repartida a lo largo de ``x``.
#:
#: Un disco, una esfera o un bloque no tienen ``q(x)``: tienen radio, lado y
#: masa. El motor no los resuelve -- resolverlos es otra teoria, no la de
#: vigas -- pero el ejercicio del libro los tiene, y hay que poder ponerlos,
#: verlos, medirlos y anotar el procedimiento sobre ellos.
RIGID_SHAPES = frozenset({"disc", "sphere", "block", "rod", "ideal_cable", "spring"})


class ShapeSpec(_Base):
    """Medidas de un cuerpo rigido idealizado.

    Todo opcional: un cable ideal no tiene ni radio ni masa (es
    inextensible, sin peso y de espesor nulo), y un disco no tiene lado.
    """

    #: Radio de un disco, una polea o una esfera.
    radius: Expr | None = None
    #: Alto de un bloque. El ancho es el largo del dominio.
    height: Expr | None = None
    #: Masa del cuerpo. Nula, por definicion, en un cable ideal.
    mass: Expr | None = None
    #: Constante de un resorte.
    stiffness: Expr | None = None


class Body(_Base):
    id: str
    name: str = ""
    type: Literal[
        "beam", "bar", "cable", "charged_line", "wire",
        # Rigidos idealizados: se arman y se anotan, todavia no se resuelven.
        "disc", "sphere", "block", "rod", "ideal_cable", "spring",
    ] = "beam"
    domain: Domain1D = Field(default_factory=Domain1D)
    fields: list[BodyField] = Field(default_factory=list)
    constitutive: Constitutive = Field(default_factory=Constitutive)
    analysis: Analysis = Field(default_factory=Analysis)
    #: Solo para cuerpos tipo cable.
    cable: CableSpec | None = None
    #: Solo para los rigidos idealizados de :data:`RIGID_SHAPES`.
    shape: ShapeSpec | None = None

    @property
    def is_rigid_shape(self) -> bool:
        return self.type in RIGID_SHAPES


# --------------------------------------------------------------------------
# Apoyos: entidades del sistema, ancladas por coordenada PARAMETRICA
# --------------------------------------------------------------------------

class StructuralSupport(_Base):
    """Anclado a ``(body_id, at)`` en coordenada del dominio, nunca a pixeles.

    Si se anclara a la posicion en pantalla, mover el cuerpo en el canvas
    romperia el modelo fisico.
    """

    id: str
    body_id: str
    at: Expr
    type: Literal["pin", "roller", "fixed"] = "roller"
    #: Cota vertical del apoyo. Solo la usan los cables, donde los extremos
    #: pueden estar a distinta altura y eso cambia la forma de la curva.
    elevation: Expr = "0"
    label: str = ""


# --------------------------------------------------------------------------
# Problema
# --------------------------------------------------------------------------

class BoundaryCondition(_Base):
    """Condicion de borde de un campo escalar, anclada por coordenada del dominio.

    Es el analogo termico de :class:`StructuralSupport`: dice que sabemos en un
    extremo del cuerpo. Igual que aquel, se ancla al dominio y no a pixeles.
    """

    id: str
    body_id: str
    at: Expr
    type: Literal["temperature", "flux", "convection", "insulated"] = "temperature"
    #: Temperatura impuesta, flujo impuesto, o temperatura ambiente si es conveccion.
    value: Expr | None = None
    #: Coeficiente de pelicula, solo para conveccion.
    h: Expr | None = None
    label: str = ""


class Probe(_Base):
    """Punto del espacio donde se pide el valor de un campo.

    En Electro es el punto de observacion donde se evalua el potencial y el
    campo electrico. No pertenece a ningun cuerpo: vive en el mundo.
    """

    id: str
    at: tuple[Expr, Expr, Expr] = ("0", "1", "0")
    label: str = ""


class ProblemModel(_Base):
    """Etapa 1: el modelo fisico."""

    module: Literal["statics", "em", "thermo"] = "statics"
    title: str = "Problema sin titulo"
    bodies: list[Body] = Field(default_factory=list)
    supports: list[StructuralSupport] = Field(default_factory=list)
    boundaries: list[BoundaryCondition] = Field(default_factory=list)
    probes: list[Probe] = Field(default_factory=list)

    def body(self, body_id: str) -> Body:
        for b in self.bodies:
            if b.id == body_id:
                return b
        raise KeyError(f"cuerpo desconocido: {body_id}")

    def supports_for(self, body_id: str) -> list[StructuralSupport]:
        return [s for s in self.supports if s.body_id == body_id]

    def boundaries_for(self, body_id: str) -> list[BoundaryCondition]:
        return [b for b in self.boundaries if b.body_id == body_id]

    def free_symbols(self) -> set[str]:
        """Simbolos que el usuario debera valorizar en la etapa 3.

        Se descubren recorriendo el modelo, no se declaran a mano: agregar una
        carga nueva hace aparecer su parametro en la etapa 3 sin pasos extra.
        Los campos ``Literal`` (discriminadores, unidades, etiquetas) se saltan
        porque son texto de esquema, no expresiones.
        """
        params = {b.domain.parameter for b in self.bodies}
        names: set[str] = set()

        def is_literal(annotation: object) -> bool:
            if get_origin(annotation) is Literal:
                return True
            if get_origin(annotation) is Union:
                return any(is_literal(a) for a in get_args(annotation))
            return False

        def scan(node: object) -> None:
            if isinstance(node, str):
                names.update(free_names(node))
            elif isinstance(node, (list, tuple)):
                for item in node:
                    scan(item)
            elif isinstance(node, BaseModel):
                for field_name, value in node.__dict__.items():
                    field_info = type(node).model_fields.get(field_name)
                    if field_info is not None and is_literal(field_info.annotation):
                        continue
                    if field_name in _NON_EXPR_FIELDS:
                        continue
                    scan(value)

        for b in self.bodies:
            scan(b.domain)
            scan(b.fields)
            scan(b.constitutive)
            scan(b.cable)
        for s in self.supports:
            scan(s.at)
            scan(s.elevation)
        for bc in self.boundaries:
            scan(bc.at)
            scan(bc.value)
            scan(bc.h)
        for probe in self.probes:
            scan(probe.at)
        return names - params
