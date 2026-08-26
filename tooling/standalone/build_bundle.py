"""Precalcula lo que la pagina publicada lleva adentro.

La app publicada como archivo unico no tiene backend. Lo que igual tiene que
funcionar ahi es armar, mover, ver en 3D y escribir: nada de eso necesita
motor, porque el canvas dibuja el MODELO. Lo que si necesita motor son los
resultados, asi que los ejemplos viajan ya derivados, indexados por la
identidad fisica del modelo -- la misma clave que calcula el cliente.

``emit_ast``: la pagina corre con una CSP que prohibe compilar codigo, asi que
las funciones viajan tambien como arbol y se evaluan recorriendolo.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "engine"), str(ROOT / "apps" / "api")]

from wf_api.examples import EXAMPLES  # noqa: E402
from wf_api.service import derive_payload  # noqa: E402
from wf_core.model import ProblemModel  # noqa: E402


def stable_key(value) -> str:
    """El espejo de `stableKey` en apps/web/src/lib/physicskey.ts.

    Las claves van ordenadas y los numeros se escriben como los escribe
    JavaScript (``3.0`` es ``3``): si las dos cadenas no coinciden al byte, el
    navegador no encuentra el resultado precalculado.
    """
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return str(int(value)) if value.is_integer() else repr(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(stable_key(v) for v in value) + "]"
    if isinstance(value, dict):
        items = sorted((k, v) for k, v in value.items() if v is not None or True)
        return "{" + ",".join(
            f"{json.dumps(k, ensure_ascii=False)}:{stable_key(v)}" for k, v in items
        ) + "}"
    raise TypeError(f"no se puede serializar {type(value).__name__}")


def physics_key(model: dict) -> str:
    return stable_key({
        "module": model.get("module"),
        "bodies": model.get("bodies"),
        "supports": model.get("supports"),
        "boundaries": model.get("boundaries"),
        "probes": model.get("probes"),
    })


def main() -> None:
    examples = []
    derived: dict[str, dict] = {}

    for example in EXAMPLES:
        # Normalizado contra el esquema, igual que /api/examples: los ejemplos
        # se escriben a mano y omiten campos que el cliente espera como listas.
        model = ProblemModel.model_validate(example["model"]).model_dump(mode="json")
        payload = derive_payload(json.dumps(model), emit_ast=True)
        if payload["errors"]:
            raise SystemExit(f"{example['id']}: {payload['errors']}")

        examples.append({**example, "model": model})
        derived[physics_key(model)] = payload
        print(f"  {model['module']:8s} {example['id']:28s} "
              f"{len(json.dumps(payload)) // 1024:4d} KB")

    out = ROOT / "tooling" / "standalone" / "bundle.json"
    out.write_text(json.dumps(
        {"examples": examples, "derived": derived},
        ensure_ascii=False, separators=(",", ":"),
    ))
    print(f"\nescrito {out.relative_to(ROOT)} ({out.stat().st_size // 1024} KB, "
          f"{len(examples)} ejemplos)")


if __name__ == "__main__":
    main()
