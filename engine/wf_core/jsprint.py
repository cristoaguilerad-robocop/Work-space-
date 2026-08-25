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
