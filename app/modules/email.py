"""E-mails do Gmail avisados assim que chegam (somente leitura).

Fluxo: a cada `intervalo_min` pergunta ao Gmail o que chegou na caixa de entrada -> o que já
estava lá quando você conectou não é avisado -> o novo passa pelas regras (remetentes/palavras)
-> sai numa mensagem só; no silêncio fica guardado e sai de manhã.
"""
import html
import logging
import re
from datetime import datetime, timedelta
from email.utils import parseaddr

from .. import db, google
from .base import Module
from .noticias import _contem

log = logging.getLogger("email")

MAX_POR_MENSAGEM = 8
SEM_GOOGLE = "Sua conta Google ainda não está conectada. Conecte no painel, em *Módulos*."


def _remetente(bruto):
    nome, endereco = parseaddr(bruto or "")
    return f"{nome} <{endereco}>" if nome and endereco else (endereco or nome or "desconhecido")


def _nome_curto(de):
    nome, endereco = parseaddr(de)
    return nome or endereco


def importante(de, assunto, trecho, cfg):
    """Sem regras, todo e-mail novo é avisado. Com regras, basta bater um remetente OU uma palavra."""
    remetentes, palavras = cfg.get("remetentes", []), cfg.get("palavras", [])
    if not remetentes and not palavras:
        return True
    if any(r.strip().lower() in de.lower() for r in remetentes if r.strip()):
        return True
    return _contem(f"{assunto} {trecho}", palavras)


