"""Servidor local único (FastAPI): painel + API usada pela ponte do WhatsApp.

Só escuta em 127.0.0.1. Login e HTTPS entram aqui no futuro (servidor), como uma camada
na frente das rotas, sem mudar a lógica (ver `protecao_local`).
"""
import hmac
import logging
import re
from contextlib import asynccontextmanager
from datetime import time

from fastapi import Body, FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import bridge, db
from .core import Nucleo
from .settings import BRIDGE_TOKEN, CORE_PORT, DATA, RAIZ, carregar_config, salvar_config

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(message)s",
    datefmt="%H:%M:%S",
    handlers=[logging.StreamHandler(), logging.FileHandler(DATA / "core.log", encoding="utf-8")],
)
logging.getLogger("httpx").setLevel(logging.WARNING)  # não poluir o log com cada requisição

WEB = RAIZ / "app" / "web"
HOSTS_PERMITIDOS = {f"127.0.0.1:{CORE_PORT}", f"localhost:{CORE_PORT}"}
ORIGENS_PERMITIDAS = {f"http://{h}" for h in HOSTS_PERMITIDOS}

nucleo = Nucleo()


@asynccontextmanager
async def ciclo_de_vida(app):
    db.iniciar()
    nucleo.iniciar()
    db.evento("info", "nucleo", "núcleo iniciado")
    yield
    nucleo.parar()


app = FastAPI(title="Assistente", lifespan=ciclo_de_vida, docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def protecao_local(request: Request, chamar):
    """Sem login por enquanto, então o servidor se protege de outros sites abertos no navegador:
    - Host precisa ser 127.0.0.1/localhost (bloqueia "DNS rebinding");
    - ações (POST/PUT) exigem o cabeçalho X-Painel e, se houver Origin, que seja o próprio painel
      (outro site não consegue mandar esse cabeçalho sem permissão de CORS, que não damos).
    No futuro servidor, o login entra aqui."""
    if request.headers.get("host") not in HOSTS_PERMITIDOS:
        return JSONResponse({"erro": "host não permitido"}, status_code=403)
    if request.method not in ("GET", "HEAD") and request.url.path != "/api/incoming":
        origem = request.headers.get("origin")
        if request.headers.get("x-painel") != "1" or (origem and origem not in ORIGENS_PERMITIDAS):
            return JSONResponse({"erro": "requisição recusada"}, status_code=403)
    resposta = await chamar(request)
    resposta.headers["X-Frame-Options"] = "DENY"
    resposta.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'")
    resposta.headers["Cache-Control"] = "no-store"
    return resposta


# ---------- ponte do WhatsApp ----------
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


# ---------- painel ----------
@app.get("/")
def painel():
    return FileResponse(WEB / "index.html")


app.mount("/web", StaticFiles(directory=WEB), name="web")


@app.get("/api/status")
def status():
    cfg = carregar_config()
    with db.conexao() as con:
        ultimo = con.execute("SELECT quando, origem, ok, erro FROM envios WHERE origem != 'comando' "
                             "ORDER BY id DESC LIMIT 1").fetchone()
    return {
        "whatsapp": bridge.status(),
        "ultimo_envio": dict(ultimo) if ultimo else None,
        "ultima_leitura": db.ler_estado("noticias_ultima_leitura"),
        "modulos": nucleo.lista_modulos(cfg),
    }


@app.get("/api/qr")
def qr():
    """O QR só existe enquanto a sessão do WhatsApp precisa ser (re)conectada."""
    imagem = bridge.qr()
    if not imagem:
        raise HTTPException(404, "a sessão não precisa de QR agora")
    return {"qr": imagem}


@app.post("/api/acoes/teste")
def mensagem_teste():
    ok = bridge.enviar("✅ Mensagem de teste enviada pelo painel.", "painel")
    return {"ok": ok}


@app.post("/api/acoes/agora")
def enviar_agora():
    return {"enviados": nucleo.enviar_agora()}


@app.post("/api/modulos/{nome}")
def ligar_modulo(nome: str, ativo: bool = Body(embed=True)):
    if nome not in nucleo.modulos:
        raise HTTPException(404, "módulo inexistente")
    cfg = carregar_config()
    cfg["modulos_ativos"][nome] = ativo
    salvar_config(cfg)
    db.evento("info", "painel", f"módulo {nome} {'ligado' if ativo else 'desligado'}")
    return {"ok": True}


@app.get("/api/config")
def ler_config():
    # config.json não tem segredos (eles ficam no .env, que o painel nunca lê)
    return carregar_config()


@app.put("/api/config")
def gravar_config(novo: dict = Body(...)):
    atual = carregar_config()
    erro = _validar(novo, atual)
    if erro:
        raise HTTPException(400, erro)
    salvar_config(novo)
    db.evento("info", "painel", "configurações salvas")
    return {"ok": True}


def _validar(novo, modelo, caminho=""):
    """Confere que cada valor tem o mesmo tipo do atual e que horários/URLs/números fazem sentido."""
    if set(modelo) - set(novo):
        return f"faltam campos em {caminho or 'configuração'}"
    for chave, ref in modelo.items():
        valor, onde = novo[chave], f"{caminho}{chave}"
        if isinstance(ref, bool):
            if not isinstance(valor, bool):
                return f"{onde}: tipo inválido"
        elif isinstance(ref, (int, float)):
            if isinstance(valor, bool) or not isinstance(valor, (int, float)):
                return f"{onde}: precisa ser um número"
            if valor < 0:
                return f"{onde}: não pode ser negativo"
        elif isinstance(ref, str):
            if not isinstance(valor, str):
                return f"{onde}: tipo inválido"
            if re.fullmatch(r"\d\d:\d\d", ref):
                try:
                    time.fromisoformat(valor)
                except ValueError:
                    return f"{onde}: horário inválido (use HH:MM)"
        elif isinstance(ref, dict):
            if not isinstance(valor, dict):
                return f"{onde}: tipo inválido"
            if erro := _validar(valor, ref, f"{onde}."):
                return erro
        elif isinstance(ref, list):
            if not isinstance(valor, list):
                return f"{onde}: tipo inválido"
            for item in valor:
                if isinstance(item, dict) and "url" in item and not str(item["url"]).startswith(("http://", "https://")):
                    return f"{onde}: URL inválida ({item.get('nome') or item['url']})"
    for chave in ("leitura_min", "intervalo_min", "max_itens_por_mensagem", "max_mensagens_por_hora"):
        if chave in novo and novo[chave] < 1:
            return f"{caminho}{chave}: precisa ser pelo menos 1"
    return None


@app.get("/api/historico")
def historico():
    with db.conexao() as con:
        envios = [dict(r) for r in con.execute(
            "SELECT quando, origem, ok, erro, substr(texto, 1, 300) AS texto FROM envios ORDER BY id DESC LIMIT 60")]
        eventos = [dict(r) for r in con.execute(
            "SELECT quando, nivel, origem, mensagem FROM eventos ORDER BY id DESC LIMIT 60")]
    return {"envios": envios, "eventos": eventos}
