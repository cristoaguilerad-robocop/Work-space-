"""Traduccion de expresiones SymPy a codigo JavaScript evaluable.

Motivo arquitectonico: la derivacion simbolica es cara y va al backend, pero la
*evaluacion numerica* es barata y tiene que correr en el navegador. Si mover un
slider de la etapa 3 obligara a una ida y vuelta por red, la herramienta se
sentiria lenta aunque el servidor respondiera en 30 ms.

El backend devuelve, junto al LaTeX, el codigo JS de cada funcion. El cliente
lo compila una sola vez y redibuja los diagramas a 60 fps sin tocar la red.
"""

from __future__ import annotations

import sympy as sp
from sympy.printing.jscode import JavascriptCodePrinter

#: Preambulo que el runtime del cliente debe proveer.
JS_RUNTIME = """\
// Funcion de singularidad de Macaulay.
function sf(x, a, n) {
  if (n < 0) return 0;            // deltas: sin contribucion puntual al grafico
  if (x < a) return 0;
  return n === 0 ? 1 : Math.pow(x - a, n);
}
function hv(t) { return t < 0 ? 0 : 1; }
"""


class _Printer(JavascriptCodePrinter):
    """Imprime funciones de singularidad y escalones como llamadas al runtime."""

    def _print_SingularityFunction(self, expr):
        x, a, n = expr.args
        return f"sf({self._print(x)}, {self._print(a)}, {self._print(n)})"

    def _print_Heaviside(self, expr):
        return f"hv({self._print(expr.args[0])})"


def to_js(expr: sp.Expr) -> str:
    return _Printer({"precision": 17, "user_functions": {}}).doprint(sp.sympify(expr))


def compile_function(expr: sp.Expr, variable: sp.Symbol) -> dict:
    """Empaqueta ``expr`` como funcion JS de ``variable`` mas sus parametros.

    ``params`` son los simbolos que la etapa 3 tiene que valorizar; el cliente
    los pasa en el mismo orden.
    """
    expr = sp.sympify(expr)
    params = sorted(
        (s.name for s in expr.free_symbols if s != variable), key=str.lower
    )
    return {
        "variable": variable.name,
        "params": params,
        "source": to_js(expr),
    }


# --------------------------------------------------------------------------
# Serializacion a AST, para entornos donde no se puede compilar codigo
# --------------------------------------------------------------------------

#: Funciones de una expresion que el evaluador del cliente sabe resolver.
_AST_FUNCTIONS = {
    "sin": "sin", "cos": "cos", "tan": "tan",
    "asin": "asin", "acos": "acos", "atan": "atan",
    "sinh": "sinh", "cosh": "cosh", "tanh": "tanh",
    "asinh": "asinh", "acosh": "acosh", "atanh": "atanh",
    "exp": "exp", "log": "log", "Abs": "abs",
}


class UnsupportedNode(TypeError):
    """La expresion tiene un nodo que el AST del cliente no representa."""


def to_ast(expr: sp.Expr) -> object:
    """Serializa una expresion a JSON evaluable sin compilar codigo.

    ``to_js`` produce codigo que hay que pasar por ``new Function``, y hay
    entornos (paginas con Content-Security-Policy estricta) donde eso esta
    prohibido. El mismo arbol serializado se puede recorrer con un interprete
    chico, sin ``eval`` de por medio.

    Formato: los numeros son numeros; ``{"v": nombre}`` es un simbolo;
    ``{"f": op, "a": [...]}`` es una aplicacion.
    """
    e = sp.sympify(expr)

    if e.is_Number or isinstance(e, sp.NumberSymbol):
        return float(e)
    if e.is_Symbol:
        return {"v": e.name}
    if isinstance(e, sp.SingularityFunction):
        return {"f": "sf", "a": [to_ast(arg) for arg in e.args]}
    if isinstance(e, sp.Heaviside):
        return {"f": "hv", "a": [to_ast(e.args[0])]}
    if e.is_Add:
        return {"f": "+", "a": [to_ast(arg) for arg in e.args]}
    if e.is_Mul:
        return {"f": "*", "a": [to_ast(arg) for arg in e.args]}
    if e.is_Pow:
        return {"f": "^", "a": [to_ast(e.base), to_ast(e.exp)]}

    name = type(e).__name__
    if name in _AST_FUNCTIONS:
        return {"f": _AST_FUNCTIONS[name], "a": [to_ast(arg) for arg in e.args]}

    raise UnsupportedNode(f"no se puede serializar {name}: {e}")
