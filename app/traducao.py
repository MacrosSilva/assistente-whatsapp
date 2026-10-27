"""Tradução para português dos títulos que chegam em outros idiomas.

Usa o tradutor público do Google (o mesmo do translate.google.com, sem chave): ele também diz
em que idioma o texto estava, então o que já é português passa direto. Se falhar (sem internet,
limite), tenta a IA local (Ollama, a mesma do resumo); se ela também não der, devolve o original:
uma notícia nunca deixa de sair por causa da tradução.
"""
import logging
import time
from concurrent.futures import ThreadPoolExecutor

import httpx

from .settings import carregar_config

log = logging.getLogger("traducao")

URL = "https://translate.googleapis.com/translate_a/single"
PAUSA_LIMITE = 15 * 60  # depois de um "429 Too Many Requests", espera antes de tentar de novo

_pausado_ate = 0


def traduzir(texto, destino="pt"):
    """Devolve (texto em português, idioma de origem), ou (original, None) se não deu."""
    global _pausado_ate
    if time.time() < _pausado_ate:
        return texto, None
    try:
        r = httpx.get(URL, params={"client": "gtx", "sl": "auto", "tl": destino, "dt": "t", "q": texto},
                      timeout=10)
        r.raise_for_status()
        dados = r.json()
        origem = dados[2] if len(dados) > 2 else None
        if origem == destino or not dados[0]:
            return texto, origem
        return "".join(parte[0] for parte in dados[0] if parte and parte[0]).strip() or texto, origem
    except Exception as e:
        if isinstance(e, httpx.HTTPStatusError) and e.response.status_code == 429:
            if time.time() >= _pausado_ate:
                log.warning("tradutor pediu para esperar: pausa de %d min", PAUSA_LIMITE // 60)
            _pausado_ate = time.time() + PAUSA_LIMITE
            return texto, None
        log.warning("tradução falhou: %s", f"{type(e).__name__}: {e}"[:200])
        return texto, None


def traduzir_varios(textos, destino="pt"):
    with ThreadPoolExecutor(max_workers=2) as ex:
        resultados = list(ex.map(lambda t: traduzir(t, destino), textos))
    falhas = [i for i, (_, origem) in enumerate(resultados) if origem is None]
    if falhas and destino == "pt":
        for i, texto in zip(falhas, _com_ollama([textos[i] for i in falhas])):
            if texto:
                resultados[i] = (texto, "ollama")
    return resultados


def _com_ollama(textos):
    """Plano B: traduz todos de uma vez com a IA local. Devolve None para o que não deu."""
    from .modules.resumo import ollama_modelo  # aqui dentro: resumo é um módulo, carregado depois

    cfg = carregar_config().get("resumo", {})
    modelo = ollama_modelo(cfg) if cfg.get("motor") == "ollama" else None
    if not modelo:
        return [None] * len(textos)
    lista = "\n".join(textos)
    try:
        r = httpx.post(f"{cfg['url'].rstrip('/')}/api/generate", timeout=90, json={
            "model": modelo, "stream": False, "keep_alive": "5m", "options": {"temperature": 0},
            "prompt": "Traduza cada título de notícia abaixo para português do Brasil. Responda só com as "
                      "traduções, uma por linha, na mesma ordem, sem numerar nem comentar. Mantenha nomes "
                      "de empresas e produtos. Se um título já estiver em português, repita igual.\n\n" + lista,
        })
        r.raise_for_status()
        linhas = [l.strip(" -•*") for l in r.json().get("response", "").strip().splitlines() if l.strip()]
    except (httpx.HTTPError, ValueError) as e:
        log.warning("tradução pela IA local falhou: %s", type(e).__name__)
        return [None] * len(textos)
    if len(linhas) != len(textos):
        log.warning("IA local devolveu %d linhas para %d títulos; fica o original", len(linhas), len(textos))
        return [None] * len(textos)
    return linhas
