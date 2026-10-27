"""Acesso à sua conta Google (Gmail e Agenda), somente leitura.

O arquivo do "cliente OAuth" (secrets/google_cliente.json) é baixado uma vez do Google Cloud.
Na primeira conexão o navegador abre para você autorizar; o token fica em secrets/google_token.json
e se renova sozinho. Nada disso vai para o git nem aparece no painel.
"""
import logging
import threading

from google.auth.exceptions import RefreshError
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

from . import db
from .settings import SECRETS

log = logging.getLogger("google")

CLIENTE = SECRETS / "google_cliente.json"
TOKEN = SECRETS / "google_token.json"
ESCOPOS = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/calendar.readonly",
]

_trava = threading.Lock()
_conectando = threading.Event()


def credenciais():
    """Credenciais válidas, renovando se preciso; None se ainda não conectou (ou foi revogado)."""
    with _trava:
        if not TOKEN.exists():
            return None
        cred = Credentials.from_authorized_user_file(str(TOKEN), ESCOPOS)
        if cred.valid:
            return cred
        if cred.expired and cred.refresh_token:
            try:
                cred.refresh(Request())
            except RefreshError as e:
                # Acesso revogado em myaccount.google.com ou token vencido: precisa conectar de novo
                db.evento("erro", "google", f"acesso ao Google expirou, conecte de novo no painel ({e})"[:300])
                TOKEN.unlink(missing_ok=True)
                return None
            TOKEN.write_text(cred.to_json(), encoding="utf-8")
            return cred
        return None


def servico(api, versao):
    cred = credenciais()
    return build(api, versao, credentials=cred, cache_discovery=False) if cred else None


def status():
    conta = None
    if TOKEN.exists():
        conta = db.ler_estado("google_conta")
    return {
        "cliente": CLIENTE.exists(),
        "conectado": TOKEN.exists(),
        "conectando": _conectando.is_set(),
        "conta": conta,
    }


def conectar():
    """Abre o navegador para autorizar. Roda em segundo plano (espera você clicar em "Permitir")."""
    if not CLIENTE.exists():
        raise FileNotFoundError("falta secrets/google_cliente.json")
    if _conectando.is_set():
        return
    _conectando.set()
    threading.Thread(target=_fluxo, name="google-oauth", daemon=True).start()


def _fluxo():
    try:
        fluxo = InstalledAppFlow.from_client_secrets_file(str(CLIENTE), ESCOPOS)
        # Porta aleatória em 127.0.0.1: o Google devolve a autorização direto para este PC
        cred = fluxo.run_local_server(host="127.0.0.1", port=0, open_browser=True, timeout_seconds=300,
                                      authorization_prompt_message="", success_message=(
                                          "Pronto! O assistente já pode ler seu Gmail e sua Agenda. "
                                          "Pode fechar esta aba."))
        if not cred:
            raise TimeoutError("o tempo para autorizar acabou")
        SECRETS.mkdir(exist_ok=True)
        TOKEN.write_text(cred.to_json(), encoding="utf-8")
        perfil = build("gmail", "v1", credentials=cred, cache_discovery=False).users().getProfile(userId="me").execute()
        db.gravar_estado("google_conta", perfil.get("emailAddress", ""))
        db.evento("info", "google", "conta Google conectada")
    except Exception as e:
        log.exception("falha ao conectar o Google")
        db.evento("erro", "google", f"conexão com o Google falhou: {type(e).__name__}: {e}"[:300])
    finally:
        _conectando.clear()


def desconectar():
    TOKEN.unlink(missing_ok=True)
    db.gravar_estado("google_conta", "")
    db.evento("info", "google", "conta Google desconectada")
