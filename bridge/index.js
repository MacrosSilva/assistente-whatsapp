// Ponte WhatsApp: só envia e recebe mensagens. Toda a lógica fica no núcleo Python.
// Servidor HTTP local (apenas 127.0.0.1), protegido por token compartilhado.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const QRCode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');

process.loadEnvFile(path.join(__dirname, '..', '.env'));
const MEU_NUMERO = (process.env.MEU_NUMERO || '').replace(/\D/g, '');
const TOKEN = process.env.BRIDGE_TOKEN || '';
const PORTA = Number(process.env.BRIDGE_PORT || 8766);
const CORE = `http://127.0.0.1:${process.env.CORE_PORT || 8765}`;
const QR_PNG = path.join(__dirname, '..', 'data', 'qr.png');

// Freio contra rajadas (o núcleo também limita; isto é a última barreira)
const INTERVALO_MIN_MS = 8000;
const JITTER_MS = 4000;
const MAX_POR_HORA = 20;

if (!/^\d{12,13}$/.test(MEU_NUMERO) || TOKEN.length < 32) {
  console.error('Configure MEU_NUMERO e BRIDGE_TOKEN no .env antes de iniciar.');
  process.exit(1);
}

const log = (...a) => console.log(new Date().toLocaleTimeString('pt-BR'), '[ponte]', ...a);

// ---- Estado (lido pelo painel via GET /status) ----
const estado = { status: 'iniciando', desde: Date.now(), qr: null, ultimoErro: null };
function mudar(status, extra = {}) {
  Object.assign(estado, { status, desde: Date.now() }, extra);
  log('estado:', status);
}

// ---- Cliente WhatsApp ----
let client;
let meuId = null;   // id do número principal no WhatsApp (resolvido após conectar)
let meuLid = null;  // id alternativo (LID) que o WhatsApp às vezes usa no lugar do número
let tentativas = 0;

function criarCliente() {
  client = new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '.wwebjs_auth') }),
    puppeteer: { headless: true, args: ['--no-first-run', '--disable-gpu'] },
  });

  client.on('qr', async (qr) => {
    estado.qr = await QRCode.toDataURL(qr, { margin: 2, width: 320 });
    fs.mkdirSync(path.dirname(QR_PNG), { recursive: true });
    await QRCode.toFile(QR_PNG, qr, { margin: 2, width: 320 });
    mudar('aguardando_qr');
    log(`QR code pronto: abra o painel ou o arquivo data/qr.png e escaneie com o número reserva.`);
  });

  client.on('authenticated', () => log('autenticado'));

  client.on('ready', async () => {
    tentativas = 0;
    estado.qr = null;
    fs.rmSync(QR_PNG, { force: true });
    try {
      // Números brasileiros antigos podem estar no WhatsApp sem o 9º dígito: o WhatsApp diz o id certo
      const wid = await client.getNumberId(MEU_NUMERO);
      if (!wid) throw new Error('o número principal não foi encontrado no WhatsApp');
      meuId = wid._serialized;
      if (typeof client.getContactLidAndPhone === 'function') {
        const [r] = await client.getContactLidAndPhone([meuId]).catch(() => []);
        meuLid = r?.lid || null;
      }
      await client.sendPresenceUnavailable().catch(() => {}); // aparece "offline": mais discreto
      mudar('conectado', { ultimoErro: null });
    } catch (e) {
      mudar('erro', { ultimoErro: e.message });
    }
  });

  client.on('auth_failure', (msg) => {
    mudar('precisa_qr', { ultimoErro: 'falha de autenticação' });
    log('falha de autenticação:', msg);
  });

  client.on('disconnected', (motivo) => {
    log('desconectado:', motivo);
    const deslogado = String(motivo).toUpperCase().includes('LOGOUT');
    mudar(deslogado ? 'precisa_qr' : 'desconectado', { ultimoErro: `desconectado (${motivo})` });
    reiniciar(deslogado);
  });

  client.on('message', receber);

  // Recibo das mensagens enviadas: -1 significa que o WhatsApp recusou a entrega
  client.on('message_ack', (msg, ack) => {
    if (msg.fromMe && ack === -1) {
      estado.ultimoErro = 'o WhatsApp recusou a entrega de uma mensagem';
      log('recibo: ERRO na entrega');
    }
  });

  client.initialize().catch((e) => {
    mudar('erro', { ultimoErro: e.message });
    reiniciar(false);
  });
}

// Reconexão com espera crescente (30 s, 60 s, 120 s... até 10 min)
let reiniciando = false;
async function reiniciar(apagarSessao) {
  if (reiniciando) return;
  reiniciando = true;
  const espera = Math.min(30000 * 2 ** tentativas, 600000);
  tentativas++;
  log(`reconectando em ${Math.round(espera / 1000)} s`);
  await client.destroy().catch(() => {});
  if (apagarSessao) {
    // Sessão encerrada no celular: a antiga não serve mais, um QR novo será gerado
    fs.rmSync(path.join(__dirname, '.wwebjs_auth'), { recursive: true, force: true });
  }
  setTimeout(() => { reiniciando = false; criarCliente(); }, espera);
}

// Vigia: se ficar "conectado" no papel mas o WhatsApp Web não responder, reconecta
setInterval(async () => {
  if (estado.status !== 'conectado') return;
  const s = await Promise.race([
    client.getState().catch(() => null),
    new Promise((r) => setTimeout(() => r('timeout'), 20000)),
  ]);
  if (s !== 'CONNECTED') {
    mudar('desconectado', { ultimoErro: `vigia: estado ${s}` });
    reiniciar(false);
  }
}, 120000);

