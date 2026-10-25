"""Cliente da ponte Node. O destino é sempre o número principal (a ponte não aceita outro)."""
import httpx

from . import db
from .settings import BRIDGE_TOKEN, BRIDGE_URL

_cabecalho = {"x-token": BRIDGE_TOKEN}


def status():
    try:
        r = httpx.get(f"{BRIDGE_URL}/status", headers=_cabecalho, timeout=5)
        return r.json()
    except httpx.HTTPError:
        return {"status": "ponte_desligada"}


def qr():
    try:
        r = httpx.get(f"{BRIDGE_URL}/qr", headers=_cabecalho, timeout=5)
        return r.json().get("qr") if r.status_code == 200 else None
    except httpx.HTTPError:
        return None


def enviar(texto, origem):
    """Entrega o texto à fila da ponte e registra no histórico. Devolve True se a ponte aceitou.

    Se o WhatsApp estiver caído, a ponte guarda na fila e envia quando reconectar (conta como aceito).
    """
    erro = None
    try:
        r = httpx.post(f"{BRIDGE_URL}/send", headers=_cabecalho, json={"texto": texto}, timeout=10)
        if r.status_code != 202:
            erro = r.json().get("erro", f"HTTP {r.status_code}")
        elif r.json().get("status") != "conectado":
            db.evento("aviso", origem, f"WhatsApp {r.json().get('status')}: mensagem aguardando na fila da ponte")
    except httpx.HTTPError as e:
        erro = f"ponte inacessível ({type(e).__name__})"
    registrar(texto, origem, erro)
    if erro:
        db.evento("erro", origem, f"envio: {erro}")
    return erro is None


def registrar(texto, origem, erro=None):
    """Histórico de tudo que foi para o WhatsApp (inclui respostas a comandos, enviadas pela própria ponte)."""
    with db.conexao() as con:
        con.execute("INSERT INTO envios (quando, origem, texto, ok, erro) VALUES (?,?,?,?,?)",
                    (db.agora(), origem, texto, int(erro is None), erro))
