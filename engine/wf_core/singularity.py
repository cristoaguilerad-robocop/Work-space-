"""Algebra de funciones de singularidad (Macaulay) sobre un dominio 1D.

Esta es la pieza que hace que *no exista* un caso especial "carga puntual":
toda carga -- puntual, uniforme, triangular, trapezoidal, polinomica o una
expresion arbitraria -- se normaliza a una unica densidad simbolica ``q(x)``.
A partir de ahi, resultante, centroide, cortante, momento, pendiente y
deflexion salen todos del mismo integrador.

Convenio de ``SingularityFunction(x, a, n)`` de SymPy:

* ``n >= 0`` -> ``(x - a)**n`` si ``x >= a``, si no ``0``
* ``n = -1``  -> delta de Dirac en ``a``
* ``n = -2``  -> derivada de la delta (par concentrado)

La primitiva de una funcion de singularidad se anula para ``x < a``, asi que
integrar desde "la izquierda de todo" no deja constantes de integracion.
"""

from __future__ import annotations

import sympy as sp

SF = sp.SingularityFunction


def _poly_coeffs_about(expr: sp.Expr, x: sp.Symbol, origin: sp.Expr) -> list[sp.Expr] | None:
    """Coeficientes ``c_i`` tales que ``expr = sum c_i * (x - origin)**i``.

    Devuelve ``None`` si ``expr`` no es polinomica en ``x``.
    """
    shifted = sp.expand(sp.sympify(expr).subs(x, x + origin))
    if not shifted.has(x):
        return [shifted]
    try:
        poly = sp.Poly(shifted, x)
    except (sp.PolynomialError, sp.GeneratorsNeeded):
        return None
    # all_coeffs va de mayor a menor grado; lo queremos indexado por potencia.
    return list(reversed(poly.all_coeffs()))


def windowed(expr: sp.Expr, x: sp.Symbol, a: sp.Expr, b: sp.Expr) -> sp.Expr:
    """Restringe ``expr`` al tramo ``[a, b)`` del dominio.

    Si ``expr`` es polinomica en ``x`` el resultado queda escrito en funciones
    de singularidad (integrable en forma cerrada y rapido). Si no lo es, se
    recurre a escalones de Heaviside, que SymPy tambien integra pero mas lento.
    """
    expr = sp.sympify(expr)
    a, b = sp.sympify(a), sp.sympify(b)

    coeffs_a = _poly_coeffs_about(expr, x, a)
    if coeffs_a is None:
        return expr * (sp.Heaviside(x - a) - sp.Heaviside(x - b))

    coeffs_b = _poly_coeffs_about(expr, x, b)
    assert coeffs_b is not None  # mismo polinomio, otro origen

    head = sum((c * SF(x, a, i) for i, c in enumerate(coeffs_a)), sp.S.Zero)
    tail = sum((c * SF(x, b, i) for i, c in enumerate(coeffs_b)), sp.S.Zero)
    return head - tail


def point_term(magnitude: sp.Expr, x: sp.Symbol, at: sp.Expr) -> sp.Expr:
    """Fuerza concentrada ``magnitude`` en ``x = at`` como densidad."""
    return sp.sympify(magnitude) * SF(x, sp.sympify(at), -1)


def couple_term(magnitude: sp.Expr, x: sp.Symbol, at: sp.Expr) -> sp.Expr:
    """Par concentrado ``magnitude`` (antihorario, +z) en ``x = at``.

    El signo negativo no es arbitrario: con ``dV/dx = q`` y ``dM/dx = V``, un
    termino ``C * SF(x, a, -2)`` produce un salto ``+C`` en el momento interno
    aguas abajo de ``a``. Un par antihorario ``M0`` aplicado deja el momento
    flector en ``M0`` a su izquierda y en ``0`` a su derecha, es decir un salto
    de ``-M0``. De ahi ``C = -M0``.
    """
    return -sp.sympify(magnitude) * SF(x, sp.sympify(at), -2)


