"""Notícias de tecnologia em tempo real, a partir de feeds RSS.

Fluxo: lê as fontes a cada `leitura_min` -> guarda só o que é novo, relevante e não repetido
-> urgentes saem na hora; o resto sai junto a cada `intervalo_min`, no máximo `max_itens_por_mensagem`.
"""
import calendar
import html
import logging
import re
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import feedparser
import httpx

from .. import db
from .base import Module

log = logging.getLogger("noticias")

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) assistente-pessoal-rss"
EMOJI = {"IA": "🤖", "segurança": "🔐", "programação": "💻", "geral": "📰"}

# Classificação das fontes "geral" pelo título (sem acento, minúsculo)
PADROES_TEMA = {
    "segurança": r"\b(hackers?|hackead\w+|ataques?|vulnerab\w*|malwares?|ransomware|vazamentos? de (dados|senhas|informacoes)|dados vazados|"
                 r"senhas vazadas|data (breach|leak)|phishing|"
                 r"cve-\d+|golpes?|breach\w*|exploit\w*|seguranca|security|zero-day|0-day|backdoors?|botnets?|"
                 r"ciberataques?|spyware|brechas?|falhas? de seguranca|patch tuesday)\b",
    "IA": r"\b(ia|ai|llm\w*|gpt\S*|openai|anthropic|claude|gemini|chatgpt|chatbot\w*|deepseek|copilot|"
          r"inteligencia artificial|artificial intelligence|machine learning|voice models?|ai models?|"
          r"modelos? de (ia|linguagem|voz)|agente\w* de ia|ai agents?|mistral|llama)\b",
    "programação": r"\b(python|php|javascript|typescript|rust|golang|java|github|gitlab|programac\w*|programador\w*|programar|developers?|"
                   r"desenvolvedor\w*|linux|open source|codigo aberto|framework|kubernetes|docker|npm|api|"
                   r"compilador|vs code|ide)\b",
}
STOP = set("a o os as de do da dos das e em no na nos nas um uma para por com que se ao the of to and in on for "
           "is with at by from its new novo nova how why what".split())


def _sem_acento(s):
    return "".join(c for c in unicodedata.normalize("NFD", s.lower()) if unicodedata.category(c) != "Mn")


def _limpar_titulo(t):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", html.unescape(t or ""))).strip()


def _normalizar_link(link):
    """Tira rastreadores (utm_...) e âncoras, para o mesmo link contar uma vez só."""
    p = urlsplit(link.strip())
    q = [(k, v) for k, v in parse_qsl(p.query) if not k.lower().startswith(("utm_", "ref", "fbclid", "gclid"))]
    return urlunsplit((p.scheme.lower(), p.netloc.lower(), p.path.rstrip("/"), urlencode(q), ""))


def _palavras(titulo):
    return {w for w in re.findall(r"[a-z0-9]+", _sem_acento(titulo)) if len(w) > 2 and w not in STOP}


def _parecidos(a, b):
    """Títulos 'iguais' entre fontes: 60% ou mais das palavras importantes em comum."""
    return bool(a and b) and len(a & b) / len(a | b) >= 0.6


def _contem(titulo, palavras):
    """A palavra precisa começar no início de uma palavra do título: "vazamento" pega "vazamentos",
    mas "quina" não pega "máquina" e "steam" não pega "mainstream"."""
    t = _sem_acento(titulo)
    return any(re.search(r"(?<!\w)" + re.escape(_sem_acento(p.strip())), t) for p in palavras if p.strip())


def _tema(fonte, titulo):
    if fonte.get("tema", "geral") != "geral":
        return fonte["tema"]
    t = _sem_acento(titulo)
    for tema, padrao in PADROES_TEMA.items():
        if re.search(padrao, t):
            return tema
    return "geral"


def _publicada(e):
    data = e.get("published_parsed") or e.get("updated_parsed")
    return datetime.fromtimestamp(calendar.timegm(data)).isoformat(timespec="seconds") if data else None