class Email(Module):
    nome = "email"
    titulo = "E-mail (Gmail)"
    descricao = "Avisa no WhatsApp os e-mails novos da caixa de entrada, com regras de remetentes e palavras. Somente leitura."
    comandos = {"emails": "e-mails não lidos da caixa de entrada agora"}

    def _consulta(self, cfg, nao_lidos=None):
        partes = ["in:inbox", "newer_than:2d"]
        if cfg.get("so_nao_lidos", True) if nao_lidos is None else nao_lidos:
            partes.append("is:unread")
        if cfg.get("so_caixa_principal", True):
            partes.append("category:primary")  # sem Promoções/Social/Atualizações
        return " ".join(partes)

    @staticmethod
    def _ids(gmail, consulta, maximo=50):
        r = gmail.users().messages().list(userId="me", q=consulta, maxResults=maximo).execute()
        return [m["id"] for m in r.get("messages", [])]

    @staticmethod
    def _detalhes(gmail, id_):
        msg = gmail.users().messages().get(userId="me", id=id_, format="metadata",
                                           metadataHeaders=["From", "Subject"]).execute()
        cab = {h["name"].lower(): h["value"] for h in msg.get("payload", {}).get("headers", [])}
        return {
            "id": id_,
            "de": _remetente(cab.get("from")),
            "assunto": re.sub(r"\s+", " ", cab.get("subject") or "(sem assunto)").strip(),
            "trecho": html.unescape(msg.get("snippet", ""))[:200],
            "recebido": datetime.fromtimestamp(int(msg["internalDate"]) / 1000).isoformat(timespec="seconds"),
        }

    # ---------- coleta ----------
    def coletar(self, cfg):
        gmail = google.servico("gmail", "v1")
        if not gmail:
            return 0
        inicio = db.ler_estado("email_inicio")
        primeira_vez = inicio is None
        if primeira_vez:
            inicio = db.agora()
            db.gravar_estado("email_inicio", inicio)

        with db.conexao() as con:
            conhecidos = {r["id"] for r in con.execute(
                "SELECT id FROM emails WHERE recebido >= ?", ((datetime.now() - timedelta(days=3)).isoformat(),))}
        ids = [i for i in self._ids(gmail, self._consulta(cfg)) if i not in conhecidos]
        novos = 0
        with db.conexao() as con:
            for e in (self._detalhes(gmail, i) for i in ids):
                if primeira_vez or e["recebido"] < inicio:
                    status = "vista"   # já estava na caixa: não vira uma rajada no WhatsApp
                elif importante(e["de"], e["assunto"], e["trecho"], cfg):
                    status = "pendente"
                    novos += 1
                else:
                    status = "ignorado"
                con.execute("INSERT OR IGNORE INTO emails (id, de, assunto, trecho, recebido, status) VALUES (?,?,?,?,?,?)",
                            (e["id"], e["de"], e["assunto"], e["trecho"], e["recebido"], status))
        if novos:
            log.info("%d e-mail(s) novo(s)", novos)
        return novos

    # ---------- envio ----------
    def tick(self, agora, cfg, silencio, enviar):
        ultima = db.ler_estado("email_ultima_leitura")
        if ultima is None or agora - datetime.fromisoformat(ultima) >= timedelta(minutes=cfg["intervalo_min"]):
            db.gravar_estado("email_ultima_leitura", agora.isoformat(timespec="seconds"))
            self.coletar(cfg)

        if silencio:
            if self._pendentes():
                db.gravar_estado("email_silencio", 1)
            return
        pendentes = self._pendentes()
        if not pendentes:
            return
        lote = pendentes[:MAX_POR_MENSAGEM]
        if db.ler_estado("email_silencio") == "1" and len(pendentes) > 1:
            cabecalho = f"☀️ *Durante a noite chegaram {len(pendentes)} e-mails*"
        elif len(lote) == 1:
            cabecalho = "📧 *Novo e-mail*"
        else:
            cabecalho = f"📧 *{len(pendentes)} e-mails novos*"
        if enviar(self._formatar(lote, cabecalho, len(pendentes) - len(lote))):
            with db.conexao() as con:
                con.executemany("UPDATE emails SET status='enviado', enviado=? WHERE id=?",
                                [(db.agora(), e["id"]) for e in lote])
            db.gravar_estado("email_silencio", 0)

    def agora(self, cfg):
        if not google.credenciais():
            return None
        self.coletar(cfg)
        pendentes = self._pendentes()
        if not pendentes:
            return None
        lote = pendentes[:MAX_POR_MENSAGEM]
        with db.conexao() as con:
            con.executemany("UPDATE emails SET status='enviado', enviado=? WHERE id=?",
                            [(db.agora(), e["id"]) for e in lote])
        return self._formatar(lote, "📧 *E-mails novos*", len(pendentes) - len(lote))

    def responder(self, comando, args, cfg):
        gmail = google.servico("gmail", "v1")
        if not gmail:
            return SEM_GOOGLE
        itens = [self._detalhes(gmail, i) for i in self._ids(gmail, self._consulta(cfg, nao_lidos=True), MAX_POR_MENSAGEM + 1)]
        if not itens:
            return "Nenhum e-mail não lido na caixa de entrada. 📭"
        lote = itens[:MAX_POR_MENSAGEM]
        resto = len(itens) - len(lote)
        cab = f"📬 *Não lidos* ({len(lote)}{'+' if resto else ''})"
        return self._formatar(lote, cab, 0) + ("\n\nTem mais no Gmail." if resto else "")

    # ---------- auxiliares ----------
    @staticmethod
    def _pendentes():
        with db.conexao() as con:
            return [dict(r) for r in con.execute("SELECT * FROM emails WHERE status='pendente' ORDER BY recebido")]

    @staticmethod
    def _formatar(itens, cabecalho, restantes=0):
        linhas = [cabecalho, ""]
        for e in itens:
            hora = e["recebido"][11:16]
            linhas.append(f"✉️ *{_nome_curto(e['de'])}* · {hora}")
            linhas.append(e["assunto"][:150])
            if e.get("trecho"):
                linhas.append(f"_{e['trecho'][:140]}{'…' if len(e['trecho']) > 140 else ''}_")
            linhas.append("")
        if restantes:
            linhas.append(f"+{restantes} outros — eles saem na próxima mensagem")
        return "\n".join(linhas).strip()
