# Assistente pessoal no WhatsApp

Automação pessoal que roda no meu PC e me avisa pelo WhatsApp: notícias de tecnologia
(IA, programação, cibersegurança) em tempo real, e-mails importantes do Gmail e lembretes
da Google Agenda. Tem um painel web local para configurar tudo.

> Em construção, etapa por etapa. Guia completo de uso no fim do projeto.

## Arquitetura
- `app/` — núcleo em Python (FastAPI): lógica, módulos e painel, só em `127.0.0.1`.
- `bridge/` — ponte em Node (whatsapp-web.js): só envia e recebe mensagens.
- `app/modules/` — cada fonte de informação é um módulo independente, descoberto automaticamente.

## Segurança
Segredos (`.env`, `secrets/`, sessão do WhatsApp) e dados pessoais (`config.json`, `data/`)
nunca vão para o git. Um hook em `.githooks/pre-commit` bloqueia commits com arquivos sensíveis.
Acesso ao Google é somente leitura.
