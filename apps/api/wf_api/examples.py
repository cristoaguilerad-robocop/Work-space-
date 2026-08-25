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
    {
        "id": "aleta-conveccion",
        "title": "Termo: barra con generacion y conveccion",
        "description": (
            "Generacion uniforme, temperatura impuesta a la izquierda y conveccion al "
            "ambiente a la derecha. La estructura es la de una viga: dos integraciones "
            "y dos condiciones de borde."
        ),
        "model": {
            "module": "thermo",
            "title": "Barra con generacion",
            "bodies": [{
                "id": "bar1", "name": "Barra", "type": "bar",
                "domain": {"parameter": "x", "start": "0", "end": "L"},
                "fields": [
                    {"kind": "source", "id": "g1", "label": "Generacion",
                     "quantity": "heat_source", "region": {"type": "full"},
                     "distribution": {"type": "uniform", "w": "g0"}, "units": "W/m"},
                ],
                "constitutive": {"k": "k", "A": "A"},
                "analysis": {"mode": "rigid", "dof": "1d_beam"},
            }],
            "boundaries": [
                {"id": "I", "body_id": "bar1", "at": "0", "type": "temperature",
                 "value": "T1", "h": None, "label": "Izquierda"},
                {"id": "D", "body_id": "bar1", "at": "L", "type": "convection",
                 "value": "T_inf", "h": "h_c", "label": "Derecha"},
            ],
        },
    },
    {
        "id": "pared-plana",
        "title": "Termo: pared plana",
        "description": "Sin generacion, temperatura impuesta en ambas caras: perfil lineal.",
        "model": {
            "module": "thermo",
            "title": "Pared plana",
            "bodies": [{
                "id": "bar1", "name": "Pared", "type": "bar",
                "domain": {"parameter": "x", "start": "0", "end": "L"},
                "fields": [],
                "constitutive": {"k": "k", "A": "A"},
                "analysis": {"mode": "rigid", "dof": "1d_beam"},
            }],
            "boundaries": [
                {"id": "I", "body_id": "bar1", "at": "0", "type": "temperature",
                 "value": "T1", "h": None, "label": "Cara caliente"},
                {"id": "D", "body_id": "bar1", "at": "L", "type": "temperature",
                 "value": "T2", "h": None, "label": "Cara fria"},
            ],
        },
    },
    {
        "id": "linea-cargada",
        "title": "Electro: linea cargada uniforme",
        "description": (
            "Densidad lineal constante. El potencial tiene forma cerrada; el campo se "
            "evalua por cuadratura en el navegador para dibujar el mapa."
        ),
        "model": {
            "module": "em",
            "title": "Linea cargada",
            "bodies": [{
                "id": "l1", "name": "Linea", "type": "charged_line",
                "domain": {"parameter": "x", "start": "0", "end": "L"},
                "fields": [
                    {"kind": "source", "id": "lam1", "label": "Densidad de carga",
                     "quantity": "charge_density", "region": {"type": "full"},
                     "distribution": {"type": "uniform", "w": "lam0"}, "units": "C/m"},
                ],
                "constitutive": {},
                "analysis": {"mode": "rigid", "dof": "1d_beam"},
            }],
            "probes": [{"id": "P1", "at": ["L/2", "0.8", "0"], "label": "P1"}],
        },
    },
    {
        "id": "dipolo",
        "title": "Electro: dos cargas puntuales",
        "description": (
            "Dos cargas concentradas de signo opuesto. Salen de la misma maquinaria que "
            "una densidad continua, resueltas exacto por Coulomb."
        ),
        "model": {
            "module": "em",
            "title": "Par de cargas",
            "bodies": [{
                "id": "l1", "name": "Eje", "type": "charged_line",
                "domain": {"parameter": "x", "start": "0", "end": "L"},
                "fields": [
                    {"kind": "source", "id": "q1", "label": "Carga +",
                     "quantity": "charge_density", "region": {"type": "point", "at": "L/4"},
                     "distribution": {"type": "point", "magnitude": "q0"}, "units": "C"},
                    {"kind": "source", "id": "q2", "label": "Carga -",
                     "quantity": "charge_density", "region": {"type": "point", "at": "3*L/4"},
                     "distribution": {"type": "point", "magnitude": "-q0"}, "units": "C"},
                ],
                "constitutive": {},
                "analysis": {"mode": "rigid", "dof": "1d_beam"},
            }],
            "probes": [{"id": "P1", "at": ["L/2", "0.6", "0"], "label": "P1"}],
        },
    },
    {
        "id": "conductor",
        "title": "Electro: conductor con corriente",
        "description": "Biot-Savart sobre un tramo recto. B_z tiene forma cerrada.",
        "model": {
            "module": "em",
            "title": "Conductor recto",
            "bodies": [{
                "id": "w1", "name": "Conductor", "type": "wire",
                "domain": {"parameter": "x", "start": "0", "end": "L"},
                "fields": [
                    {"kind": "source", "id": "I1", "label": "Corriente",
                     "quantity": "current", "region": {"type": "full"},
                     "distribution": {"type": "uniform", "w": "I0"}, "units": "A"},
                ],
                "constitutive": {},
                "analysis": {"mode": "rigid", "dof": "1d_beam"},
            }],
            "probes": [{"id": "P1", "at": ["L/2", "0.5", "0"], "label": "P1"}],
        },
    },
    {
        "id": "cable-uniforme",
        "title": "Cable con carga uniforme",
        "description": (
            "Un cable es una viga sin rigidez: la misma densidad de carga, pero la forma "
            "la sostiene la tension horizontal. H = w0 L^2 / (8 f)."
        ),
        "model": {
            "module": "statics",
            "title": "Cable parabolico",
            "bodies": [{
                "id": "c1", "name": "Cable", "type": "cable",
                "domain": {"parameter": "x", "start": "0", "end": "L"},
                "fields": [
                    {"kind": "load", "id": "q1", "label": "Peso por metro",
                     "quantity": "force", "region": {"type": "full"},
                     "distribution": {"type": "uniform", "w": "w0"},
                     "direction": {"frame": "global", "vector": ["0", "-1", "0"]},
                     "units": "N/m"},
                ],
                "constitutive": {},
                "analysis": {"mode": "rigid", "dof": "cable"},
                "cable": {"mode": "sag", "sag": "f", "at": None, "H": None},
            }],
            "supports": [
                {"id": "A", "body_id": "c1", "at": "0", "type": "pin",
                 "elevation": "0", "label": ""},
                {"id": "B", "body_id": "c1", "at": "L", "type": "pin",
                 "elevation": "0", "label": ""},
            ],
        },
    },
    {
        "id": "cable-desnivel",
        "title": "Cable con apoyos desnivelados",
        "description": (
            "La flecha se mide desde la cuerda, no desde la horizontal: con apoyos a "
            "distinta altura son cosas distintas."
        ),
        "model": {
            "module": "statics",
            "title": "Cable desnivelado",
            "bodies": [{
                "id": "c1", "name": "Cable", "type": "cable",
                "domain": {"parameter": "x", "start": "0", "end": "L"},
                "fields": [
                    {"kind": "load", "id": "q1", "label": "Peso por metro",
                     "quantity": "force", "region": {"type": "full"},
                     "distribution": {"type": "uniform", "w": "w0"},
                     "direction": {"frame": "global", "vector": ["0", "-1", "0"]},
                     "units": "N/m"},
                ],
                "constitutive": {},
                "analysis": {"mode": "rigid", "dof": "cable"},
                "cable": {"mode": "sag", "sag": "f", "at": None, "H": None},
            }],
            "supports": [
                {"id": "A", "body_id": "c1", "at": "0", "type": "pin",
                 "elevation": "0", "label": ""},
                {"id": "B", "body_id": "c1", "at": "L", "type": "pin",
                 "elevation": "hB", "label": ""},
            ],
        },
    },
]