def resolve_piecewise(expr: sp.Expr) -> sp.Expr:
    """Elimina las ramas degeneradas que SymPy agrega al integrar.

    ``integrate(sin(pi*x/L), x)`` devuelve un ``Piecewise`` que se cubre del
    caso ``pi/L = 0``, es decir de una barra de longitud infinita. En un modelo
    fisico los simbolos de geometria son positivos y finitos, asi que se elige
    la rama generica. Sin esto la expresion no se puede imprimir a JavaScript.
    """
    def _pick(node: sp.Expr) -> sp.Expr:
        subs = {sym: sp.Dummy(positive=True, finite=True) for sym in node.free_symbols}
        for value, condition in node.args:
            if condition is sp.true:
                return value
            probe = sp.simplify(condition.subs(subs))
            if probe is sp.true or probe == True:  # noqa: E712 - SymPy Boolean
                return value
        return node

    return sp.sympify(expr).replace(lambda n: isinstance(n, sp.Piecewise), _pick)


def _integrate_term(term: sp.Expr, x: sp.Symbol) -> sp.Expr:
    """Primitiva de un termino que se anula a la izquierda de su soporte."""
    heavisides = [f for f in sp.Mul.make_args(term) if isinstance(f, sp.Heaviside)]

    if len(heavisides) != 1:
        # Funciones de singularidad y terminos lisos: SymPy los integra directo.
        return resolve_piecewise(sp.integrate(term, x))

    # Un termino ventaneado g(x)*H(x - c). Integrar el producto contra el
    # escalon manda a SymPy a funciones de Meijer G, que ademas de lentas no
    # se pueden imprimir a JavaScript. La primitiva correcta es elemental:
    #
    #     int_0^x g(s) H(s - c) ds = (G(x) - G(c)) * H(x - c)
    #
    # Se integra g sola y se vuelve a aplicar la ventana. Ademas el resultado
    # tiene otra vez la forma g*H, asi que integrar de nuevo funciona igual.
    step = heavisides[0]
    inner = sp.solve(step.args[0], x)
    if len(inner) != 1:  # pragma: no cover - defensivo
        return resolve_piecewise(sp.integrate(term, x))
    c = inner[0]

    g = sp.Mul(*[f for f in sp.Mul.make_args(term) if f is not step])
    G = resolve_piecewise(sp.integrate(g, x))
    return sp.expand((G - G.subs(x, c)) * step)


def antiderivative(expr: sp.Expr, x: sp.Symbol) -> sp.Expr:
    """Primitiva que se anula a la izquierda de todo el dominio.

    Integrar termino a termino evita que SymPy intente reordenar la expresion
    completa, que es donde se cuelga con modelos grandes.
    """
    terms = sp.Add.make_args(sp.expand(expr))
    return sp.Add(*[_integrate_term(t, x) for t in terms])


def activate(expr: sp.Expr, x: sp.Symbol, at: sp.Expr) -> sp.Expr:
    """Evalua ``expr`` en ``x = at`` asumiendo que ``at`` esta a la derecha de
    todos los origenes de singularidad del dominio.

    Es la forma de evaluar en el extremo del cuerpo sin que SymPy quede
    bloqueado tratando de decidir el signo de ``L - a`` con ``a`` simbolico.
    El invariante "toda carga vive dentro de ``[0, L]``" lo valida el modelo
    antes de llegar aca.

    Los terminos singulares (``n < 0``) se evaluan a ``0``: una delta o un par
    concentrado no aportan al *valor* de la funcion en un punto distinto de su
    ubicacion, y en el extremo del dominio es justo lo que corresponde para las
    ecuaciones de equilibrio.
    """
    at = sp.sympify(at)

    def _sf(node: sp.Expr) -> sp.Expr:
        _, origin, order = node.args
        if order.is_number and order < 0:
            return sp.S.Zero
        return (at - origin) ** order

    out = sp.sympify(expr).replace(lambda n: isinstance(n, SF), _sf)
    out = out.replace(lambda n: isinstance(n, sp.Heaviside), lambda n: sp.S.One)
    # Los terminos sin singularidad (tipico: el aporte termico, que es una
    # expresion lisa del parametro) todavia tienen la variable libre.
    return sp.expand(out.subs(x, at))


