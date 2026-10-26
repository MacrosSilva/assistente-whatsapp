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

## Como usar (por enquanto)
- **Iniciar:** dois cliques em `iniciar.cmd`. Abre a ponte e o núcleo minimizados e, depois, o painel
  em http://127.0.0.1:8765.
- **Parar:** dois cliques em `parar.cmd`. A sessão do WhatsApp continua salva (não pede QR de novo).
- **Início automático:** a tarefa agendada "Assistente WhatsApp" roda `iniciar.cmd auto` 30 s depois de
  entrar no Windows (sem abrir o painel). Desligar: `schtasks /change /tn "Assistente WhatsApp" /disable`;
  remover: `schtasks /delete /tn "Assistente WhatsApp" /f`.
- O PC precisa estar ligado, com o usuário logado e acordado.
- Logs: `data/core.out` (núcleo) e `data/bridge.log` (ponte).

Primeira instalação: `python -m venv .venv`, `.venv\Scripts\pip install -r requirements.txt`,
`cd bridge && npm install`, copiar `.env.example` para `.env` e preencher.
