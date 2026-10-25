"""Caminhos, segredos (.env) e configuração editável (config.json)."""
import json
import os
from pathlib import Path

from dotenv import load_dotenv

RAIZ = Path(__file__).resolve().parent.parent
DATA = RAIZ / "data"
SECRETS = RAIZ / "secrets"
CONFIG = RAIZ / "config.json"
CONFIG_EXEMPLO = RAIZ / "config.example.json"

DATA.mkdir(exist_ok=True)
load_dotenv(RAIZ / ".env")

# Segredos: só lidos aqui, nunca devolvidos pela API nem escritos em log
MEU_NUMERO = os.environ.get("MEU_NUMERO", "")
BRIDGE_TOKEN = os.environ.get("BRIDGE_TOKEN", "")
CORE_PORT = int(os.environ.get("CORE_PORT", 8765))
BRIDGE_URL = f"http://127.0.0.1:{os.environ.get('BRIDGE_PORT', 8766)}"


def _mesclar(base, extra):
    """Completa a config do usuário com chaves novas do exemplo, sem sobrescrever o que ele mudou."""
    for k, v in base.items():
        if k not in extra:
            extra[k] = v
        elif isinstance(v, dict) and isinstance(extra[k], dict):
            _mesclar(v, extra[k])
    return extra


def carregar_config():
    """Lida a cada uso: o que for editado no painel vale na hora, sem reiniciar."""
    exemplo = json.loads(CONFIG_EXEMPLO.read_text(encoding="utf-8"))
    if not CONFIG.exists():
        salvar_config(exemplo)
        return exemplo
    return _mesclar(exemplo, json.loads(CONFIG.read_text(encoding="utf-8")))


def salvar_config(cfg):
    tmp = CONFIG.with_suffix(".tmp")
    tmp.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(CONFIG)