// ---- Recebimento: só o número principal é ouvido ----
function ehOPrincipal(msg) {
  return !msg.fromMe && msg.type === 'chat' && (msg.from === meuId || (meuLid && msg.from === meuLid));
}

async function receber(msg) {
  if (!ehOPrincipal(msg)) return; // qualquer outro: ignora em silêncio, sem resposta
  log(`mensagem do principal (${msg.body.length} caracteres)`);
  let resposta = null;
  try {
    const r = await fetch(`${CORE}/api/incoming`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-token': TOKEN },
      body: JSON.stringify({ texto: msg.body, recebido_em: msg.timestamp }),
      signal: AbortSignal.timeout(120000),
    });
    if (r.ok) resposta = (await r.json()).resposta;
  } catch {
    // Núcleo desligado: só responde ao "ping", para dar para testar a ponte sozinha
    if (msg.body.trim().toLowerCase() === 'ping') resposta = 'pong (núcleo desligado)';
  }
  if (resposta) enfileirar(resposta);
}

// ---- Envio: fila com intervalo e limite por hora; destino fixo = número principal ----
const fila = [];
const enviadasNaHora = [];
let enviando = false;
let ultimoEnvio = 0;

function enfileirar(texto) {
  fila.push(texto);
  processarFila();
  return fila.length;
}

async function processarFila() {
  if (enviando) return;
  enviando = true;
  try {
    while (fila.length && estado.status === 'conectado') {
      const agora = Date.now();
      while (enviadasNaHora.length && agora - enviadasNaHora[0] > 3600000) enviadasNaHora.shift();
      if (enviadasNaHora.length >= MAX_POR_HORA) {
        log('limite por hora atingido; aguardando');
        await esperar(60000);
        continue;
      }
      const falta = ultimoEnvio + INTERVALO_MIN_MS + Math.random() * JITTER_MS - agora;
      if (falta > 0) await esperar(falta);

      const texto = fila.shift();
      try {
        // "digitando..." como uma pessoa (direto, sem getChatById, que quebra na versão atual do WhatsApp Web)
        await client.pupPage.evaluate((id) => window.WWebJS.sendChatstate('typing', id), meuId);
        await esperar(1000 + Math.min(texto.length * 15, 3000));
      } catch (e) {
        log(`aviso: "digitando" falhou (${e.stack?.split('\n').slice(0, 2).join(' | ')}); enviando assim mesmo`);
      }
      await client.sendMessage(meuId, texto);
      ultimoEnvio = Date.now();
      enviadasNaHora.push(ultimoEnvio);
      log(`mensagem enviada (${texto.length} caracteres)`);
    }
  } catch (e) {
    estado.ultimoErro = `envio: ${e.message}`;
    log('erro no envio:', e.stack?.split('\n').slice(0, 4).join(' | '));
  } finally {
    enviando = false;
  }
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
// Se a conexão voltar com mensagens paradas na fila, retoma
setInterval(() => { if (fila.length) processarFila(); }, 30000);

// ---- Servidor HTTP local ----
function tokenValido(req) {
  const t = Buffer.from(String(req.headers['x-token'] || ''));
  const esperado = Buffer.from(TOKEN);
  return t.length === esperado.length && crypto.timingSafeEqual(t, esperado);
}

function responder(res, codigo, corpo) {
  res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(corpo));
}

function lerJson(req) {
  return new Promise((ok, falha) => {
    let dados = '';
    req.on('data', (c) => { dados += c; if (dados.length > 20000) req.destroy(); });
    req.on('end', () => { try { ok(JSON.parse(dados || '{}')); } catch (e) { falha(e); } });
  });
}

const servidor = http.createServer(async (req, res) => {
  if (!tokenValido(req)) return responder(res, 401, { erro: 'não autorizado' });

  if (req.method === 'GET' && req.url === '/status') {
    return responder(res, 200, {
      status: estado.status, desde: estado.desde, ultimo_erro: estado.ultimoErro, na_fila: fila.length,
    });
  }
  if (req.method === 'GET' && req.url === '/qr') {
    // O QR só existe enquanto a sessão precisa ser (re)conectada
    if (!estado.qr) return responder(res, 404, { erro: 'sem QR: a sessão não precisa de reconexão' });
    return responder(res, 200, { qr: estado.qr });
  }
  if (req.method === 'POST' && req.url === '/send') {
    let corpo;
    try { corpo = await lerJson(req); } catch { return responder(res, 400, { erro: 'JSON inválido' }); }
    const texto = String(corpo.texto || '').trim();
    if (!texto) return responder(res, 400, { erro: 'texto vazio' });
    if (texto.length > 4000) return responder(res, 400, { erro: 'texto longo demais' });
    return responder(res, 202, { na_fila: enfileirar(texto), status: estado.status });
  }
  responder(res, 404, { erro: 'rota inexistente' });
});

servidor.listen(PORTA, '127.0.0.1', () => log(`ouvindo em http://127.0.0.1:${PORTA}`));

const sair = async () => { log('encerrando'); await client?.destroy().catch(() => {}); process.exit(0); };
process.on('SIGINT', sair);
process.on('SIGTERM', sair);

criarCliente();
