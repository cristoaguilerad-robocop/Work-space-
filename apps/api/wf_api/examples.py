"""Problemas semilla: dan algo que mirar sin tener que modelar desde cero."""

from __future__ import annotations

EXAMPLES: list[dict] = [
    {
        "id": "viga-mixta",
        "title": "Viga simplemente apoyada: triangular + puntual + gradiente termico",
        "description": (
            "El caso de aceptacion del proyecto. Tres tipos de carga distintos sobre el "
            "mismo dominio, resueltos por una sola integral."
        ),
        "model": {
            "module": "statics",
            "title": "Viga simplemente apoyada",
            "bodies": [{
                "id": "bar1",
                "name": "Barra principal",
                "type": "beam",
                "domain": {"parameter": "x", "start": "0", "end": "L"},
                "fields": [
                    {"kind": "load", "id": "q1", "label": "Carga triangular",
                     "quantity": "force",
                     "region": {"type": "interval", "start": "0", "end": "L/2"},
                     "distribution": {"type": "linear", "w_start": "0", "w_end": "w0"},
                     "direction": {"frame": "global", "vector": ["0", "-1", "0"]},
                     "units": "N/m"},
                    {"kind": "load", "id": "P1", "label": "Carga puntual",
                     "quantity": "force",
                     "region": {"type": "point", "at": "3*L/4"},
                     "distribution": {"type": "point", "magnitude": "P"},
                     "direction": {"frame": "global", "vector": ["0", "-1", "0"]},
                     "units": "N"},
                    {"kind": "thermal", "id": "T1", "label": "Gradiente termico",
                     "T_ref": "T_ref",
                     "profile": {"type": "linear_through_section",
                                 "T_top": "T0 + dT", "T_bottom": "T0"}},
                ],
                "constitutive": {"E": "E", "I": "I", "A": "A", "alpha": "alpha", "h": "h"},
                "analysis": {"mode": "deformable", "dof": "1d_beam"},
            }],
            "supports": [
                {"id": "A", "body_id": "bar1", "at": "0", "type": "pin"},
                {"id": "B", "body_id": "bar1", "at": "L", "type": "roller"},
            ],
        },
    },
    {
        "id": "voladizo",
        "title": "Voladizo con carga uniforme",
        "description": "El clasico: delta = w0 L^4 / (8 E I).",
        "model": {
            "module": "statics",
            "title": "Voladizo",
            "bodies": [{
                "id": "bar1", "name": "Voladizo", "type": "beam",
                "domain": {"parameter": "x", "start": "0", "end": "L"},
                "fields": [
                    {"kind": "load", "id": "q1", "label": "Carga uniforme",
                     "quantity": "force", "region": {"type": "full"},
                     "distribution": {"type": "uniform", "w": "w0"},
                     "direction": {"frame": "global", "vector": ["0", "-1", "0"]},
                     "units": "N/m"},
                ],
                "constitutive": {"E": "E", "I": "I"},
                "analysis": {"mode": "deformable", "dof": "1d_beam"},
            }],
            "supports": [{"id": "A", "body_id": "bar1", "at": "0", "type": "fixed"}],
        },
    },
    {
        "id": "carga-custom",
        "title": "Carga senoidal definida por el usuario",
        "description": (
            "Muestra que la distribucion puede ser una funcion arbitraria de x, no solo "
            "una de las formas predefinidas."
        ),
        "model": {
            "module": "statics",
            "title": "Carga custom",
            "bodies": [{
                "id": "bar1", "name": "Barra", "type": "beam",
                "domain": {"parameter": "x", "start": "0", "end": "L"},
                "fields": [
                    {"kind": "load", "id": "q1", "label": "w0*sin(pi*x/L)",
                     "quantity": "force", "region": {"type": "full"},
                     "distribution": {"type": "expression", "expr": "w0*sin(pi*x/L)"},
                     "direction": {"frame": "global", "vector": ["0", "-1", "0"]},
                     "units": "N/m"},
                ],
                "constitutive": {"E": "E", "I": "I"},
                "analysis": {"mode": "deformable", "dof": "1d_beam"},
            }],
            "supports": [
                {"id": "A", "body_id": "bar1", "at": "0", "type": "pin"},
                {"id": "B", "body_id": "bar1", "at": "L", "type": "roller"},
            ],
        },
    },
]
