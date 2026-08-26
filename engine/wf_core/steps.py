"""Traza de pasos del razonamiento simbolico.

El "paso a paso" es un requisito de producto, no un extra: si no se instrumenta
desde el principio hay que reconstruirlo a mano en cada rama del solver. Cada
operacion del motor emite un :class:`Step`, y la UI los muestra plegados.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import sympy as sp


@dataclass
class Step:
    """Un paso mostrable del desarrollo."""

    id: str
    title: str
    detail: str = ""
    #: LaTeX del resultado del paso (ecuacion o expresion).
    latex: str = ""
    #: Etiqueta de la operacion, para iconografia en la UI.
    kind: str = "algebra"  # algebra | integrate | solve | substitute | check

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "detail": self.detail,
            "latex": self.latex,
            "kind": self.kind,
        }


@dataclass
class StepTrace:
    """Acumulador ordenado de pasos."""

    steps: list[Step] = field(default_factory=list)

    def add(
        self,
        step_id: str,
        title: str,
        expr: sp.Expr | sp.Eq | str | None = None,
        *,
        detail: str = "",
        kind: str = "algebra",
        lhs: str | None = None,
    ) -> Step:
        if expr is None:
            latex = ""
        elif isinstance(expr, str):
            latex = expr
        else:
            latex = sp.latex(expr)
            if lhs is not None:
                latex = f"{lhs} = {latex}"
        step = Step(id=step_id, title=title, detail=detail, latex=latex, kind=kind)
        self.steps.append(step)
        return step

    def to_list(self) -> list[dict]:
        return [s.to_dict() for s in self.steps]