def _resumo(e):
    bruto = e.get("summary") or (e.get("content") or [{}])[0].get("value", "")
    texto = _limpar_titulo(bruto)
    texto = re.sub(r"\s*(The post|O post) .{0,200} (appeared first on|apareceu primeiro em) .*$", "", texto)
    return texto[:280] + ("…" if len(texto) > 280 else "") if texto else None


def _imagem(e):
    """Miniatura da notícia, de onde o feed oferecer (só https)."""
    candidatos = [m.get("url") for m in e.get("media_thumbnail", [])]
    candidatos += [m.get("url") for m in e.get("media_content", [])
                   if m.get("medium") == "image" or str(m.get("type", "")).startswith("image")]
    candidatos += [l.get("href") for l in e.get("links", []) if str(l.get("type", "")).startswith("image")]
    html_bruto = e.get("summary", "") + "".join(c.get("value", "") for c in e.get("content", []))
    candidatos += re.findall(r'<img[^>]+src="([^"]+)"', html_bruto)
    return next((html.unescape(u) for u in candidatos if u and u.startswith("https://")), None)


def fora_do_nicho(titulo, tema, cfg):
    """True se a notícia não deve ir para você.

    Fontes especializadas (tema IA/segurança/programação) já são do nicho. Já as fontes gerais
    publicam de tudo (jogos, trânsito, eletrodomésticos...), então delas só passa o que tiver
    um termo de tecnologia no título (lista "palavras_nicho", editável no painel).
    """
    if _contem(titulo, cfg.get("palavras_excluir", [])):
        return True
    if cfg.get("palavras_incluir") and not _contem(titulo, cfg["palavras_incluir"]):
        return True
    return (tema == "geral" and cfg.get("fontes_gerais_so_nicho", True)
            and not _contem(titulo, cfg.get("palavras_nicho", [])))


def _baixar(fonte):
    r = httpx.get(fonte["url"], headers={"User-Agent": UA}, timeout=20, follow_redirects=True)
    r.raise_for_status()
    return feedparser.parse(r.content)


