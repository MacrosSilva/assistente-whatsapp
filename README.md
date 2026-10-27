# Assistente pessoal no WhatsApp

Automação pessoal que roda no meu PC e me avisa pelo WhatsApp: notícias de tecnologia
(IA, programação, cibersegurança) em tempo real, e-mails importantes do Gmail e lembretes
da Google Agenda. Tem um painel web local para configurar tudo.

## Módulos
- **Notícias** — feeds RSS filtrados pelo nicho; urgentes na hora, o resto a cada 30 min. Títulos em
  inglês chegam traduzidos (tradutor do Google; se ele limitar, a IA local traduz).
- **E-mail (Gmail)** — e-mails novos da caixa Principal, com regras opcionais de remetentes/palavras.
- **Google Agenda** — lembretes antes de cada compromisso (padrão: 60 e 10 min).
- **Resumo com IA local** — resume o que já chegou num período, com o Ollama rodando no PC.

## Comandos no WhatsApp (do número principal)
`noticias`, `mais`, `emails`, `agenda`, `amanha`, `resumo` (ex.: `resumo de 14h até 18h`,
`resumo ontem`, `resumo últimas 3 horas`), `ajuda`, `ping`.

## Conectar o Google (uma vez)
1. Em console.cloud.google.com crie um projeto e ative as APIs **Gmail** e **Google Calendar**.
2. Em **Google Auth Platform**: público **Externo**, seu e-mail em **Usuários de teste**.
3. Em **Clientes**: crie um cliente **App para computador** e baixe o JSON.
4. Salve como `secrets/google_cliente.json` e clique em **Conectar conta Google** no painel (Módulos).
O acesso é somente leitura (`gmail.readonly`, `calendar.readonly`); o token fica em `secrets/`.
Em modo "teste" o Google pede para reconectar a cada 7 dias; para evitar, publique o app
(continua privado, só você usa).

## IA local (Ollama)
Instalado com `winget install Ollama.Ollama` e `ollama pull gemma3:4b` (~3,3 GB, roda na GPU).
O Ollama inicia sozinho com o Windows. Sem ele, o `resumo` sai numa versão simples (contagem e títulos).

## Arquitetura
- `app/` — núcleo em Python (FastAPI): lógica, módulos e painel, só em `127.0.0.1`.
- `bridge/` — ponte em Node (whatsapp-web.js): só envia e recebe mensagens.
- `app/modules/` — cada fonte de informação é um módulo independente, descoberto automaticamente.

## Segurança
Segredos (`.env`, `secrets/`, sessão do WhatsApp) e dados pessoais (`config.json`, `data/`)
nunca vão para o git. Um hook em `.githooks/pre-commit` bloqueia commits com arquivos sensíveis.
Acesso ao Google é somente leitura.

## Como usar
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
