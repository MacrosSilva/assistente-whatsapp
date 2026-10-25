// Painel do assistente. JS puro: sem framework, sem build, nada baixado da internet.
// Dados externos (títulos de notícia, erros) entram sempre como texto, nunca como HTML.

const $ = (s) => document.querySelector(s);

// Rótulos amigáveis para as chaves do config.json (chave desconhecida vira "Chave desconhecida")
const ROTULOS = {
  silencio: 'Horário de silêncio', inicio: 'Início', fim: 'Fim',
  envio: 'Limites de envio', max_mensagens_por_hora: 'Mensagens automáticas por hora (máx.)',
  leitura_min: 'Ler as fontes a cada (min)', intervalo_min: 'Enviar no máximo a cada (min)',
  max_itens_por_mensagem: 'Notícias por mensagem', palavras_urgentes: 'Palavras urgentes',
  palavras_incluir: 'Só enviar se contiver', palavras_excluir: 'Nunca enviar se contiver', fontes: 'Fontes RSS',
  so_nao_lidos: 'Só e-mails não lidos', remetentes: 'Remetentes importantes', palavras: 'Palavras importantes',
  antecedencia_min: 'Avisar antes do compromisso (min)', ativa: 'Ativa', nome: 'Nome', url: 'Endereço do feed', tema: 'Tema',
};
const DICAS = {
  inicio: 'Durante o silêncio nada é enviado; o que chegar fica para o fim do período.',
  max_mensagens_por_hora: 'Respostas aos seus comandos não contam.',
  leitura_min: 'Ler as fontes não tem relação com o WhatsApp: não aumenta o risco.',
  intervalo_min: 'As notícias novas se acumulam e saem juntas neste intervalo.',
  palavras_urgentes: 'Uma por linha. Saem na hora, sem esperar o intervalo.',
  palavras_incluir: 'Uma por linha. Vazio = aceita todos os assuntos.',
  palavras_excluir: 'Uma por linha. Não diferencia maiúsculas nem acentos.',
  remetentes: 'Um por linha (e-mail ou parte dele, ex.: @banco.com.br).',
  antecedencia_min: 'Separe por vírgula. Ex.: 60, 10',
};
const OPCOES = { tema: ['geral', 'IA', 'segurança', 'programação'] };
const SECOES_GERAIS = ['silencio', 'envio'];
const ESTADOS_WHATS = {
  conectado: ['Conectado', 'ok'], aguardando_qr: ['Aguardando QR code', 'alerta'],
  precisa_qr: ['Precisa de novo QR', 'alerta'], desconectado: ['Reconectando…', 'alerta'],
  iniciando: ['Iniciando…', 'alerta'], erro: ['Erro', 'erro'], ponte_desligada: ['Ponte desligada', 'erro'],
};

let config = null;      // como está salvo
let rascunho = null;    // o que está sendo editado
let modulos = [];
let abaConfig = 'geral';
let abaHist = 'envios';

// ---------- utilidades ----------
function el(tag, props = {}, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked' || k === 'selected') e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const f of filhos.flat()) if (f != null) e.append(f instanceof Node ? f : document.createTextNode(String(f)));
  return e;
}

