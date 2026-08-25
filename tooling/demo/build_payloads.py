#!/usr/bin/env python3
"""Pre-deriva un set de modelos para la demo estatica publicable.

La demo no puede hablar con Python, asi que la derivacion simbolica se hace
aca, una sola vez, y se congela en JSON. La evaluacion numerica igual corre en
el navegador -- que es como funciona la app real -- asi que la etapa 3 de la
demo es exactamente igual de viva que la de verdad.
"""

from __future__ import annotations

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "engine"), str(ROOT / "apps" / "api")]

from wf_api.service import derive_payload  # noqa: E402

DOWN = {"frame": "global", "vector": ["0", "-1", "0"]}
PINNED = [
    {"id": "A", "body_id": "bar1", "at": "0", "type": "pin"},
    {"id": "B", "body_id": "bar1", "at": "L", "type": "roller"},
]
CANTILEVER = [{"id": "A", "body_id": "bar1", "at": "0", "type": "fixed"}]


def model(title, fields, supports, *, mode="deformable", const=None):
    return {
        "module": "statics",
        "title": title,
        "bodies": [{
            "id": "bar1",
            "name": "Barra",
            "type": "beam",
            "domain": {"parameter": "x", "start": "0", "end": "L"},
            "fields": fields,
            "constitutive": const or {"E": "E", "I": "I"},
            "analysis": {"mode": mode, "dof": "1d_beam"},
        }],
        "supports": supports,
    }


def force(load_id, label, region, distribution, units="N/m"):
    return {
        "kind": "load", "id": load_id, "label": label, "quantity": "force",
        "region": region, "distribution": distribution,
        "direction": DOWN, "units": units,
    }


FULL = {"type": "full"}


def cable(title, fields, right_elevation="0", spec=None):
    return {
        "module": "statics", "title": title,
        "bodies": [{
            "id": "c1", "name": "Cable", "type": "cable",
            "domain": {"parameter": "x", "start": "0", "end": "L"},
            "fields": fields, "constitutive": {},
            "analysis": {"mode": "rigid", "dof": "cable"},
            "cable": spec or {"mode": "sag", "sag": "f", "at": None, "H": None},
        }],
        "supports": [
            {"id": "A", "body_id": "c1", "at": "0", "type": "pin",
             "elevation": "0", "label": ""},
            {"id": "B", "body_id": "c1", "at": "L", "type": "pin",
             "elevation": right_elevation, "label": ""},
        ],
    }


def cable_force(load_id, label, region, distribution, units="N/m"):
    return {"kind": "load", "id": load_id, "label": label, "quantity": "force",
            "region": region, "distribution": distribution,
            "direction": DOWN, "units": units}


def thermo(title, fields, boundaries, const=None):
    return {
        "module": "thermo", "title": title,
        "bodies": [{
            "id": "bar1", "name": "Barra", "type": "bar",
            "domain": {"parameter": "x", "start": "0", "end": "L"},
            "fields": fields,
            "constitutive": const or {"k": "k", "A": "A"},
            "analysis": {"mode": "rigid", "dof": "1d_beam"},
        }],
        "boundaries": boundaries,
    }


def heat(source_id, label, region, distribution, units="W/m"):
    return {"kind": "source", "id": source_id, "label": label, "quantity": "heat_source",
            "region": region, "distribution": distribution, "units": units}


def bc(bc_id, at, kind, value=None, film=None, label=""):
    return {"id": bc_id, "body_id": "bar1", "at": at, "type": kind,
            "value": value, "h": film, "label": label or bc_id}


def em(title, fields, probes, kind="charged_line"):
    return {
        "module": "em", "title": title,
        "bodies": [{
            "id": "l1", "name": "Linea", "type": kind,
            "domain": {"parameter": "x", "start": "0", "end": "L"},
            "fields": fields, "constitutive": {},
            "analysis": {"mode": "rigid", "dof": "1d_beam"},
        }],
        "probes": probes,
    }


def source(source_id, label, quantity, region, distribution, units):
    return {"kind": "source", "id": source_id, "label": label, "quantity": quantity,
            "region": region, "distribution": distribution, "units": units}


POINT = lambda at: {"type": "point", "at": at}
UNIFORM = lambda w: {"type": "uniform", "w": w}


