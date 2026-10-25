"""Núcleo: carrega os módulos, roda o vigia (a cada minuto) e responde aos comandos.

O painel e o WhatsApp chamam as mesmas funções daqui, então a lógica é uma só.
"""
import logging
import threading
import unicodedata
from datetime import datetime, time

from . import bridge, db
from .modules import descobrir
from .settings import carregar_config

log = logging.getLogger("nucleo")


def _normalizar(texto):
    sem_acento = "".join(c for c in unicodedata.normalize("NFD", texto.lower())
                         if unicodedata.category(c) != "Mn")
    return sem_acento.strip(" .!?*")


def em_silencio(cfg, agora):
    ini = time.fromisoformat(cfg["silencio"]["inicio"])
    fim = time.fromisoformat(cfg["silencio"]["fim"])
    t = agora.time()
    return (ini <= t or t < fim) if ini > fim else (ini <= t < fim)


class Nucleo:
    def __init__(self):
        self.modulos = {nome: cls() for nome, cls in descobrir().items()}
        self._parar = threading.Event()
        self._trava = threading.Lock()  # o vigia e um comando não mexem no mesmo módulo ao mesmo tempo
        log.info("módulos encontrados: %s", ", ".join(self.modulos) or "nenhum")

    def ativos(self, cfg):
        return [m for m in self.modulos.values() if cfg["modulos_ativos"].get(m.nome, False)]

    # ---------- vigia ----------
    def iniciar(self):
        threading.Thread(target=self._laco, name="vigia", daemon=True).start()

    def parar(self):
        self._parar.set()

    def _laco(self):
        while not self._parar.is_set():
            self.tick()
            self._parar.wait(60)

    def tick(self):
        cfg = carregar_config()
        agora = datetime.now()
        silencio = em_silencio(cfg, agora)
        for m in self.ativos(cfg):
            try:
                with self._trava:
                    m.tick(agora, cfg.get(m.nome, {}), silencio, lambda texto, o=m.nome: bridge.enviar(texto, o))
            except Exception as e:
                log.exception("erro no módulo %s", m.nome)
                db.evento("erro", m.nome, f"{type(e).__name__}: {e}")

    # ---------- conversa ----------
    def responder(self, texto):
        cfg = carregar_config()
        partes = _normalizar(texto).split(maxsplit=1)
        if not partes:
            return None
        comando, args = partes[0], (partes[1] if len(partes) > 1 else "")

        if comando == "ping":
            return "pong 🏓"
        if comando in ("ajuda", "help", "menu", "comandos"):
            return self.ajuda(cfg)

        for m in self.modulos.values():
            if comando in m.comandos:
                if m not in self.ativos(cfg):
                    return f"O módulo *{m.titulo}* está desligado. Ligue no painel."
                try:
                    with self._trava:
                        return m.responder(comando, args, cfg.get(m.nome, {}))
                except Exception as e:
                    log.exception("erro no comando %s", comando)
                    db.evento("erro", m.nome, f"comando {comando}: {type(e).__name__}: {e}")
                    return "Deu um erro ao fazer isso. 😕 Ele ficou registrado no painel."
        return "Não entendi. Mande *ajuda* para ver os comandos."

    def ajuda(self, cfg):
        linhas = ["🤖 *Comandos*", ""]
        for m in self.ativos(cfg):
            for palavra, desc in m.comandos.items():
                linhas.append(f"• *{palavra}* — {desc}")
        linhas.append("• *ajuda* — esta lista")
        return "\n".join(linhas)