class Noticias(Module):
    nome = "noticias"
    titulo = "Notícias de tecnologia"
    descricao = "Lê feeds RSS de tecnologia, IA, programação e segurança e avisa no WhatsApp o que for novo."
    comandos = {
        "noticias": "o que há de novo agora (sem esperar o próximo envio)",
        "mais": "as próximas notícias que não couberam na última mensagem",
    }

    def __init__(self):
        self._erros_fonte = {}  # para registrar falha de uma fonte só quando ela muda

    # ---------- coleta ----------
    def coletar(self, cfg):
        fontes = [f for f in cfg.get("fontes", []) if f.get("url") and f.get("ativa", True)]
        with ThreadPoolExecutor(max_workers=8) as ex:
            resultados = list(ex.map(self._baixar_seguro, fontes))

        limite_idade = time.time() - 48 * 3600
        novas = 0
        with db.conexao() as con:
            recentes = [_palavras(r["titulo"]) for r in con.execute(
                "SELECT titulo FROM noticias WHERE coletada >= ? AND status IN ('pendente','enviada','excedente','vista')",
                ((datetime.now() - timedelta(hours=48)).isoformat(),))]

            for fonte, feed in zip(fontes, resultados):
                if feed is None:
                    continue
                lida_desde = db.ler_estado(f"fonte_lida:{fonte['url']}")
                primeira_vez = lida_desde is None
                for e in feed.entries[:60]:
                    titulo, link = _limpar_titulo(e.get("title")), e.get("link")
                    if not titulo or not link:
                        continue
                    chave = _normalizar_link(link)
                    publicada, resumo, imagem = _publicada(e), _resumo(e), _imagem(e)
                    existente = con.execute("SELECT publicada FROM noticias WHERE chave=?", (chave,)).fetchone()
                    if existente:
                        if existente["publicada"] is None:  # notícias de antes da migração: completa os dados
                            con.execute("UPDATE noticias SET publicada=?, resumo=?, imagem=? WHERE chave=?",
                                        (publicada or db.agora(), resumo, imagem, chave))
                        continue
                    data = e.get("published_parsed") or e.get("updated_parsed")
                    # Antiga: mais de 48 h, ou publicada antes de começarmos a acompanhar esta fonte
                    antiga = data is not None and (calendar.timegm(data) < limite_idade
                                                   or (lida_desde and publicada < lida_desde))
                    palavras = _palavras(titulo)
                    tema = _tema(fonte, titulo)

                    status = self._classificar(titulo, tema, palavras, recentes, cfg)
                    if status == "pendente":
                        recentes.append(palavras)
                        if primeira_vez or antiga:
                            status = "vista"       # já existia: só aparece no painel (evita rajada no WhatsApp)
                        else:
                            novas += 1
                    urgente = int(status == "pendente" and _contem(titulo, cfg.get("palavras_urgentes", [])))
                    con.execute(
                        "INSERT INTO noticias (chave, titulo, link, fonte, tema, urgente, coletada, status, "
                        "publicada, resumo, imagem) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                        (chave, titulo, link.strip(), fonte["nome"], tema, urgente, db.agora(),
                         status, publicada or db.agora(), resumo, imagem))
                if primeira_vez:
                    con.execute("INSERT OR REPLACE INTO estado (chave, valor) VALUES (?,?)",
                                (f"fonte_lida:{fonte['url']}", db.agora()))
        log.info("leitura concluída: %d fontes, %d novas", len(fontes), novas)
        return novas

    @staticmethod
    def _classificar(titulo, tema, palavras, recentes, cfg):
        if fora_do_nicho(titulo, tema, cfg):
            return "filtrada"
        if any(_parecidos(palavras, r) for r in recentes):
            return "repetida"                      # mesma notícia vinda de outra fonte
        return "pendente"

    def _baixar_seguro(self, fonte):
        try:
            feed = _baixar(fonte)
            if self._erros_fonte.pop(fonte["nome"], None):
                db.evento("info", "noticias", f"fonte {fonte['nome']} voltou a funcionar")
            return feed
        except Exception as e:
            msg = f"{type(e).__name__}: {e}"[:200]
            if self._erros_fonte.get(fonte["nome"]) != msg:
                self._erros_fonte[fonte["nome"]] = msg
                db.evento("aviso", "noticias", f"fonte {fonte['nome']} falhou: {msg}")
            return None

    # ---------- envio ----------
    def tick(self, agora, cfg, silencio, enviar):
        ultima = db.ler_estado("noticias_ultima_leitura")
        if ultima is None or agora - datetime.fromisoformat(ultima) >= timedelta(minutes=cfg["leitura_min"]):
            self.coletar(cfg)
            db.gravar_estado("noticias_ultima_leitura", agora.isoformat(timespec="seconds"))

        if silencio:
            db.gravar_estado("noticias_silencio", 1)
            return
        maximo = cfg["max_itens_por_mensagem"]

        # Urgentes furam a fila
        urgentes = self._buscar("status='pendente' AND urgente=1", maximo)
        if urgentes and enviar(self._formatar(urgentes, "🚨 *Urgente*")):
            self._marcar(urgentes, "enviada")

        # Normais: no máximo uma mensagem a cada intervalo_min
        ultimo = db.ler_estado("noticias_ultimo_envio")
        if ultimo and agora - datetime.fromisoformat(ultimo) < timedelta(minutes=cfg["intervalo_min"]):
            return
        pendentes = self._buscar("status='pendente'", 500)
        if not pendentes:
            return
        escolhidas = self._variadas(pendentes, maximo)
        resto = [n for n in pendentes if n not in escolhidas]
        cabecalho = f"📰 *Notícias* ({agora:%H:%M})"
        if db.ler_estado("noticias_silencio") == "1":
            cabecalho = f"☀️ *Bom dia!* Durante a noite chegaram {len(pendentes)} notícias. Destaques:"
        if enviar(self._formatar(escolhidas, cabecalho, len(resto))):
            self._marcar(escolhidas, "enviada")
            self._marcar(resto, "excedente")
            db.gravar_estado("noticias_ultimo_envio", agora.isoformat(timespec="seconds"))
            db.gravar_estado("noticias_silencio", 0)

    def responder(self, comando, args, cfg):
        maximo = cfg["max_itens_por_mensagem"]
        if comando == "mais":
            limite = (datetime.now() - timedelta(hours=24)).isoformat()
            itens = self._buscar(f"status='excedente' AND coletada >= '{limite}'", 500)
            if not itens:
                return "Não há mais notícias guardadas. 👍"
            lote = itens[:maximo]
            self._marcar(lote, "enviada")
            return self._formatar(lote, "📰 *Mais notícias*", len(itens) - len(lote))

        # "noticias": lê as fontes agora e manda o que houver de novo
        texto = self.agora(cfg)
        if texto:
            return texto
        ultimo = db.ler_estado("noticias_ultimo_envio")
        quando = f" desde as {datetime.fromisoformat(ultimo):%H:%M}" if ultimo else ""
        return f"Nada novo{quando}. Mande *mais* se quiser as que ficaram guardadas."

    def agora(self, cfg):
        self.coletar(cfg)
        pendentes = self._buscar("status='pendente'", 500)
        if not pendentes:
            return None
        escolhidas = self._variadas(pendentes, cfg["max_itens_por_mensagem"])
        resto = [n for n in pendentes if n not in escolhidas]
        self._marcar(escolhidas, "enviada")
        self._marcar(resto, "excedente")
        db.gravar_estado("noticias_ultimo_envio", db.agora())
        return self._formatar(escolhidas, "📰 *Notícias agora*", len(resto))

    def texto_de_uma(self, chave):
        """Para o botão "enviar ao WhatsApp" de uma notícia no painel."""
        itens = self._buscar_chave(chave)
        if not itens:
            return None
        self._marcar(itens, "enviada")
        return self._formatar(itens, "📌 *Do painel*")

    def fontes_com_erro(self):
        return dict(self._erros_fonte)

    # ---------- auxiliares ----------
    def _buscar_chave(self, chave):
        with db.conexao() as con:
            return [dict(r) for r in con.execute("SELECT * FROM noticias WHERE chave=?", (chave,))]

    def _buscar(self, onde, limite):
        with db.conexao() as con:
            return [dict(r) for r in con.execute(
                f"SELECT * FROM noticias WHERE {onde} ORDER BY urgente DESC, coletada DESC LIMIT ?", (limite,))]

    def _marcar(self, itens, status):
        if not itens:
            return
        with db.conexao() as con:
            con.executemany("UPDATE noticias SET status=?, enviada=? WHERE chave=?",
                            [(status, db.agora() if status == "enviada" else None, n["chave"]) for n in itens])

    @staticmethod
    def _variadas(itens, maximo):
        """Pega até `maximo` alternando os temas, para uma mensagem não ser só de um assunto."""
        por_tema = {}
        for n in itens:
            por_tema.setdefault(n["tema"], []).append(n)
        escolhidas = []
        while len(escolhidas) < maximo and any(por_tema.values()):
            for lista in por_tema.values():
                if lista and len(escolhidas) < maximo:
                    escolhidas.append(lista.pop(0))
        return escolhidas

    @staticmethod
    def _formatar(itens, cabecalho, restantes=0):
        linhas = [cabecalho, ""]
        for n in itens:
            titulo = n["titulo"] if len(n["titulo"]) <= 120 else n["titulo"][:117] + "…"
            tema = n["tema"].capitalize() if n["tema"] != "IA" else "IA"
            linhas += [f"{EMOJI.get(n['tema'], '📰')} *{tema}* · {titulo} — _{n['fonte']}_", n["link"], ""]
        if restantes:
            linhas.append(f"+{restantes} outras — mande *mais*")
        return "\n".join(linhas).strip()
