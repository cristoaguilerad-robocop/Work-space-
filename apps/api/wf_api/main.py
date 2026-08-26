"""API HTTP del Workspace Funcional.

Capa deliberadamente delgada: aca no vive fisica. Todo el conocimiento esta en
``engine/``, que es una libreria Python pura. Si manana se decide correr el
motor en el navegador con Pyodide, se empaqueta el mismo wheel y esta capa
desaparece sin tocar una sola formula.
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from wf_core.jsprint import JS_RUNTIME
from wf_core.model import ProblemModel

from .compute import DeriveTimeout, cache_stats, cached_derive, physics_hash
from .examples import EXAMPLES
from .service import derive_payload

app = FastAPI(
    title="Workspace Funcional API",
    version="0.1.0",
    description="Derivacion simbolica de problemas de mecanica, electro y termo.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class DeriveRequest(BaseModel):
    model: ProblemModel = Field(description="Modelo de la etapa 1")


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "cache": cache_stats()}


@app.get("/api/runtime.js")
def runtime() -> dict:
    """Preambulo JS que el cliente necesita para evaluar las funciones."""
    return {"source": JS_RUNTIME}


@app.get("/api/examples")
def examples() -> dict:
    """Los ejemplos, normalizados contra el esquema antes de salir.

    Los diccionarios de ``examples.py`` se escriben a mano y solo llevan lo que
    cada caso necesita: los de Estatica no mencionan ``boundaries`` ni
    ``probes``. Devolverlos crudos deja al cliente con campos ausentes donde el
    tipo promete listas. Pasarlos por el modelo los completa, y de paso los
    valida: un ejemplo mal escrito falla aca y no en la pagina.
    """
    return {
        "examples": [
            {**example, "model": ProblemModel.model_validate(example["model"]).model_dump(mode="json")}
            for example in EXAMPLES
        ]
    }


@app.post("/api/derive")
def derive(request: DeriveRequest) -> dict:
    """Etapa 1 -> etapa 2: ecuaciones, pasos y funciones compiladas.

    No devuelve numeros: la etapa 3 evalua en el cliente con las funciones JS
    que vienen en la respuesta, para que mover un valor sea instantaneo.
    """
    model_json = request.model.model_dump_json()
    key = physics_hash(request.model.model_dump(mode="json"))
    try:
        payload = cached_derive(model_json, key, derive_payload)
    except DeriveTimeout as exc:
        raise HTTPException(status_code=504, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"model_hash": key, **payload}
