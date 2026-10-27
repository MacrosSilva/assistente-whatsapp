"""Banco local (SQLite, em data/): notícias vistas, envios e eventos (erros/avisos)."""
import sqlite3
from contextlib import contextmanager
from datetime import datetime

from .settings import DATA

ARQUIVO = DATA / "assistente.db"

ESQUEMA = """
CREATE TABLE IF NOT EXISTS noticias (
    chave     TEXT PRIMARY KEY,          -- link normalizado
    titulo    TEXT NOT NULL,
    link      TEXT NOT NULL,
    fonte     TEXT NOT NULL,
    tema      TEXT NOT NULL,
    urgente   INTEGER NOT NULL DEFAULT 0,
    coletada  TEXT NOT NULL,
    -- vista: já existia na 1ª leitura | pendente: aguardando envio
    -- enviada: foi para o WhatsApp | excedente: ficou para o "mais" | filtrada | repetida
    status    TEXT NOT NULL,
    enviada   TEXT,
    publicada TEXT,                      -- data de publicação na fonte (hora local)
    resumo    TEXT,                      -- trecho do texto, para o painel
    imagem    TEXT,                      -- miniatura (URL https), para o painel
    traducao  TEXT                       -- título em português, se a fonte é de outro idioma
);
CREATE INDEX IF NOT EXISTS ix_noticias_status ON noticias(status, coletada);
CREATE INDEX IF NOT EXISTS ix_noticias_enviada ON noticias(enviada);

CREATE TABLE IF NOT EXISTS emails (
    id        TEXT PRIMARY KEY,          -- id da mensagem no Gmail
    de        TEXT NOT NULL,
    assunto   TEXT NOT NULL,
    trecho    TEXT,
    recebido  TEXT NOT NULL,
    -- vista: já estava lá ao conectar | pendente: aguardando envio | enviado | ignorado: fora das regras
    status    TEXT NOT NULL,
    enviado   TEXT
);
CREATE INDEX IF NOT EXISTS ix_emails_status ON emails(status, recebido);

CREATE TABLE IF NOT EXISTS envios (
    id      INTEGER PRIMARY KEY,
    quando  TEXT NOT NULL,
    origem  TEXT NOT NULL,               -- módulo ou "comando"
    texto   TEXT NOT NULL,
    ok      INTEGER NOT NULL,
    erro    TEXT
);

CREATE TABLE IF NOT EXISTS eventos (
    id      INTEGER PRIMARY KEY,
    quando  TEXT NOT NULL,
    nivel   TEXT NOT NULL,               -- info | aviso | erro
    origem  TEXT NOT NULL,
    mensagem TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS estado (
    chave TEXT PRIMARY KEY,
    valor TEXT
);
"""


def agora():
    return datetime.now().isoformat(timespec="seconds")


@contextmanager
def conexao():
    con = sqlite3.connect(ARQUIVO, timeout=10)
    con.row_factory = sqlite3.Row
    try:
        yield con
        con.commit()
    finally:
        con.close()


def iniciar():
    with conexao() as con:
        con.execute("PRAGMA journal_mode=WAL")
        con.executescript(ESQUEMA)
        # Migração: colunas que chegaram depois da primeira versão do banco
        colunas = {r[1] for r in con.execute("PRAGMA table_info(noticias)")}
        for coluna in ("publicada", "resumo", "imagem", "traducao"):
            if coluna not in colunas:
                con.execute(f"ALTER TABLE noticias ADD COLUMN {coluna} TEXT")
        con.execute("CREATE INDEX IF NOT EXISTS ix_noticias_publicada ON noticias(publicada)")


def evento(nivel, origem, mensagem):
    with conexao() as con:
        con.execute("INSERT INTO eventos (quando, nivel, origem, mensagem) VALUES (?,?,?,?)",
                    (agora(), nivel, origem, mensagem[:500]))


def ler_estado(chave, padrao=None):
    with conexao() as con:
        r = con.execute("SELECT valor FROM estado WHERE chave=?", (chave,)).fetchone()
    return r["valor"] if r else padrao


def gravar_estado(chave, valor):
    with conexao() as con:
        con.execute("INSERT INTO estado (chave, valor) VALUES (?,?) "
                    "ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor", (chave, str(valor)))