CASES = [
    # ---------------------------------------------------------------- Estatica
    {
        "id": "movil",
        "module": "statics",
        "name": "Carga movil — arrastrable",
        "note": (
            "La posicion de la carga es el simbolo 'a', asi que moverla no cambia el "
            "planteo: solo cambia el valor de 'a'. Arrastrala en el canvas."
        ),
        "draggable": {"field": "P1", "symbol": "a"},
        "model": model(
            "Carga movil",
            [force("P1", "Carga movil", {"type": "point", "at": "a"},
                   {"type": "point", "magnitude": "P"}, units="N")],
            PINNED,
        ),
    },
    {
        "id": "mixta",
        "module": "statics",
        "name": "Triangular + puntual + gradiente termico",
        "note": "Tres tipos de carga distintos sobre el mismo dominio, resueltos por una sola integral.",
        "model": model(
            "Viga simplemente apoyada",
            [
                force("q1", "Carga triangular",
                      {"type": "interval", "start": "0", "end": "L/2"},
                      {"type": "linear", "w_start": "0", "w_end": "w0"}),
                force("P1", "Carga puntual", {"type": "point", "at": "3*L/4"},
                      {"type": "point", "magnitude": "P"}, units="N"),
                {"kind": "thermal", "id": "T1", "label": "Gradiente termico",
                 "T_ref": "T_ref",
                 "profile": {"type": "linear_through_section",
                             "T_top": "T0 + dT", "T_bottom": "T0"}},
            ],
            PINNED,
            const={"E": "E", "I": "I", "A": "A", "alpha": "alpha", "h": "h"},
        ),
    },
    {
        "id": "uniforme", "module": "statics",
        "name": "Uniforme, simplemente apoyada",
        "note": "El caso de referencia: flecha maxima 5 w0 L^4 / (384 E I).",
        "model": model("Uniforme", [force("q1", "Carga uniforme", FULL,
                                          {"type": "uniform", "w": "w0"})], PINNED),
    },
    {
        "id": "voladizo", "module": "statics",
        "name": "Voladizo con carga uniforme",
        "note": "Flecha en punta w0 L^4 / (8 E I), momento de empotramiento w0 L^2 / 2.",
        "model": model("Voladizo", [force("q1", "Carga uniforme", FULL,
                                          {"type": "uniform", "w": "w0"})], CANTILEVER),
    },
    {
        "id": "puntual-centro", "module": "statics",
        "name": "Puntual centrada",
        "note": "Flecha P L^3 / (48 E I). La carga puntual sale de la misma integral que una distribuida.",
        "model": model("Puntual centrada",
                       [force("P1", "Carga puntual", {"type": "point", "at": "L/2"},
                              {"type": "point", "magnitude": "P"}, units="N")], PINNED),
    },
    {
        "id": "trapecio", "module": "statics",
        "name": "Trapezoidal sobre un tramo",
        "note": "Intensidad w0 -> 2 w0 aplicada solo entre L/4 y 3L/4.",
        "model": model("Trapezoidal parcial",
                       [force("q1", "Carga trapezoidal",
                              {"type": "interval", "start": "L/4", "end": "3*L/4"},
                              {"type": "linear", "w_start": "w0", "w_end": "2*w0"})], PINNED),
    },
    {
        "id": "senoidal", "module": "statics",
        "name": "Carga custom w0 sin(pi x / L)",
        "note": "La distribucion puede ser cualquier funcion de x, no solo una forma predefinida.",
        "model": model("Carga senoidal",
                       [force("q1", "w0 sin(pi x / L)", FULL,
                              {"type": "expression", "expr": "w0*sin(pi*x/L)"})], PINNED),
    },
    {
        "id": "par", "module": "statics",
        "name": "Par concentrado en el centro",
        "note": "El momento flector salta de +M0/2 a -M0/2 al pasar por el par.",
        "model": model("Par concentrado",
                       [{"kind": "load", "id": "C1", "label": "Par M0",
                         "quantity": "moment", "region": {"type": "point", "at": "L/2"},
                         "distribution": {"type": "point", "magnitude": "M0"},
                         "direction": DOWN, "units": "N*m"}], PINNED),
    },
    {
        "id": "rigido", "module": "statics",
        "name": "Modo rigido: solo resultantes",
        "note": "El mismo pipeline, detenido dos integraciones antes: resultante, punto de aplicacion y equilibrio.",
        "model": model("Modo rigido",
                       [force("q1", "Carga triangular", FULL,
                              {"type": "linear", "w_start": "0", "w_end": "w0"})],
                       PINNED, mode="rigid", const={}),
    },

    {
        "id": "cable-uniforme", "module": "statics",
        "name": "Cable con carga uniforme",
        "note": "Una viga sin rigidez: la forma la sostiene la tension horizontal. H = w0 L^2 / (8 f).",
        "model": cable("Cable parabolico",
                       [cable_force("q1", "Peso por metro", FULL, {"type": "uniform", "w": "w0"})]),
    },
    {
        "id": "cable-desnivel", "module": "statics",
        "name": "Cable con apoyos desnivelados",
        "note": "La flecha se mide desde la cuerda, no desde la horizontal: con desnivel no son lo mismo.",
        "model": cable("Cable desnivelado",
                       [cable_force("q1", "Peso por metro", FULL, {"type": "uniform", "w": "w0"})],
                       right_elevation="hB"),
    },
    {
        "id": "cable-puntual", "module": "statics",
        "name": "Cable con carga puntual",
        "note": "Sin carga repartida el cable queda en dos rectas y la longitud deja de salir de una sola integral.",
        "model": cable("Cable con puntual",
                       [cable_force("P1", "Carga colgada", {"type": "point", "at": "L/2"},
                                    {"type": "point", "magnitude": "P"}, units="N")]),
    },

    # ------------------------------------------------------------------ Termo
    {
        "id": "pared", "module": "thermo",
        "name": "Pared plana",
        "note": "Sin generacion y con temperatura impuesta en las dos caras: perfil lineal.",
        "model": thermo("Pared plana", [],
                        [bc("I", "0", "temperature", "T1", label="Cara caliente"),
                         bc("D", "L", "temperature", "T2", label="Cara fria")]),
    },
    {
        "id": "generacion", "module": "thermo",
        "name": "Generacion uniforme entre dos caras frias",
        "note": "Perfil parabolico: T_max = T1 + g0 L^2 / (8 k A), en el centro.",
        "model": thermo("Generacion uniforme",
                        [heat("g1", "Generacion", {"type": "full"}, UNIFORM("g0"))],
                        [bc("I", "0", "temperature", "T1"),
                         bc("D", "L", "temperature", "T1")]),
    },
    {
        "id": "conveccion", "module": "thermo",
        "name": "Generacion con conveccion en un extremo",
        "note": "Conduccion y conveccion en serie. El balance global de energia se verifica solo.",
        "model": thermo("Barra con conveccion",
                        [heat("g1", "Generacion", {"type": "full"}, UNIFORM("g0"))],
                        [bc("I", "0", "temperature", "T1"),
                         bc("D", "L", "convection", "T_inf", film="h_c")]),
    },
    {
        "id": "aislado", "module": "thermo",
        "name": "Fuente puntual con un extremo aislado",
        "note": "Una fuente concentrada es una delta: sale de la misma integral que una distribuida.",
        "model": thermo("Fuente puntual",
                        [heat("Q1", "Fuente puntual", POINT("L/2"),
                              {"type": "point", "magnitude": "Q0"}, units="W")],
                        [bc("I", "0", "insulated", label="Aislado"),
                         bc("D", "L", "temperature", "T2")]),
    },

    # ---------------------------------------------------------------- Electro
    {
        "id": "linea", "module": "em",
        "name": "Linea cargada uniforme",
        "note": "El potencial sale en forma cerrada con asinh; el campo se integra en el navegador.",
        "model": em("Linea cargada",
                    [source("lam1", "Densidad de carga", "charge_density",
                            {"type": "full"}, UNIFORM("lam0"), "C/m")],
                    [{"id": "P1", "at": ["L/2", "0.8", "0"], "label": "P1"}]),
    },
    {
        "id": "dipolo", "module": "em",
        "name": "Dos cargas puntuales opuestas",
        "note": "Coulomb directo, sin integrar. El mapa muestra bien el cambio de signo.",
        "model": em("Par de cargas",
                    [source("q1", "Carga +", "charge_density", POINT("L/4"),
                            {"type": "point", "magnitude": "q0"}, "C"),
                     source("q2", "Carga -", "charge_density", POINT("3*L/4"),
                            {"type": "point", "magnitude": "-q0"}, "C")],
                    [{"id": "P1", "at": ["L/2", "0.6", "0"], "label": "P1"}]),
    },
    {
        "id": "densidad-variable", "module": "em",
        "name": "Densidad lineal variable",
        "note": "lambda(x) de 0 a lam0. La carga total y el centroide salen de la misma integral que una viga.",
        "model": em("Densidad variable",
                    [source("lam1", "Densidad 0 -> lam0", "charge_density",
                            {"type": "full"},
                            {"type": "linear", "w_start": "0", "w_end": "lam0"}, "C/m")],
                    [{"id": "P1", "at": ["L/2", "0.8", "0"], "label": "P1"}]),
    },
    {
        "id": "conductor", "module": "em",
        "name": "Conductor recto con corriente",
        "note": "Biot-Savart. B_z tiene forma cerrada, y en el limite de hilo infinito tiende a 2 k_m I / r.",
        "model": em("Conductor recto",
                    [source("I1", "Corriente", "current", {"type": "full"},
                            UNIFORM("I0"), "A")],
                    [{"id": "P1", "at": ["L/2", "0.5", "0"], "label": "P1"}],
                    kind="wire"),
    },
]


def main() -> None:
    out = []
    for case in CASES:
        # emit_ast: la demo evalua recorriendo el arbol, sin compilar codigo.
        payload = derive_payload(json.dumps(case["model"]), emit_ast=True)
        if payload["errors"]:
            raise SystemExit(f"{case['id']}: {payload['errors']}")
        out.append({
            "id": case["id"],
            "module": case.get("module", "statics"),
            "name": case["name"],
            "note": case["note"],
            "draggable": case.get("draggable"),
            "model": case["model"],
            "derived": payload,
        })
        body = payload["bodies"][0]
        print(f"  {case['module']:8s} {case['id']:20s} "
              f"{len(body['equations']):2d} ec  {len(body['steps']):2d} pasos")

    target = ROOT / "tooling" / "demo" / "payloads.json"
    target.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    print(f"\nescrito {target.relative_to(ROOT)} ({target.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
