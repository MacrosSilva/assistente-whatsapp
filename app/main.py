"""Servidor local único (FastAPI): API usada pela ponte do WhatsApp e, depois, pelo painel.

Só escuta em 127.0.0.1. Login e HTTPS entram aqui no futuro (servidor), como uma camada
na frente das rotas /api, sem mudar a lógica.
"""
import hmac
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

from . import bridge, db
from .core import Nucleo
from .settings import BRIDGE_TOKEN, DATA

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(message)s",
    datefmt="%H:%M:%S",
    handlers=[logging.StreamHandler(), logging.FileHandler(DATA / "core.log", encoding="utf-8")],
)
logging.getLogger("httpx").setLevel(logging.WARNING)  # não poluir o log com cada requisição

nucleo = Nucleo()


@asynccontextmanager
async def ciclo_de_vida(app):
    db.iniciar()
    nucleo.iniciar()
    db.evento("info", "nucleo", "núcleo iniciado")
    yield
    nucleo.parar()


app = FastAPI(title="Assistente", lifespan=ciclo_de_vida, docs_url=None, redoc_url=None, openapi_url=None)


class Mensagem(BaseModel):
    texto: str
    recebido_em: int | None = None


@app.post("/api/incoming")
def mensagem_recebida(msg: Mensagem, x_token: str = Header(default="")):
    """A ponte chama aqui quando o número principal escreve. Devolve a resposta."""
    if not hmac.compare_digest(x_token.encode(), BRIDGE_TOKEN.encode()):
        raise HTTPException(401, "não autorizado")
    logging.getLogger("conversa").info("comando recebido (%d caracteres)", len(msg.texto))
    resposta = nucleo.responder(msg.texto)
    if resposta:
        bridge.registrar(resposta, "comando")
    return {"resposta": resposta}


@app.get("/api/status")
def status():
    with db.conexao() as con:
        ultimo = con.execute("SELECT quando, origem, ok FROM envios ORDER BY id DESC LIMIT 1").fetchone()
    return {"whatsapp": bridge.status(), "ultimo_envio": dict(ultimo) if ultimo else None}
