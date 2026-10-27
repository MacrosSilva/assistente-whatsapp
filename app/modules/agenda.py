"""Lembretes da Google Agenda no WhatsApp (somente leitura).

Fluxo: a cada 10 min lê os compromissos das próximas 36 h -> a cada minuto confere se algum
entrou numa das antecedências (ex.: 60 e 10 min antes) -> manda um lembrete por antecedência.
Se o assistente estava desligado ou em silêncio, manda o lembrete mais próximo assim que puder.
"""
import logging
from datetime import datetime, timedelta

from .. import db, google
from .base import Module
from .email import SEM_GOOGLE

log = logging.getLogger("agenda")

RELER_MIN = 10
DIAS = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"]


def _local(iso):
    return datetime.fromisoformat(iso).astimezone().replace(tzinfo=None)


def _evento(e, calendario):
    inicio, fim = e.get("start", {}), e.get("end", {})
    dia_todo = "date" in inicio
    link = e.get("hangoutLink") or next(
        (p.get("uri") for p in e.get("conferenceData", {}).get("entryPoints", []) if p.get("entryPointType") == "video"), None)
    return {
        "id": e["id"],
        "titulo": e.get("summary") or "(sem título)",
        "inicio": datetime.fromisoformat(inicio["date"]) if dia_todo else _local(inicio["dateTime"]),
        "fim": datetime.fromisoformat(fim["date"]) if dia_todo else _local(fim["dateTime"]),
        "dia_todo": dia_todo,
        "local": e.get("location"),
        "link": link,
        "calendario": calendario,
    }


def _recusado(e):
    return any(a.get("self") and a.get("responseStatus") == "declined" for a in e.get("attendees", []))


def faltando(minutos):
    minutos = max(1, round(minutos))
    if minutos < 60:
        return f"{minutos} min"
    h, m = divmod(minutos, 60)
    return f"{h} h" + (f" {m:02d}" if m else "")


class Agenda(Module):
    nome = "agenda"
    titulo = "Google Agenda"
    descricao = "Lembra no WhatsApp antes de cada compromisso e mostra a agenda do dia quando você pede. Somente leitura."
    comandos = {
        "agenda": "seus compromissos de hoje",
        "amanha": "seus compromissos de amanhã",
    }

    def __init__(self):
        self._eventos = []
        self._lido_em = None

    def buscar(self, cfg, de, ate):
        cal = google.servico("calendar", "v3")
        if not cal:
            return None
        ids = cfg.get("calendarios") or ["primary"]
        eventos = []
        for cid in ids:
            r = cal.events().list(calendarId=cid, timeMin=de.astimezone().isoformat(), timeMax=ate.astimezone().isoformat(),
                                  singleEvents=True, orderBy="startTime", maxResults=100).execute()
            eventos += [_evento(e, r.get("summary", cid)) for e in r.get("items", [])
                        if e.get("status") != "cancelled" and not _recusado(e)]
        return sorted(eventos, key=lambda e: (not e["dia_todo"], e["inicio"]))

    # ---------- lembretes ----------
    def tick(self, agora, cfg, silencio, enviar):
        if self._lido_em is None or agora - self._lido_em >= timedelta(minutes=RELER_MIN):
            eventos = self.buscar(cfg, agora - timedelta(minutes=5), agora + timedelta(hours=36))
            if eventos is None:
                return
            self._eventos, self._lido_em = eventos, agora

        if silencio:
            return  # quem ainda não começou recebe o lembrete quando o silêncio acabar
        antecedencias = sorted({int(a) for a in cfg.get("antecedencia_min", []) if a > 0}, reverse=True)
        for e in self._eventos:
            if e["dia_todo"]:
                continue
            minutos = (e["inicio"] - agora).total_seconds() / 60
            passaram = [a for a in antecedencias if minutos <= a]
            if minutos <= 0 or not passaram:
                continue
            alvo = min(passaram)  # a antecedência mais próxima que já chegou
            chave = f"lembrete:{e['id']}:{e['inicio']:%Y%m%d%H%M}"
            ja = db.ler_estado(chave)
            if ja is not None and int(ja) <= alvo:
                continue
            if enviar(self._lembrete(e, minutos)):
                db.gravar_estado(chave, alvo)

    @staticmethod
    def _lembrete(e, minutos):
        linhas = [f"⏰ *Em {faltando(minutos)}* · {e['inicio']:%H:%M}", f"*{e['titulo']}*"]
        if e["local"]:
            linhas.append(f"📍 {e['local']}")
        if e["link"]:
            linhas.append(f"🎥 {e['link']}")
        return "\n".join(linhas)

    # ---------- comandos ----------
    def responder(self, comando, args, cfg):
        hoje = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        dia = hoje + timedelta(days=1) if comando == "amanha" else hoje
        eventos = self.buscar(cfg, dia, dia + timedelta(days=1))
        if eventos is None:
            return SEM_GOOGLE
        nome = "Amanhã" if dia != hoje else "Hoje"
        cab = f"📅 *{nome}, {DIAS[dia.weekday()]} {dia:%d/%m}*"
        # eventos de dia inteiro aparecem só no dia em que começam ou que estão em andamento
        eventos = [e for e in eventos if not e["dia_todo"] or e["inicio"] <= dia < e["fim"]]
        if not eventos:
            return f"{cab}\n\nNenhum compromisso. 🎉"
        linhas = [cab, ""]
        agora = datetime.now()
        for e in eventos:
            if e["dia_todo"]:
                linhas.append(f"• _dia todo_ — {e['titulo']}")
                continue
            feito = "✓ " if e["fim"] < agora else ""
            linhas.append(f"• {feito}*{e['inicio']:%H:%M}–{e['fim']:%H:%M}* {e['titulo']}")
            if e["local"]:
                linhas.append(f"   📍 {e['local']}")
        return "\n".join(linhas)

    def agora(self, cfg):
        return None  # lembretes só fazem sentido na hora certa
