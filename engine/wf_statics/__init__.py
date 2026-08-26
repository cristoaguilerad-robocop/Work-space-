"""Modulo de Estatica: vigas y cables."""

from .beam import BeamSolution, ModelError, solve_beam
from .cable import CableSolution, solve_cable

__all__ = ["BeamSolution", "CableSolution", "ModelError", "solve_beam", "solve_cable"]