def _positive_sign(expr: sp.Expr) -> int | None:
    """Signo de ``expr`` asumiendo que los simbolos de geometria son positivos.

    Las posiciones dentro de un cuerpo son expresiones monomicas simples de la
    longitud (``0``, ``L/2``, ``3*L/4``, ``L``), asi que sustituir los simbolos
    libres por positivos resuelve el signo en todos los casos realistas. Si aun
    asi queda indeterminado devuelve ``None`` y el llamador decide.
    """
    expr = sp.simplify(expr)
    if expr.is_zero:
        return 0
    subs = {s: sp.Dummy(positive=True) for s in expr.free_symbols}
    probe = sp.simplify(expr.subs(subs))
    if probe.is_positive:
        return 1
    if probe.is_negative:
        return -1
    return None


def evaluate_at(expr: sp.Expr, x: sp.Symbol, at: sp.Expr) -> sp.Expr:
    """Evalua ``expr`` en un punto interior arbitrario del dominio.

    A diferencia de :func:`activate`, aca hay que decidir para cada termino si
    el punto esta a la derecha de su origen. Es lo que hacen falta para imponer
    condiciones de borde en apoyos intermedios.
    """
    at = sp.sympify(at)

    def _sf(node: sp.Expr) -> sp.Expr:
        _, origin, order = node.args
        sign = _positive_sign(at - origin)
        if sign is None:
            return node.func(at, origin, order)  # sin resolver: lo arrastra SymPy
        if sign < 0:
            return sp.S.Zero
        if order.is_number and order < 0:
            return sp.S.Zero
        if sign == 0:
            return sp.S.One if order == 0 else sp.S.Zero
        return (at - origin) ** order

    def _hv(node: sp.Expr) -> sp.Expr:
        sign = _positive_sign(node.args[0].subs(x, at))
        if sign is None:
            return node
        return sp.S.One if sign > 0 else sp.S.Zero

    out = sp.sympify(expr).replace(lambda n: isinstance(n, SF), _sf)
    out = out.replace(lambda n: isinstance(n, sp.Heaviside), _hv)
    return sp.expand(out.subs(x, at))


def interior_form(expr: sp.Expr, x: sp.Symbol, start: sp.Expr, end: sp.Expr) -> sp.Expr | None:
    """Forma polinomica de ``expr`` valida en el interior de ``(start, end)``.

    Muchas integrales -- la longitud de un cable, por ejemplo -- no se pueden
    calcular contra funciones de singularidad, pero si contra el polinomio
    equivalente dentro del dominio. Un termino con origen en el extremo
    izquierdo esta siempre activo y uno con origen en el derecho nunca lo esta.

    Devuelve ``None`` si hay origenes **interiores**: ahi la expresion es
    genuinamente partida y no existe una sola forma polinomica que la
    represente. El llamador decide que hacer con eso.
    """
    expr = sp.sympify(expr)
    start, end = sp.sympify(start), sp.sympify(end)

    for node in expr.atoms(SF):
        origin = node.args[1]
        if _positive_sign(origin - start) in (0, -1):
            continue
        if _positive_sign(origin - end) in (0, 1):
            continue
        return None

    def _sf(node: sp.Expr) -> sp.Expr:
        _, origin, order = node.args
        if _positive_sign(origin - end) in (0, 1):
            return sp.S.Zero
        if order.is_number and order < 0:
            return sp.S.Zero
        return (x - origin) ** order

    return sp.expand(expr.replace(lambda n: isinstance(n, SF), _sf))


def integrate_positive(expr: sp.Expr, x: sp.Symbol, start: sp.Expr, end: sp.Expr):
    """Integra declarando positivos los simbolos de geometria.

    Sin esa suposicion SymPy no resuelve integrales como ``sqrt(1 + y'^2)``:
    tiene que cubrirse de longitudes negativas que en un modelo fisico no
    existen. Devuelve ``None`` si aun asi no sale.
    """
    free = {s for s in expr.free_symbols if s != x}
    forward = {s: sp.Dummy(s.name, positive=True) for s in free}
    backward = {d: s for s, d in forward.items()}

    try:
        result = sp.integrate(
            expr.subs(forward), (x, sp.sympify(start).subs(forward), sp.sympify(end).subs(forward))
        )
    except Exception:  # pragma: no cover - SymPy falla de muchas formas
        return None

    result = resolve_piecewise(result)
    if result.has(sp.Integral) or result.has(sp.Piecewise):
        return None
    return sp.simplify(result.subs(backward))
