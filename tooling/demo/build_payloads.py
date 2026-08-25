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


CASES = [
    {
        "id": "mixta",
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
        "id": "uniforme",
        "name": "Uniforme, simplemente apoyada",
        "note": "El caso de referencia: flecha maxima 5 w0 L^4 / (384 E I).",
        "model": model("Uniforme", [force("q1", "Carga uniforme", FULL,
                                          {"type": "uniform", "w": "w0"})], PINNED),
    },
    {
        "id": "voladizo",
        "name": "Voladizo con carga uniforme",
        "note": "Flecha en punta w0 L^4 / (8 E I), momento de empotramiento w0 L^2 / 2.",
        "model": model("Voladizo", [force("q1", "Carga uniforme", FULL,
                                          {"type": "uniform", "w": "w0"})], CANTILEVER),
    },
    {
        "id": "voladizo-punta",
        "name": "Voladizo con carga en punta",
        "note": "Flecha en punta P L^3 / (3 E I).",
        "model": model("Voladizo con puntual",
                       [force("P1", "Carga en punta", {"type": "point", "at": "L"},
                              {"type": "point", "magnitude": "P"}, units="N")],
                       CANTILEVER),
    },
    {
        "id": "puntual-centro",
        "name": "Puntual centrada",
        "note": "Flecha P L^3 / (48 E I). La carga puntual sale de la misma integral que una distribuida.",
        "model": model("Puntual centrada",
                       [force("P1", "Carga puntual", {"type": "point", "at": "L/2"},
                              {"type": "point", "magnitude": "P"}, units="N")], PINNED),
    },
    {
        "id": "trapecio",
        "name": "Trapezoidal sobre un tramo",
        "note": "Intensidad w0 -> 2 w0 aplicada solo entre L/4 y 3L/4.",
        "model": model("Trapezoidal parcial",
                       [force("q1", "Carga trapezoidal",
                              {"type": "interval", "start": "L/4", "end": "3*L/4"},
                              {"type": "linear", "w_start": "w0", "w_end": "2*w0"})], PINNED),
    },
    {
        "id": "senoidal",
        "name": "Carga custom w0 sin(pi x / L)",
        "note": "La distribucion puede ser cualquier funcion de x, no solo una forma predefinida.",
        "model": model("Carga senoidal",
                       [force("q1", "w0 sin(pi x / L)", FULL,
                              {"type": "expression", "expr": "w0*sin(pi*x/L)"})], PINNED),
    },
    {
        "id": "par",
        "name": "Par concentrado en el centro",
        "note": "El momento flector salta de +M0/2 a -M0/2 al pasar por el par.",
        "model": model("Par concentrado",
                       [{"kind": "load", "id": "C1", "label": "Par M0",
                         "quantity": "moment", "region": {"type": "point", "at": "L/2"},
                         "distribution": {"type": "point", "magnitude": "M0"},
                         "direction": DOWN, "units": "N*m"}], PINNED),
    },
    {
        "id": "rigido",
        "name": "Modo rigido: solo resultantes",
        "note": "El mismo pipeline, detenido dos integraciones antes: resultante, punto de aplicacion y equilibrio.",
        "model": model("Modo rigido",
                       [force("q1", "Carga triangular", FULL,
                              {"type": "linear", "w_start": "0", "w_end": "w0"})],
                       PINNED, mode="rigid", const={}),
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
            "name": case["name"],
            "note": case["note"],
            "model": case["model"],
            "derived": payload,
        })
        body = payload["bodies"][0]
        print(f"  {case['id']:16s} {len(body['equations']):2d} ec  "
              f"{len(body['steps']):2d} pasos  "
              f"{', '.join(body['reactions'])}")

    target = ROOT / "tooling" / "demo" / "payloads.json"
    target.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    print(f"\nescrito {target.relative_to(ROOT)} ({target.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
