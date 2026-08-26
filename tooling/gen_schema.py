#!/usr/bin/env python3
"""Genera el JSON Schema del modelo a partir de los modelos Pydantic.

El modelo de datos se define UNA sola vez, en ``engine/wf_core/model.py``. Los
tipos de TypeScript se derivan de aca. Definirlo dos veces (una en Python y
otra en TS) garantiza que se desincronicen: este script es lo que lo evita.

Uso:  pnpm gen:types
"""

from __future__ import annotations

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "engine"))

from wf_core.model import ProblemModel  # noqa: E402

OUT = ROOT / "packages" / "schema" / "problem.schema.json"


def require_all_properties(node: object) -> None:
    """Marca como requeridas todas las propiedades de cada definicion.

    El schema en modo serializacion sigue marcando como opcional cualquier
    campo con default, pero ``model_dump_json`` SIEMPRE los emite. Como estos
    tipos describen lo que viaja por la red y lo que se guarda en disco, no lo
    que se puede construir a mano, dejarlos opcionales solo obliga a la UI a
    chequear contra undefined valores que nunca faltan.
    """
    if isinstance(node, dict):
        properties = node.get("properties")
        if isinstance(properties, dict) and node.get("type") == "object":
            node["required"] = sorted(properties)
        for value in node.values():
            require_all_properties(value)
    elif isinstance(node, list):
        for item in node:
            require_all_properties(item)


def main() -> None:
    schema = ProblemModel.model_json_schema(mode="serialization")
    require_all_properties(schema)
    schema["title"] = "ProblemModel"
    schema["$schema"] = "http://json-schema.org/draft-07/schema#"
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(schema, indent=2, ensure_ascii=False) + "\n")
    print(f"escrito {OUT.relative_to(ROOT)} ({len(schema.get('$defs', {}))} definiciones)")


if __name__ == "__main__":
    main()
