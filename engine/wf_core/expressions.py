"""Parseo seguro de expresiones simbolicas provenientes del modelo del usuario.

El modelo guarda TODO como strings simbolicos (``"L/2"``, ``"w0*x/L"``). Los
numeros aparecen recien en la etapa 3 como *bindings*. Este modulo es la unica
puerta de entrada de texto de usuario hacia SymPy.
"""

from __future__ import annotations

import re
from typing import Iterable

import sympy as sp
from sympy.parsing.sympy_parser import parse_expr, standard_transformations

#: Funciones que un usuario puede invocar dentro de una expresion de carga.
ALLOWED_FUNCTIONS: dict[str, object] = {
    "sin": sp.sin, "cos": sp.cos, "tan": sp.tan,
    "asin": sp.asin, "acos": sp.acos, "atan": sp.atan,
    "sinh": sp.sinh, "cosh": sp.cosh, "tanh": sp.tanh,
    "exp": sp.exp, "log": sp.log, "ln": sp.log,
    "sqrt": sp.sqrt, "Abs": sp.Abs, "abs": sp.Abs,
    "pi": sp.pi,
    # OJO: "E" NO se mapea al numero de Euler. En estos modulos "E" es el
    # modulo de Young y aparece en casi todos los modelos; dejarlo como
    # constante hacia que E*I se evaluara como exp(1)*I en silencio.
    # Para la base natural hay que escribir exp(1).
}

_IDENT = re.compile(r"[A-Za-z_][A-Za-z_0-9]*")

#: Un nombre de simbolo valido: letras, digitos y ``_``. Sin dunder ni builtins.
_VALID_SYMBOL = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")


class ExpressionError(ValueError):
    """La expresion no pudo parsearse o usa nombres no permitidos."""


def free_names(text: str) -> set[str]:
    """Identificadores que aparecen en ``text``, sin las funciones permitidas."""
    return {n for n in _IDENT.findall(text) if n not in ALLOWED_FUNCTIONS}


def symbol(name: str, **assumptions: bool) -> sp.Symbol:
    """Crea un simbolo validando el nombre."""
    if not _VALID_SYMBOL.match(name):
        raise ExpressionError(f"nombre de simbolo invalido: {name!r}")
    return sp.Symbol(name, **assumptions)


def parse(text: str | float | int | sp.Expr, *, allowed: Iterable[str] | None = None) -> sp.Expr:
    """Convierte ``text`` en una expresion SymPy.

    ``allowed``, si se pasa, es la lista blanca de simbolos libres admitidos;
    cualquier otro identificador es un error de modelado (tipico: una constante
    que el usuario nunca declaro).
    """
    if isinstance(text, sp.Expr):
        return text
    if isinstance(text, (int, float)):
        return sp.nsimplify(text, rational=True) if isinstance(text, int) else sp.Float(text)

    text = str(text).strip()
    if not text:
        raise ExpressionError("expresion vacia")

    names = free_names(text)
    for name in names:
        if not _VALID_SYMBOL.match(name):
            raise ExpressionError(f"nombre invalido en la expresion: {name!r}")
    if allowed is not None:
        unknown = names - set(allowed)
        if unknown:
            raise ExpressionError(
                "simbolos no declarados en la expresion "
                f"{text!r}: {', '.join(sorted(unknown))}"
            )

    local = dict(ALLOWED_FUNCTIONS)
    for name in names:
        local.setdefault(name, sp.Symbol(name))

    try:
        expr = parse_expr(
            text,
            local_dict=local,
            transformations=standard_transformations,
            evaluate=True,
        )
    except (SyntaxError, TypeError, AttributeError) as exc:  # pragma: no cover - defensivo
        raise ExpressionError(f"no se pudo parsear {text!r}: {exc}") from exc

    if not isinstance(expr, sp.Expr):
        raise ExpressionError(f"{text!r} no es una expresion escalar")
    return expr


def latex(expr: sp.Expr) -> str:
    """LaTeX listo para KaTeX."""
    return sp.latex(expr)
