"""Contrato que todo módulo (fonte de informação) segue.

Para criar um módulo novo: um arquivo em app/modules/ com uma classe que herda
de Module. Ele aparece sozinho no painel e no comando "ajuda".
"""


class Module:
    nome = ""          # id curto, usado em config e comandos (ex.: "noticias")
    titulo = ""        # nome bonito para o painel
    comandos = []      # palavras que o usuário pode mandar no WhatsApp
    config_padrao = {} # configurações próprias, editáveis no painel

    def __init__(self, config):
        self.config = config  # dict com a seção deste módulo em config.json

    def resumo(self):
        """Texto curto deste módulo para entrar no resumo agendado (ou "" se nada)."""
        raise NotImplementedError

    def responder(self, comando):
        """Resposta quando o usuário manda um dos `comandos`. Padrão: o resumo."""
        return self.resumo()
