"""Resumo sob demanda do que já chegou no WhatsApp, escrito por uma IA que roda no seu PC (Ollama).

"resumo de 14h até 18h", "resumo das 9 às 12", "resumo ontem", "resumo últimas 3 horas", "resumo".
Nada sai do PC: o texto vai só para o Ollama em 127.0.0.1. Se o Ollama estiver desligado, sai
um resumo simples (contagem e títulos), sem IA.
"""
import logging
import re
from datetime import datetime, timedelta

import httpx

from .. import db
from .base import Module

log = logging.getLogger("resumo")

CABECALHO = "🧠 *Resumo"
LIMITE_TEXTO = 12000  # caracteres enviados à IA (cabe folgado num modelo pequeno)
PROMPT = """Você é um assistente pessoal. Abaixo estão as mensagens que eu recebi no WhatsApp \
entre {de} e {ate}: notícias de tecnologia, e-mails e lembretes da agenda.

Escreva um resumo em português do Brasil, para ler no celular:
- no máximo 10 tópicos curtos (uma linha cada), começando por "• ";
- agrupe por assunto (IA, segurança, programação, e-mails, agenda) e junte notícias sobre o mesmo fato;
- primeiro o que for urgente ou exigir ação minha;
- use só o que está nas mensagens: não invente nada, não inclua links;
- responda só com os tópicos, sem introdução nem conclusão.

MENSAGENS:
{texto}"""


def periodo(args, agora=None):
    """Entende o pedido e devolve (início, fim). Sem horário: o dia de hoje até agora."""
    agora = agora or datetime.now()
    t = args.lower()
    if m := re.search(r"ultim\w*\s+(\d+)\s*h", t):
        return agora - timedelta(hours=int(m.group(1))), agora
    if re.search(r"ultima hora", t):
        return agora - timedelta(hours=1), agora
    dia = agora.replace(hour=0, minute=0, second=0, microsecond=0)
    if "ontem" in t:
        dia -= timedelta(days=1)
    horas = [(int(h), int(mi or 0)) for h, mi in re.findall(r"\b(\d{1,2})(?!\d)(?:\s*[h:]\s*(\d{2})?)?", t)
             if int(h) < 24 and int(mi or 0) < 60]
    if not horas:
        return dia, (dia + timedelta(days=1) if "ontem" in t else agora)
    de = dia.replace(hour=horas[0][0], minute=horas[0][1])
    if len(horas) == 1:
        return de, (de.replace(hour=23, minute=59) if "ontem" in t else agora)
    ate = dia.replace(hour=horas[1][0], minute=horas[1][1])
    if ate <= de:
        ate += timedelta(days=1)  # "de 22h até 2h"
    return de, ate


def _mensagens(de, ate):
    with db.conexao() as con:
        linhas = con.execute("SELECT quando, origem, texto FROM envios WHERE ok=1 AND quando >= ? AND quando < ? "
                             "ORDER BY quando", (de.isoformat(), ate.isoformat())).fetchall()
    uteis = []
    for r in linhas:
        texto = r["texto"]
        # Fora: resumos anteriores, ajuda, testes e respostas curtas de "não há nada"
        if texto.startswith((CABECALHO, "🤖 *Comandos", "pong", "✅ Mensagem de teste")) or len(texto) < 40:
            continue
        uteis.append((r["quando"], re.sub(r"https?://\S+", "", texto).strip()))
    return uteis


def _bloco(mensagens):
    partes, total = [], 0
    for quando, texto in reversed(mensagens):  # as mais recentes têm prioridade se não couber tudo
        parte = f"[{quando[11:16]}]\n{texto}"
        if total + len(parte) > LIMITE_TEXTO:
            break
        partes.append(parte)
        total += len(parte)
    return "\n\n".join(reversed(partes))


