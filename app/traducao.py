"""Tradução para português dos títulos que chegam em outros idiomas.

Usa o tradutor público do Google (o mesmo do translate.google.com, sem chave): ele também diz
em que idioma o texto estava, então o que já é português passa direto. Se falhar (sem internet,
limite), devolve o original: uma notícia nunca deixa de sair por causa da tradução.
"""
import logging
from concurrent.futures import ThreadPoolExecutor

import httpx

log = logging.getLogger("traducao")

URL = "https://translate.googleapis.com/translate_a/single"


def traduzir(texto, destino="pt"):
    """Devolve (texto em português, idioma de origem), ou (original, None) se não deu."""
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
        log.warning("tradução falhou: %s", f"{type(e).__name__}: {e}"[:200])
        return texto, None


def traduzir_varios(textos, destino="pt"):
    with ThreadPoolExecutor(max_workers=6) as ex:
        return list(ex.map(lambda t: traduzir(t, destino), textos))