async function api(metodo, caminho, corpo) {
  const r = await fetch(caminho, {
    method: metodo,
    headers: { 'content-type': 'application/json', 'x-painel': '1' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados.detail || dados.erro || `HTTP ${r.status}`);
  return dados;
}

function quando(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? `hoje ${hora}` : `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hora}`;
}

const rotulo = (k) => ROTULOS[k] || (k.charAt(0).toUpperCase() + k.slice(1)).replaceAll('_', ' ');

function avisar(alvo, texto, tipo = '') {
  const e = $(alvo);
  e.textContent = texto;
  e.className = `aviso ${tipo}`;
  clearTimeout(e._t);
  e._t = setTimeout(() => { e.textContent = ''; }, 6000);
}

// ---------- status e QR ----------
async function atualizarStatus() {
  let s;
  try { s = await api('GET', '/api/status'); } catch {
    $('#pill').textContent = 'Núcleo inacessível';
    $('#pill').className = 'pill erro';
    return;
  }
  const w = s.whatsapp || {};
  const [texto, tipo] = ESTADOS_WHATS[w.status] || [w.status || '?', 'alerta'];
  $('#pill').textContent = `WhatsApp: ${texto}`;
  $('#pill').className = `pill ${tipo}`;
  $('#st-whats').textContent = texto;
  $('#st-whats-desde').textContent = w.ultimo_erro ? w.ultimo_erro : (w.desde ? `desde ${quando(w.desde)}` : '');
  $('#st-envio').textContent = s.ultimo_envio ? quando(s.ultimo_envio.quando) : 'nenhum ainda';
  $('#st-envio-det').textContent = s.ultimo_envio ? `${s.ultimo_envio.origem}${s.ultimo_envio.ok ? '' : ' · falhou'}` : '';
  $('#st-leitura').textContent = quando(s.ultima_leitura);

  const precisaQr = w.status === 'aguardando_qr' || w.status === 'precisa_qr';
  $('#qr-card').classList.toggle('oculto', !precisaQr);
  if (precisaQr) atualizarQr();
  else $('#qr-img').removeAttribute('src');

  if (JSON.stringify(s.modulos) !== JSON.stringify(modulos)) {
    modulos = s.modulos;
    desenharModulos();
    if (config) desenharAbas();
  }
}

async function atualizarQr() {
  try {
    const { qr } = await api('GET', '/api/qr');
    $('#qr-img').src = qr;
    $('#qr-msg').textContent = 'O código muda sozinho a cada ~20 s.';
  } catch {
    $('#qr-img').removeAttribute('src');
    $('#qr-msg').textContent = 'Gerando QR code…';
  }
}

// ---------- ações ----------
async function acao(botao, caminho, sucesso) {
  botao.disabled = true;
  try {
    const r = await api('POST', caminho);
    avisar('#aviso-acao', sucesso(r), 'ok');
  } catch (e) {
    avisar('#aviso-acao', `Falhou: ${e.message}`, 'erro');
  } finally {
    botao.disabled = false;
    atualizarStatus();
    atualizarHistorico();
  }
}

// ---------- módulos ----------
function desenharModulos() {
  const ul = $('#modulos');
  ul.replaceChildren(...modulos.map((m) => el('li', {},
    el('div', {}, m.titulo, el('small', {}, `Comandos: ${Object.keys(m.comandos).join(', ') || '—'}`)),
    el('label', { class: 'chave', title: m.ativo ? 'Desligar' : 'Ligar' },
      el('input', {
        type: 'checkbox', checked: m.ativo, 'aria-label': `Ligar ${m.titulo}`,
        onchange: async (ev) => {
          try {
            await api('POST', `/api/modulos/${m.nome}`, { ativo: ev.target.checked });
            await atualizarStatus();
          } catch (e) { ev.target.checked = !ev.target.checked; alert(e.message); }
        },
      }),
      el('span')),
  )));
  if (!modulos.length) ul.append(el('li', {}, 'Nenhum módulo encontrado.'));
}

// ---------- configurações (formulário gerado a partir do config.json) ----------
function definir(caminho, valor) {
  let alvo = rascunho;
  caminho.slice(0, -1).forEach((k) => { alvo = alvo[k]; });
  alvo[caminho.at(-1)] = valor;
  marcarAlterado();
}

function marcarAlterado() {
  const mudou = JSON.stringify(rascunho) !== JSON.stringify(config);
  $('#bt-salvar').disabled = !mudou;
  $('#bt-descartar').disabled = !mudou;
}

function secoesDaAba() {
  if (abaConfig === 'geral') return SECOES_GERAIS.filter((s) => s in rascunho);
  return [abaConfig];
}

function desenharAbas() {
  const abas = [['geral', 'Geral'], ...modulos.filter((m) => m.nome in config).map((m) => [m.nome, m.titulo])];
  if (!abas.some(([id]) => id === abaConfig)) abaConfig = 'geral';
  $('#abas-config').replaceChildren(...abas.map(([id, nome]) => el('button', {
    type: 'button', class: id === abaConfig ? 'ativa' : '',
    onclick: () => { abaConfig = id; desenharAbas(); desenharForm(); },
  }, nome)));
}

function desenharForm() {
  const form = $('#form-config');
  form.replaceChildren(...secoesDaAba().map((secao) => {
    const valor = rascunho[secao];
    const campos = Object.entries(valor).map(([k, v]) => campo([secao, k], k, v));
    return abaConfig === 'geral' ? el('fieldset', {}, el('legend', {}, rotulo(secao)), campos) : el('fieldset', {}, campos);
  }));
}

function campo(caminho, chave, valor) {
  const id = `c-${caminho.join('-')}`;
  const dica = DICAS[chave] ? el('small', {}, DICAS[chave]) : null;
  let entrada;
  let largo = false;

  if (typeof valor === 'boolean') {
    entrada = el('label', { class: 'chave' },
      el('input', { id, type: 'checkbox', checked: valor, onchange: (e) => definir(caminho, e.target.checked) }), el('span'));
  } else if (typeof valor === 'number') {
    entrada = el('input', { id, type: 'number', min: '0', value: String(valor),
      oninput: (e) => definir(caminho, e.target.value === '' ? 0 : Number(e.target.value)) });
  } else if (typeof valor === 'string') {
    entrada = el('input', { id, type: /^\d\d:\d\d$/.test(valor) ? 'time' : 'text', value: valor,
      oninput: (e) => definir(caminho, e.target.value) });
  } else if (Array.isArray(valor) && valor.length && typeof valor[0] === 'object') {
    entrada = tabela(caminho, valor);
    largo = true;
  } else if (Array.isArray(valor) && valor.length && typeof valor[0] === 'number') {
    entrada = el('input', { id, type: 'text', value: valor.join(', '),
      oninput: (e) => definir(caminho, e.target.value.split(',').map((x) => Number(x.trim())).filter((x) => x > 0)) });
  } else if (Array.isArray(valor)) {
    entrada = el('textarea', { id, value: valor.join('\n'),
      oninput: (e) => definir(caminho, e.target.value.split('\n').map((x) => x.trim()).filter(Boolean)) });
  } else if (valor && typeof valor === 'object') {
    return el('fieldset', {}, el('legend', {}, rotulo(chave)),
      Object.entries(valor).map(([k, v]) => campo([...caminho, k], k, v)));
  }
  if (largo) return el('div', { class: 'campo largo' }, el('div', {}, el('label', {}, rotulo(chave)), dica), entrada);
  return el('div', { class: 'campo' }, el('div', {}, el('label', { for: id }, rotulo(chave)), dica), el('div', {}, entrada));
}

function tabela(caminho, linhas) {
  const colunas = [...new Set(linhas.flatMap(Object.keys))];
  const redesenhar = () => {
    const novo = tabela(caminho, caminho.reduce((o, k) => o[k], rascunho));
    caixa.replaceWith(novo);
  };
  const corpo = linhas.map((linha, i) => el('tr', {},
    colunas.map((col) => {
      const v = linha[col];
      const def = (val) => { linha[col] = val; marcarAlterado(); };
      let entrada;
      if (typeof v === 'boolean') {
        entrada = el('label', { class: 'chave' }, el('input', { type: 'checkbox', checked: v, 'aria-label': rotulo(col),
          onchange: (e) => def(e.target.checked) }), el('span'));
      } else if (OPCOES[col]) {
        entrada = el('select', { 'aria-label': rotulo(col), onchange: (e) => def(e.target.value) },
          OPCOES[col].map((o) => el('option', { value: o, selected: o === v }, o)));
      } else {
        entrada = el('input', { type: 'text', value: v ?? '', 'aria-label': rotulo(col), oninput: (e) => def(e.target.value) });
      }
      return el('td', { class: typeof v === 'boolean' ? 'estreita' : '' }, entrada);
    }),
    el('td', { class: 'estreita' }, el('button', { type: 'button', class: 'mini', title: 'Remover',
      onclick: () => { linhas.splice(i, 1); marcarAlterado(); redesenhar(); } }, '×')),
  ));
  const caixa = el('div', { class: 'envolve-tabela' },
    el('table', { class: 'tabela' },
      el('thead', {}, el('tr', {}, colunas.map((c) => el('th', {}, rotulo(c))), el('th'))),
      el('tbody', {}, corpo)),
    el('button', { type: 'button', class: 'mini', onclick: () => {
      linhas.push(Object.fromEntries(colunas.map((c) => [c, typeof linhas[0]?.[c] === 'boolean' ? true : (OPCOES[c]?.[0] ?? '')])));
      marcarAlterado(); redesenhar();
    } }, '+ adicionar'));
  return caixa;
}

async function carregarConfig() {
  config = await api('GET', '/api/config');
  rascunho = structuredClone(config);
  desenharAbas();
  desenharForm();
  marcarAlterado();
}

async function salvar() {
  $('#bt-salvar').disabled = true;
  try {
    await api('PUT', '/api/config', rascunho);
    await carregarConfig();
    avisar('#aviso-config', 'Salvo. Vale a partir de agora, sem reiniciar.', 'ok');
  } catch (e) {
    avisar('#aviso-config', `Não salvou: ${e.message}`, 'erro');
    marcarAlterado();
  }
}

// ---------- histórico ----------
async function atualizarHistorico() {
  let h;
  try { h = await api('GET', '/api/historico'); } catch { return; }
  const itens = abaHist === 'envios'
    ? h.envios.map((e) => el('li', {},
      el('time', {}, quando(e.quando)),
      el('span', { class: 'origem' }, e.origem),
      el('span', { class: e.ok ? 'texto' : 'texto falhou' }, e.ok ? e.texto : `Falhou: ${e.erro}\n${e.texto}`)))
    : h.eventos.map((e) => el('li', {},
      el('time', {}, quando(e.quando)),
      el('span', { class: 'origem' }, e.origem),
      el('span', { class: `texto ${e.nivel === 'erro' ? 'erro' : e.nivel === 'aviso' ? 'aviso-nivel' : ''}` }, e.mensagem)));
  $('#historico').replaceChildren(...(itens.length ? itens : [el('li', {}, el('span', { class: 'vazio' }, 'Nada por aqui ainda.'))]));
}

// ---------- início ----------
document.addEventListener('DOMContentLoaded', async () => {
  $('#bt-agora').addEventListener('click', (e) => acao(e.currentTarget, '/api/acoes/agora',
    (r) => (r.enviados.length ? `Enviado: ${r.enviados.join(', ')}` : 'Nada novo para enviar agora.')));
  $('#bt-teste').addEventListener('click', (e) => acao(e.currentTarget, '/api/acoes/teste',
    (r) => (r.ok ? 'Mensagem de teste enviada para a fila.' : 'A ponte não aceitou (veja Erros e avisos).')));
  $('#bt-salvar').addEventListener('click', salvar);
  $('#bt-descartar').addEventListener('click', () => { rascunho = structuredClone(config); desenharForm(); marcarAlterado(); });
  $('#abas-hist').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    abaHist = b.dataset.aba;
    document.querySelectorAll('#abas-hist button').forEach((x) => x.classList.toggle('ativa', x === b));
    atualizarHistorico();
  });

  await atualizarStatus();
  await carregarConfig();
  atualizarHistorico();
  setInterval(atualizarStatus, 5000);
  setInterval(atualizarHistorico, 15000);
});