def ollama_modelo(cfg):
    """O modelo do config.json, ou o primeiro instalado no Ollama. None se o Ollama não responde."""
    try:
        r = httpx.get(f"{cfg['url'].rstrip('/')}/api/tags", timeout=3)
        instalados = [m["name"] for m in r.json().get("models", [])]
    except (httpx.HTTPError, ValueError):
        return None
    if cfg.get("modelo") and (cfg["modelo"] in instalados or f"{cfg['modelo']}:latest" in instalados):
        return cfg["modelo"]
    return instalados[0] if instalados else None


def _com_ia(cfg, modelo, de, ate, texto):
    r = httpx.post(f"{cfg['url'].rstrip('/')}/api/generate", timeout=110, json={
        "model": modelo,
        "prompt": PROMPT.format(de=f"{de:%d/%m %H:%M}", ate=f"{ate:%d/%m %H:%M}", texto=texto),
        "stream": False,
        "keep_alive": "5m",  # libera a memória da placa de vídeo logo depois
        "options": {"temperature": 0.2, "num_ctx": 8192},
    })
    r.raise_for_status()
    return para_whatsapp(r.json().get("response", ""))


def para_whatsapp(texto):
    """A IA escreve em Markdown; o WhatsApp usa *negrito* e não tem títulos. Fica só a lista."""
    linhas = []
    for linha in texto.strip().splitlines():
        linha = re.sub(r"\*\*(.+?)\*\*", r"*\1*", linha.strip())
        linha = re.sub(r"^[•*\-]\s+", "• ", linha)
        if linha.startswith("• "):
            linhas.append(linha)
    return "\n".join(linhas) or texto.strip()


def _sem_ia(mensagens):
    """Sem Ollama: conta o que chegou e lista os títulos das notícias e assuntos dos e-mails."""
    noticias = emails = lembretes = 0
    titulos = []
    for _, texto in mensagens:
        for linha in texto.splitlines():
            if m := re.match(r"\S+ \*[^*]+\* · (.+?) — _", linha):
                noticias += 1
                titulos.append(m.group(1))
            elif linha.startswith("✉️"):
                emails += 1
            elif linha.startswith("⏰"):
                lembretes += 1
    contagem = ", ".join(f"{n} {nome}" for n, nome in
                         [(noticias, "notícias"), (emails, "e-mails"), (lembretes, "lembretes")] if n)
    linhas = [f"Chegaram {contagem or 'só mensagens avulsas'}."]
    linhas += [f"• {t}" for t in titulos[-10:]]
    return "\n".join(linhas)


class Resumo(Module):
    nome = "resumo"
    titulo = "Resumo com IA local"
    descricao = "Resume o que já chegou no WhatsApp num período que você pede, com uma IA que roda no seu PC (Ollama)."
    comandos = {"resumo": "ex.: resumo de 14h até 18h · resumo ontem · resumo últimas 3 horas"}

    def responder(self, comando, args, cfg):
        de, ate = periodo(args)
        hoje = datetime.now().date()
        if de.date() == hoje and ate.date() == hoje:
            cab = f"{CABECALHO} de {de:%H:%M} a {ate:%H:%M}*"
        else:
            cab = f"{CABECALHO} de {de:%d/%m %H:%M} a {ate:%d/%m %H:%M}*"
        mensagens = _mensagens(de, ate)
        if not mensagens:
            return f"{cab}\n\nNada chegou nesse período. 📭"

        modelo = ollama_modelo(cfg) if cfg.get("motor") == "ollama" else None
        if modelo:
            try:
                texto = _com_ia(cfg, modelo, de, ate, _bloco(mensagens))
                if texto:
                    return f"{cab}\n_{len(mensagens)} mensagens · IA local ({modelo})_\n\n{texto}"
            except httpx.HTTPError as e:
                log.warning("ollama falhou: %s", e)
                db.evento("aviso", "resumo", f"Ollama falhou ({type(e).__name__}); mandei o resumo simples")
        else:
            db.evento("aviso", "resumo", "Ollama não está respondendo ou sem modelo; mandei o resumo simples")
        return f"{cab}\n_{len(mensagens)} mensagens · sem IA (Ollama desligado)_\n\n{_sem_ia(mensagens)}"
