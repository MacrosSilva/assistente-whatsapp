"""Contrato que todo módulo (fonte de informação) segue.

Para criar um módulo novo: um arquivo em app/modules/ com uma classe que herda
de Module. Ele aparece sozinho no painel e no comando "ajuda".
"""


class Module:
    nome = ""        # id curto, usado no config.json (ex.: "noticias")
    titulo = ""      # nome bonito para o painel
    comandos = {}    # palavra que o usuário manda no WhatsApp -> o que ela faz

    def tick(self, agora, cfg, silencio, enviar):
        """Chamado a cada minuto pelo núcleo, para o módulo agir sozinho (ex.: buscar novidades).

        cfg: a seção deste módulo no config.json (lida na hora, então edições valem sem reiniciar).
        silencio: True durante o horário de silêncio; o módulo decide o que guardar para depois.
        enviar(texto) -> bool: manda ao WhatsApp e registra no histórico; True se a ponte aceitou.
        """

    def responder(self, comando, args, cfg):
        """Resposta quando o usuário manda uma das palavras de `comandos`."""
        return ""
