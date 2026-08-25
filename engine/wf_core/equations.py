"""Ecuaciones derivadas del modelo (etapa 2).

Los ``id`` se derivan de ids estables del modelo (``R_A``, ``M_bar1``), nunca
de indices posicionales: reordenar las cargas en el canvas no debe invalidar
los parches que el usuario aplico en la etapa 2 ni sus valores de la etapa 3.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import sympy as sp


@dataclass
class Equation:
    id: str
    title: str
    #: Ecuacion o expresion SymPy.
    expr: sp.Expr
    #: Simbolo o texto del lado izquierdo, cuando ``expr`` no es una ``Eq``.
    lhs: str = ""
    #: equilibrium | definition | field | result | check
    role: str = "definition"
    detail: str = ""

    @property
    def latex(self) -> str:
        body = sp.latex(self.expr)
        return f"{self.lhs} = {body}" if self.lhs else body

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "lhs": self.lhs,
            "latex": self.latex,
            "role": self.role,
            "detail": self.detail,
            "sympy": sp.srepr(self.expr),
            "unknowns": sorted(s.name for s in self.expr.free_symbols),
        }


@dataclass
class EquationSet:
    equations: list[Equation] = field(default_factory=list)

    def add(self, *args, **kwargs) -> Equation:
        eq = Equation(*args, **kwargs)
        self.equations.append(eq)
        return eq

    def to_list(self) -> list[dict]:
        return [e.to_dict() for e in self.equations]
