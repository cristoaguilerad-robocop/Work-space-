"""Capa de calculo: cache por hash de contenido y timeout real.

Dos decisiones que hacen la diferencia entre "en vivo" y "lento":

1. **Cache por hash del contenido.** Volver a una configuracion ya vista --
   deshacer, mover un cuerpo y devolverlo -- no vuelve a derivar nada.
2. **Timeout con cancelacion de verdad.** SymPy no es interrumpible, asi que la
   derivacion corre en un proceso aparte. Si una integral se cuelga se mata el
   proceso; con hilos habria que esperarla igual.
"""

from __future__ import annotations

import atexit
import hashlib
import json
import multiprocessing
from collections import OrderedDict
from concurrent.futures import ProcessPoolExecutor, TimeoutError as FutureTimeout

#: Segundos maximos por derivacion antes de abortar.
DERIVE_TIMEOUT_S = 20.0
_CACHE_SIZE = 128

_cache: "OrderedDict[str, dict]" = OrderedDict()
_pool: ProcessPoolExecutor | None = None


class DeriveTimeout(RuntimeError):
    """La derivacion excedio el presupuesto de tiempo."""


def physics_hash(model: dict) -> str:
    """Hash de lo que afecta al resultado.

    Entra el modelo entero, la ubicacion de los cuerpos incluida: en Electro
    mover una linea cargada cambia el campo en el punto de observacion. Solo
    quedan afuera el titulo y las etiquetas, que son texto para el usuario.
    """
    relevant = {
        "module": model.get("module"),
        "bodies": model.get("bodies", []),
        "supports": model.get("supports", []),
        "boundaries": model.get("boundaries", []),
        "probes": model.get("probes", []),
    }
    blob = json.dumps(relevant, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


def _pool_instance() -> ProcessPoolExecutor:
    """Pool de derivacion, creado con contexto 'spawn'.

    'spawn' y no el 'fork' que Linux usa por defecto: un worker forkeado hereda
    el socket de escucha de uvicorn, asi que si el servidor muere y queda un
    worker vivo, el puerto sigue ocupado por un proceso que ya no atiende nada.
    'spawn' arranca el worker limpio, sin descriptores heredados.
    """
    global _pool
    if _pool is None:
        _pool = ProcessPoolExecutor(
            max_workers=2, mp_context=multiprocessing.get_context("spawn")
        )
    return _pool


def _reset_pool() -> None:
    """Descarta el pool tras un timeout: el worker colgado se va con el."""
    global _pool
    if _pool is not None:
        _pool.shutdown(wait=False, cancel_futures=True)
    _pool = None


def cached_derive(model_json: str, key: str, worker) -> dict:
    """Deriva ``model_json`` con cache y timeout. ``worker`` debe ser picklable."""
    if key in _cache:
        _cache.move_to_end(key)
        return _cache[key]

    future = _pool_instance().submit(worker, model_json)
    try:
        result = future.result(timeout=DERIVE_TIMEOUT_S)
    except FutureTimeout as exc:
        _reset_pool()
        raise DeriveTimeout(
            f"la derivacion simbolica supero {DERIVE_TIMEOUT_S:.0f} s. "
            "Suele pasar con expresiones de carga muy anidadas: proba simplificarlas."
        ) from exc

    _cache[key] = result
    if len(_cache) > _CACHE_SIZE:
        _cache.popitem(last=False)
    return result


def cache_stats() -> dict:
    return {"entries": len(_cache), "capacity": _CACHE_SIZE}


@atexit.register
def _shutdown() -> None:
    """Que no queden workers huerfanos cuando el servidor termina."""
    _reset_pool()
