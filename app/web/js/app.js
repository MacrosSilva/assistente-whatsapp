// Painel do assistente: navegação, telas e atualização automática do status.
import {
  $, el, icone, api, relativo, dataHora, saudacao, TEMAS, tema, tagTema, toast,
  comCarregando, imagemNoticia, guardar, ler,
} from './util.js';
import { barrasEmpilhadas, rosca, minigrafico } from './graficos.js';

const PAGINAS = [
  { rota: '', nome: 'Visão geral', icone: 'painel', tela: telaVisaoGeral },
  { rota: 'noticias', nome: 'Notícias', icone: 'jornal', tela: telaNoticias },
  { rota: 'whatsapp', nome: 'WhatsApp', icone: 'whatsapp', tela: telaWhatsapp },
  { rota: 'modulos', nome: 'Módulos', icone: 'blocos', tela: telaModulos },
  { rota: 'config', nome: 'Configurações', icone: 'ajustes', tela: telaConfig },
  { rota: 'historico', nome: 'Histórico', icone: 'relogio', tela: telaHistorico },
];

const ESTADOS_WHATS = {
  conectado: ['Conectado', 'ok', 'Sessão ativa. Mensagens saem com intervalo de segurança.'],
  aguardando_qr: ['Aguardando QR code', 'alerta', 'Escaneie o QR code com o número reserva para conectar.'],
  precisa_qr: ['Precisa de novo QR', 'alerta', 'A sessão foi encerrada no celular. Um QR novo está sendo gerado.'],
  desconectado: ['Reconectando…', 'alerta', 'A conexão caiu. A ponte está tentando reconectar sozinha.'],
  iniciando: ['Iniciando…', 'alerta', 'A ponte está abrindo o WhatsApp Web.'],
  erro: ['Erro na ponte', 'erro', 'A ponte encontrou um erro. Veja os detalhes abaixo.'],
  ponte_desligada: ['Ponte desligada', 'erro', 'A ponte do WhatsApp não está rodando (pasta bridge: npm start).'],
};
const infoWhats = (st) => ESTADOS_WHATS[st] || [st || 'Desconhecido', 'alerta', ''];

const MODULOS_FUTUROS = {
  email: { titulo: 'E-mail (Gmail)', icone: 'email', descricao: 'Avisa na hora sobre e-mails importantes, com regras de remetentes e palavras. Somente leitura.', etapa: 'Etapa 4' },
  agenda: { titulo: 'Google Agenda', icone: 'calendario', descricao: 'Lembretes antes dos compromissos e a agenda do dia quando você pedir. Somente leitura.', etapa: 'Etapa 4' },
};
const ICONE_MODULO = { noticias: 'rss', email: 'email', agenda: 'calendario' };

const estado = {
  status: null,          // último /api/status
  config: null,          // configuração salva
  rascunho: null,        // configuração em edição
  abaConfig: 'geral',
  filtros: { dias: 7, tema: '', fonte: '', q: '', status: '' },
  abaHist: 'envios',
  filtroHist: '',
  aoStatus: null,        // a tela atual pode reagir a cada atualização de status
  timers: [],
};

// ================= estrutura geral =================
function rotaAtual() { return location.hash.replace(/^#\/?/, '').split('?')[0]; }

function desenharMenu() {
  const atual = rotaAtual();
  $('#menu').replaceChildren(...PAGINAS.map((p) => el('a', {
    href: `#/${p.rota}`, class: p.rota === atual ? 'ativo' : '', 'aria-current': p.rota === atual ? 'page' : null,
  }, icone(p.icone), el('span', {}, p.nome))));
}

function cabecalho(titulo, sub, ...acoes) {
  return el('header', { class: 'cab-pagina' },
    el('div', {}, el('h1', {}, titulo), sub ? el('p', {}, sub) : null),
    acoes.length ? el('div', { class: 'acoes' }, acoes) : null);
}

function card(titulo, sub, extra, ...corpo) {
  return el('section', { class: 'card' },
    titulo ? el('div', { class: 'card-cab' }, el('div', {}, el('h2', {}, titulo), sub ? el('div', { class: 'sub' }, sub) : null), extra) : null,
    el('div', { class: 'card-corpo' }, corpo));
}

function vazio(icon, titulo, texto) {
  return el('div', { class: 'vazio' }, icone(icon), el('h3', {}, titulo), texto ? el('p', {}, texto) : null);
}

async function navegar() {
  estado.timers.forEach(clearInterval);
  estado.timers = [];
  estado.aoStatus = null;
  desenharMenu();
  const pagina = PAGINAS.find((p) => p.rota === rotaAtual()) || PAGINAS[0];
  document.title = `${pagina.nome} · Assistente`;
  const raiz = $('#conteudo');
  raiz.replaceChildren(el('div', { class: 'esqueleto carregando-pagina' }));
  try {
    await pagina.tela(raiz);
  } catch (e) {
    raiz.replaceChildren(vazio('alerta', 'Não foi possível carregar', e.message));
  }
  window.scrollTo(0, 0);
}

// ---------- status (a cada 5 s) ----------
async function atualizarStatus() {
  try {
    estado.status = await api('GET', '/api/status');
  } catch {
    estado.status = null;
  }
  const w = estado.status?.whatsapp || { status: estado.status ? 'ponte_desligada' : 'nucleo' };
  const [texto, tipo] = estado.status ? infoWhats(w.status) : ['Núcleo inacessível', 'erro'];
  const mini = $('#whats-mini');
  mini.querySelector('.ponto').className = `ponto ${tipo}`;
  mini.querySelector('.txt').textContent = texto;
  mini.title = `WhatsApp: ${texto}`;

  const faixa = $('#faixa');
  if (tipo === 'ok') {
    faixa.classList.add('oculto');
  } else {
    const msg = !estado.status ? 'O núcleo (Python) não está respondendo. Inicie com: python -m app'
      : w.status === 'aguardando_qr' || w.status === 'precisa_qr' ? 'O WhatsApp precisa ser reconectado com um QR code.'
        : `WhatsApp: ${texto}`;
    faixa.replaceChildren(icone('alerta'), el('span', {}, msg),
      rotaAtual() !== 'whatsapp' && estado.status ? el('a', { href: '#/whatsapp' }, 'Resolver') : null);
    faixa.className = `faixa ${tipo === 'erro' ? 'erro' : ''}`;
  }
  estado.aoStatus?.();
}

// ---------- tema claro/escuro ----------
function aplicarTema(t) {
  document.documentElement.dataset.tema = t;
  const bt = $('#bt-tema');
  bt.replaceChildren(icone(t === 'escuro' ? 'sol' : 'lua'));
  bt.title = t === 'escuro' ? 'Usar tema claro' : 'Usar tema escuro';
}

// ---------- ações reutilizadas ----------
function botaoTeste() {
  return el('button', {
    class: 'botao', onclick: (e) => {
      const b = e.currentTarget;
      comCarregando(b, async () => {
        try {
          const r = await api('POST', '/api/acoes/teste');
          toast(r.ok ? 'Mensagem de teste enviada ao WhatsApp.' : 'A ponte não aceitou a mensagem.', r.ok ? 'ok' : 'erro');
        } catch (err) { toast(err.message, 'erro'); }
      });
    },
  }, icone('celular'), 'Mensagem de teste');
}

function botaoAgora() {
  return el('button', {
    class: 'botao primario', onclick: (e) => {
      const b = e.currentTarget;
      comCarregando(b, async () => {
        try {
          const r = await api('POST', '/api/acoes/agora');
          toast(r.enviados.length ? `Enviado: ${r.enviados.join(', ')}` : 'Nada novo para enviar agora.', r.enviados.length ? 'ok' : 'alerta');
        } catch (err) { toast(err.message, 'erro'); }
      });
    },
  }, icone('enviar'), 'Enviar novidades agora');
}

// ================= Visão geral =================
async function telaVisaoGeral(raiz, recarga = false) {
  const [st, est, nots, hist] = await Promise.all([
    api('GET', '/api/status'), api('GET', '/api/estatisticas'),
    api('GET', '/api/noticias?dias=7&limite=6'), api('GET', '/api/historico'),
  ]);
  const totaisDia = Object.values(est.por_dia).map((d) => Object.values(d).reduce((a, b) => a + b, 0));
  const hojeKey = Object.keys(est.por_dia).at(-1);
  const deHoje = Object.values(est.por_dia[hojeKey] || {}).reduce((a, b) => a + b, 0);
  const porTema = {};
  Object.values(est.por_dia).forEach((d) => Object.entries(d).forEach(([k, v]) => { porTema[k] = (porTema[k] || 0) + v; }));
  const [wTexto, wTipo] = infoWhats(st.whatsapp.status);
  const silencio = st.silencio;
  const nErros = Object.keys(est.fontes_com_erro).length;

  const kpi = (icon, rot, valor, det, detClasse, extra) => el('div', { class: 'card kpi' },
    el('div', { class: 'rot' }, icone(icon, 'p'), rot), el('div', { class: 'valor' }, valor),
    el('div', { class: `det ${detClasse || ''}` }, det), extra);

  const atividade = [
    ...hist.envios.map((e) => ({ quando: e.quando, tipo: e.ok ? 'ok' : 'erro', icone: e.origem === 'comando' ? 'whatsapp' : 'enviar',
      texto: `${e.origem === 'comando' ? 'Resposta a comando' : e.origem === 'painel' ? 'Envio pelo painel' : 'Envio automático'}: ${e.texto.split('\n')[0]}` })),
    ...hist.eventos.map((e) => ({ quando: e.quando, tipo: e.nivel === 'erro' ? 'erro' : e.nivel === 'aviso' ? 'alerta' : '',
      icone: e.nivel === 'info' ? 'check' : 'alerta', texto: e.mensagem })),
  ].sort((a, b) => b.quando.localeCompare(a.quando)).slice(0, 8);

  raiz.replaceChildren(
    cabecalho(`${saudacao()}!`, `${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })} · resumo da sua automação`,
      botaoTeste(), botaoAgora()),

    el('div', { class: 'grade g-4' },
      kpi('jornal', 'Notícias na semana', est.semana, `${deHoje} publicadas hoje`, '', minigrafico(totaisDia)),
      kpi('enviar', 'Enviadas hoje', est.enviadas_hoje, `${est.mensagens_hoje} mensagens no WhatsApp`),
      kpi('rss', 'Próxima leitura', est.proxima_leitura ? relativo(est.proxima_leitura) : '—',
        nErros ? `${nErros} fonte(s) com falha` : `${est.fontes_ativas} de ${est.fontes_total} fontes ativas`, nErros ? 'erro' : 'ok'),
      kpi('whatsapp', 'WhatsApp', wTexto,
        silencio.agora ? `Em silêncio até ${silencio.fim}` : `Silêncio das ${silencio.inicio} às ${silencio.fim}`, wTipo === 'ok' ? '' : 'erro'),
    ),

    el('div', { class: 'grade g-3-1' },
      card('Notícias por dia', 'Últimos 7 dias, por tema', legenda(),
        barrasEmpilhadas(est.por_dia)),
      card('Por tema', 'Distribuição da semana', null,
        el('div', { class: 'rosca-caixa' }, rosca(porTema),
          el('div', { class: 'legenda coluna' }, Object.entries(TEMAS).map(([k, t]) =>
            el('span', {}, el('span', {}, el('i', { class: `bg-${t.classe}` }), t.nome), el('b', {}, porTema[k] || 0)))))),
    ),

    el('div', { class: 'grade g-3-1' },
      card('Últimas notícias', `${nots.total} na semana`, el('a', { class: 'link-card', href: '#/noticias' }, 'Ver todas', icone('abrir', 'p')),
        nots.itens.length ? el('div', { class: 'lista-noticias' }, nots.itens.map(itemNoticia))
          : vazio('jornal', 'Nenhuma notícia ainda', 'Elas aparecem aqui depois da primeira leitura das fontes.')),
      card('Atividade recente', null, el('a', { class: 'link-card', href: '#/historico' }, 'Histórico', icone('abrir', 'p')),
        atividade.length ? el('ul', { class: 'atividade' }, atividade.map((a) => el('li', {},
          el('span', { class: `bolinha ${a.tipo}` }, icone(a.icone, 'p')),
          el('div', {}, el('div', { class: 'txt' }, a.texto.length > 120 ? `${a.texto.slice(0, 117)}…` : a.texto),
            el('div', { class: 'quando' }, relativo(a.quando))))))
          : vazio('relogio', 'Sem atividade ainda')),
    ),
  );
  if (!recarga) estado.timers.push(setInterval(() => telaVisaoGeral(raiz, true).catch(() => {}), 60000));
}

function legenda() {
  return el('div', { class: 'legenda' }, Object.values(TEMAS).map((t) => el('span', {}, el('i', { class: `bg-${t.classe}` }), t.nome)));
}

function itemNoticia(n) {
  return el('div', { class: 'item-noticia' },
    el('div', { class: 'miniatura' }, imagemNoticia(n, 'miniatura')),
    el('div', {},
      el('a', { class: 'titulo', href: n.link, target: '_blank', rel: 'noopener noreferrer' }, n.titulo),
      el('div', { class: 'meta' }, tagTema(n.tema), el('span', {}, n.fonte), el('span', {}, '·'), el('span', {}, relativo(n.publicada)))),
    seloStatus(n));
}

function seloStatus(n) {
  if (n.urgente && n.status === 'enviada') return el('span', { class: 'tag erro selo' }, icone('raio', 'p'), 'Urgente');
  if (n.status === 'enviada') return el('span', { class: 'tag ok selo', title: `Enviada ${dataHora(n.enviada)}` }, icone('check', 'p'), 'Enviada');
  if (n.status === 'filtrada') return el('span', { class: 'tag neutra selo' }, icone('filtro', 'p'), 'Filtrada');
  return null;
}

// ================= Notícias =================
async function telaNoticias(raiz) {
  const f = estado.filtros;
  let pagina = 0;
  let itens = [];
  const grade = el('div', { class: 'grade-noticias' });
  const resultado = el('span', { class: 'resultado' });
  const chips = el('div', { class: 'chips' });
  const selFonte = el('select', { class: 'select-filtro', 'aria-label': 'Fonte',
    onchange: (e) => { f.fonte = e.target.value; carregar(true); } });
  const maisCaixa = el('div', { class: 'mais-caixa' });
  let espera;
  const busca = el('input', { type: 'search', placeholder: 'Buscar por título ou texto…', value: f.q, 'aria-label': 'Buscar',
    oninput: (e) => { clearTimeout(espera); espera = setTimeout(() => { f.q = e.target.value; carregar(true); }, 300); } });

  const segmentado = (opcoes, chave, rotuloAria) => {
    const caixa = el('div', { class: 'segmentado', role: 'group', 'aria-label': rotuloAria });
    const desenhar = () => caixa.replaceChildren(...opcoes.map(([v, nome]) => el('button', {
      type: 'button', class: f[chave] === v ? 'ativo' : '', onclick: () => { f[chave] = v; desenhar(); carregar(true); },
    }, nome)));
    desenhar();
    return caixa;
  };

  async function carregar(doZero) {
    if (doZero) { pagina = 0; itens = []; }
    const qs = new URLSearchParams({ dias: f.dias, tema: f.tema, fonte: f.fonte, q: f.q, status: f.status, limite: 24, pagina });
    const r = await api('GET', `/api/noticias?${qs}`);
    itens = itens.concat(r.itens);
    resultado.textContent = `${r.total} notícia${r.total === 1 ? '' : 's'}`;
    // chips de tema com contagem
    const totalTemas = Object.values(r.por_tema).reduce((a, b) => a + b, 0);
    chips.replaceChildren(
      el('button', { type: 'button', class: `chip ${f.tema ? '' : 'ativo'}`, onclick: () => { f.tema = ''; carregar(true); } },
        'Todos', el('span', { class: 'n' }, totalTemas)),
      ...Object.entries(TEMAS).map(([k, t]) => el('button', {
        type: 'button', class: `chip ${f.tema === k ? 'ativo' : ''}`, onclick: () => { f.tema = f.tema === k ? '' : k; carregar(true); },
      }, el('i', { class: `bg-${t.classe}` }), t.nome, el('span', { class: 'n' }, r.por_tema[k] || 0))));
    selFonte.replaceChildren(el('option', { value: '' }, 'Todas as fontes'),
      ...Object.entries(r.por_fonte).map(([nome, n]) => el('option', { value: nome, selected: f.fonte === nome }, `${nome} (${n})`)));
    if (f.fonte && !(f.fonte in r.por_fonte)) selFonte.append(el('option', { value: f.fonte, selected: true }, f.fonte));

    if (doZero) grade.replaceChildren();
    grade.append(...r.itens.map(cartaoNoticia));
    if (!itens.length) grade.replaceChildren(vazio('busca', 'Nada encontrado', 'Tente outro filtro ou período.'));
    maisCaixa.replaceChildren(itens.length < r.total ? el('button', {
      class: 'botao', onclick: (e) => { const b = e.currentTarget; pagina += 1; comCarregando(b, () => carregar(false)); },
    }, `Carregar mais (${r.total - itens.length} restantes)`) : null);
  }

  raiz.replaceChildren(
    cabecalho('Notícias', 'Tudo o que o assistente encontrou nas suas fontes. O WhatsApp recebe só as novidades.',
      el('button', { class: 'botao', onclick: (e) => { const b = e.currentTarget; comCarregando(b, () => carregar(true)); } },
        icone('atualizar'), 'Atualizar')),
    el('div', { class: 'barra-filtros' },
      el('div', { class: 'linha-filtros' },
        el('div', { class: 'busca' }, icone('busca', 'p'), busca),
        segmentado([[1, 'Hoje'], [3, '3 dias'], [7, '7 dias']], 'dias', 'Período'),
        segmentado([['', 'Relevantes'], ['enviada', 'Enviadas'], ['filtrada', 'Filtradas']], 'status', 'Situação'),
        selFonte),
      el('div', { class: 'linha-filtros' }, chips, resultado)),
    grade, maisCaixa);
  await carregar(true);
}

function cartaoNoticia(n) {
  const info = tema(n.tema);
  const selo = seloStatus(n);
  const capa = el('div', { class: 'capa' }, imagemNoticia(n), el('span', { class: `tag ${info.classe}` }, info.nome), selo);
  const botaoEnviar = el('button', {
    class: 'botao fantasma pequeno', title: 'Enviar esta notícia ao seu WhatsApp',
    onclick: (e) => {
      const b = e.currentTarget;
      comCarregando(b, async () => {
        try {
          const r = await api('POST', '/api/noticias/enviar', { chave: n.chave });
          if (!r.ok) throw new Error('a ponte não aceitou');
          toast('Notícia enviada ao WhatsApp.');
          n.status = 'enviada'; n.enviada = new Date().toISOString();
          capa.querySelector('.selo')?.remove();
          capa.append(seloStatus(n));
        } catch (err) { toast(`Não enviou: ${err.message}`, 'erro'); }
      });
    },
  }, icone('enviar', 'p'), 'Enviar');
  return el('article', { class: 'cartao' },
    el('a', { href: n.link, target: '_blank', rel: 'noopener noreferrer', tabindex: '-1', 'aria-hidden': 'true' }, capa),
    el('div', { class: 'corpo' },
      el('div', { class: 'meta' }, el('span', {}, n.fonte), el('span', {}, '·'), el('span', { title: dataHora(n.publicada) }, relativo(n.publicada))),
      el('h3', {}, el('a', { href: n.link, target: '_blank', rel: 'noopener noreferrer' }, n.titulo)),
      n.resumo ? el('p', { class: 'resumo' }, n.resumo) : null),
    el('div', { class: 'pe' },
      el('span', { class: 'meta' }, dataHora(n.publicada)),
      el('div', { class: 'botoes' },
        el('a', { class: 'botao fantasma pequeno', href: n.link, target: '_blank', rel: 'noopener noreferrer' }, icone('abrir', 'p'), 'Abrir'),
        botaoEnviar)));
}

// ================= WhatsApp =================
async function telaWhatsapp(raiz) {
  const cfg = await api('GET', '/api/config');
  const caixaStatus = el('div');
  const caixaQr = el('div');
  let ultimoQr = 0;

  const desenhar = () => {
    const st = estado.status;
    if (!st) { caixaStatus.replaceChildren(card(null, null, null, vazio('alerta', 'Núcleo inacessível'))); return; }
    const w = st.whatsapp;
    const [texto, tipo, desc] = infoWhats(w.status);
    caixaStatus.replaceChildren(el('section', { class: 'card status-grande' },
      el('div', { class: `icone-estado ${tipo}` }, icone(tipo === 'ok' ? 'whatsapp' : 'alerta')),
      el('div', {},
        el('h2', {}, texto),
        el('p', {}, desc),
        el('p', {}, w.desde ? `Desde ${dataHora(w.desde)}` : '', w.na_fila ? ` · ${w.na_fila} mensagem(ns) na fila` : ''),
        w.ultimo_erro ? el('p', { class: 'det erro' }, `Último erro: ${w.ultimo_erro}`) : null),
      el('div', { class: 'acoes' }, botaoTeste())));

    const precisa = w.status === 'aguardando_qr' || w.status === 'precisa_qr';
    if (!precisa) { caixaQr.replaceChildren(); return; }
    if (Date.now() - ultimoQr < 2500 && caixaQr.firstChild) return;
    ultimoQr = Date.now();
    api('GET', '/api/qr').then(({ qr }) => {
      caixaQr.replaceChildren(card('Conectar o número reserva', 'O código muda sozinho a cada ~20 segundos', null,
        el('div', { class: 'qr-area' },
          el('ol', { class: 'passos' },
            el('li', {}, el('div', {}, el('b', {}, 'Abra o WhatsApp'), ' no celular do número reserva.')),
            el('li', {}, el('div', {}, 'Toque em ', el('b', {}, '⋮ → Dispositivos conectados'), '.')),
            el('li', {}, el('div', {}, 'Toque em ', el('b', {}, 'Conectar dispositivo'), ' e aponte para o código.'))),
          el('img', { src: qr, alt: 'QR code para conectar o WhatsApp' }))));
    }).catch(() => caixaQr.replaceChildren(card('Conectar o número reserva', null, null, vazio('qr', 'Gerando QR code…'))));
  };

  const comandos = [['ajuda', 'lista de comandos'], ['ping', 'testa se o bot está vivo']];
  (estado.status?.modulos || []).filter((m) => m.ativo).forEach((m) => Object.entries(m.comandos).forEach((c) => comandos.unshift(c)));

  raiz.replaceChildren(
    cabecalho('WhatsApp', 'Conexão do número reserva, que envia as mensagens para o seu número principal.'),
    caixaStatus, el('div', { class: 'grade' }, caixaQr),
    el('div', { class: 'grade g-2' },
      card('Proteções ativas', 'Para reduzir o risco de banimento', null,
        el('ul', { class: 'lista-check' },
          [['Só responde ao seu número principal', 'Qualquer outro contato é ignorado em silêncio.'],
            ['Intervalo entre mensagens', 'Pelo menos 8 s + variação aleatória, com "digitando…".'],
            [`Máximo de ${cfg.envio.max_mensagens_por_hora} mensagens automáticas por hora`, 'Respostas aos seus comandos não contam.'],
            [`Silêncio das ${cfg.silencio.inicio} às ${cfg.silencio.fim}`, 'O que chegar à noite sai de manhã, junto.'],
            ['Aparece como offline', 'O número reserva não fica "online" o tempo todo.'],
            ['Reconexão automática', 'Se cair, tenta de novo sozinha; o QR aparece aqui se precisar.']]
            .map(([t, d]) => el('li', {}, icone('escudo', 'p'), el('div', {}, t, el('small', {}, d)))))),
      card('Comandos', 'Mande do seu número principal', null,
        el('div', { class: 'comandos' }, comandos.map(([c, d]) => el('div', {}, el('span', { class: 'cmd' }, c), el('span', {}, d)))))),
  );
  desenhar();
  estado.aoStatus = desenhar;
}

// ================= Módulos =================
async function telaModulos(raiz) {
  const [st, cfg] = await Promise.all([api('GET', '/api/status'), api('GET', '/api/config')]);
  const existentes = new Set(st.modulos.map((m) => m.nome));
  const futuros = Object.keys(cfg.modulos_ativos).filter((n) => !existentes.has(n) && MODULOS_FUTUROS[n]);

  const cartao = (m) => el('article', { class: 'card modulo' },
    el('div', { class: 'topo' },
      el('div', { class: 'icone-mod' }, icone(ICONE_MODULO[m.nome] || 'blocos', 'g')),
      el('div', {}, el('h3', {}, m.titulo), el('span', { class: `tag ${m.ativo ? 'ok' : 'neutra'}` }, m.ativo ? 'Ligado' : 'Desligado')),
      el('label', { class: 'chave', title: m.ativo ? 'Desligar' : 'Ligar' },
        el('input', { type: 'checkbox', checked: m.ativo, 'aria-label': `Ligar ou desligar ${m.titulo}`,
          onchange: async (e) => {
            try {
              await api('POST', `/api/modulos/${m.nome}`, { ativo: e.target.checked });
              toast(`${m.titulo} ${e.target.checked ? 'ligado' : 'desligado'}.`);
              telaModulos(raiz);
            } catch (err) { e.target.checked = !e.target.checked; toast(err.message, 'erro'); }
          } }),
        el('span'))),
    el('p', {}, m.descricao || ''),
    el('div', { class: 'cmds' }, Object.keys(m.comandos).map((c) => el('span', { class: 'cmd' }, c))));

  const futuro = (nome) => {
    const f = MODULOS_FUTUROS[nome];
    return el('article', { class: 'card modulo futuro' },
      el('div', { class: 'topo' }, el('div', { class: 'icone-mod' }, icone(f.icone, 'g')),
        el('div', {}, el('h3', {}, f.titulo)), el('span', { class: 'tag neutra' }, f.etapa)),
      el('p', {}, f.descricao));
  };

  raiz.replaceChildren(
    cabecalho('Módulos', 'Cada fonte de informação é um módulo independente. Novos módulos aparecem aqui sozinhos.'),
    el('div', { class: 'grade-modulos' }, st.modulos.map(cartao), futuros.map(futuro)),
    el('div', { class: 'grade' }, card('Como adicionar um módulo', null, null,
      el('p', {}, 'Crie um arquivo em ', el('code', {}, 'app/modules/'), ' com uma classe que herda de ', el('code', {}, 'Module'),
        '. Ele aparece aqui, ganha uma aba em Configurações e seus comandos entram no ', el('code', {}, 'ajuda'), ' automaticamente.'))));
}

// ================= Configurações =================
const ROTULOS = {
  silencio: 'Horário de silêncio', inicio: 'Início', fim: 'Fim',
  envio: 'Limites de envio', max_mensagens_por_hora: 'Mensagens automáticas por hora',
  leitura_min: 'Ler as fontes a cada', intervalo_min: 'Enviar no máximo a cada',
  max_itens_por_mensagem: 'Notícias por mensagem', palavras_urgentes: 'Palavras urgentes',
  palavras_incluir: 'Só enviar se contiver', palavras_excluir: 'Nunca enviar se contiver', fontes: 'Fontes RSS',
  so_nao_lidos: 'Só e-mails não lidos', remetentes: 'Remetentes importantes', palavras: 'Palavras importantes',
  antecedencia_min: 'Avisar antes do compromisso', ativa: 'Ativa', nome: 'Nome', url: 'Endereço do feed', tema: 'Tema',
};
const DICAS = {
  inicio: 'Nada é enviado entre o início e o fim.', fim: 'O que chegou durante o silêncio sai neste horário, junto.',
  max_mensagens_por_hora: 'Freio de segurança. Respostas aos seus comandos não contam.',
  leitura_min: 'Em minutos. Ler as fontes não tem relação com o WhatsApp: não aumenta o risco.',
  intervalo_min: 'Em minutos. Notícias novas se acumulam e saem juntas neste intervalo.',
  max_itens_por_mensagem: 'O restante fica disponível pelo comando "mais".',
  palavras_urgentes: 'Uma por linha. Notícias com estas palavras saem na hora, sem esperar o intervalo.',
  palavras_incluir: 'Uma por linha. Deixe vazio para aceitar todos os assuntos.',
  palavras_excluir: 'Uma por linha. Não diferencia maiúsculas nem acentos.',
  remetentes: 'Um por linha (e-mail ou parte dele, ex.: @banco.com.br).',
  antecedencia_min: 'Em minutos, separados por vírgula. Ex.: 60, 10',
};
const DESC_SECAO = {
  silencio: 'Período em que o assistente não envia nada.',
  envio: 'Limites que reduzem o risco de banimento.',
};
const OPCOES = { tema: ['geral', 'IA', 'segurança', 'programação'] };
const rotulo = (k) => ROTULOS[k] || (k.charAt(0).toUpperCase() + k.slice(1)).replaceAll('_', ' ');

async function telaConfig(raiz) {
  const [cfg, st, est] = await Promise.all([api('GET', '/api/config'), api('GET', '/api/status'), api('GET', '/api/estatisticas')]);
  if (!estado.rascunho || JSON.stringify(estado.config) !== JSON.stringify(cfg)) {
    estado.config = cfg;
    estado.rascunho = structuredClone(cfg);
  }
  const errosFonte = est.fontes_com_erro || {};
  const abas = [['geral', 'Geral', 'ajustes'], ...st.modulos.filter((m) => m.nome in cfg).map((m) => [m.nome, m.titulo, ICONE_MODULO[m.nome] || 'blocos'])];
  if (!abas.some(([id]) => id === estado.abaConfig)) estado.abaConfig = 'geral';

  const menu = el('nav', { class: 'config-menu' });
  const secoes = el('div', { class: 'config-secoes' });
  const barra = el('div', { class: 'barra-salvar oculto' },
    el('span', {}, 'Você tem alterações não salvas'),
    el('button', { class: 'botao fantasma', onclick: () => { estado.rascunho = structuredClone(estado.config); desenhar(); } }, 'Descartar'),
    el('button', { class: 'botao primario', onclick: (e) => salvar(e.currentTarget) }, icone('check', 'p'), 'Salvar'));

  const alterado = () => barra.classList.toggle('oculto', JSON.stringify(estado.rascunho) === JSON.stringify(estado.config));
  const definir = (caminho, valor) => {
    let alvo = estado.rascunho;
    caminho.slice(0, -1).forEach((k) => { alvo = alvo[k]; });
    alvo[caminho.at(-1)] = valor;
    alterado();
  };

  async function salvar(botao) {
    await comCarregando(botao, async () => {
      try {
        await api('PUT', '/api/config', estado.rascunho);
        estado.config = structuredClone(estado.rascunho);
        alterado();
        toast('Configurações salvas. Valem a partir de agora, sem reiniciar.');
      } catch (err) { toast(`Não salvou: ${err.message}`, 'erro'); }
    });
  }

  function campo(caminho, chave, valor) {
    const id = `c-${caminho.join('-')}`;
    const cab = el('div', {}, el('label', { class: 'rot', for: id }, rotulo(chave)), DICAS[chave] ? el('small', {}, DICAS[chave]) : null);
    let entrada;
    if (typeof valor === 'boolean') {
      entrada = el('label', { class: 'chave' }, el('input', { id, type: 'checkbox', checked: valor, onchange: (e) => definir(caminho, e.target.checked) }), el('span'));
    } else if (typeof valor === 'number') {
      entrada = el('input', { id, type: 'number', min: '1', value: String(valor), oninput: (e) => definir(caminho, e.target.value === '' ? 0 : Number(e.target.value)) });
    } else if (typeof valor === 'string') {
      entrada = el('input', { id, type: /^\d\d:\d\d$/.test(valor) ? 'time' : 'text', value: valor, oninput: (e) => definir(caminho, e.target.value) });
    } else if (Array.isArray(valor) && valor.length && typeof valor[0] === 'number') {
      entrada = el('input', { id, type: 'text', value: valor.join(', '),
        oninput: (e) => definir(caminho, e.target.value.split(',').map((x) => Number(x.trim())).filter((x) => x > 0)) });
    } else if (Array.isArray(valor)) {
      entrada = el('textarea', { id, value: valor.join('\n'), spellcheck: 'false',
        oninput: (e) => definir(caminho, e.target.value.split('\n').map((x) => x.trim()).filter(Boolean)) });
    }
    return el('div', { class: 'campo' }, cab, el('div', {}, entrada));
  }

  function tabelaFontes(caminho, linhas) {
    const colunas = ['ativa', 'nome', 'url', 'tema'].filter((c) => linhas.some((l) => c in l) || c !== 'ativa');
    const caixa = el('div');
    const desenharTabela = () => {
      const ativas = linhas.filter((l) => l.ativa !== false).length;
      caixa.replaceChildren(
        el('div', { class: 'tabela-caixa' }, el('table', { class: 'tabela' },
          el('thead', {}, el('tr', {}, colunas.map((c) => el('th', {}, rotulo(c))), el('th'))),
          el('tbody', {}, linhas.map((linha, i) => el('tr', {},
            colunas.map((col) => {
              const v = linha[col];
              const def = (val) => { linha[col] = val; alterado(); };
              let entrada;
              if (col === 'ativa') entrada = el('label', { class: 'chave' }, el('input', { type: 'checkbox', checked: v !== false, 'aria-label': 'Ativa', onchange: (e) => { def(e.target.checked); desenharTabela(); } }), el('span'));
              else if (OPCOES[col]) entrada = el('select', { 'aria-label': rotulo(col), onchange: (e) => def(e.target.value) }, OPCOES[col].map((o) => el('option', { value: o, selected: o === v }, tema(o).nome)));
              else entrada = el('input', { type: 'text', value: v ?? '', 'aria-label': rotulo(col), placeholder: col === 'url' ? 'https://…' : '', oninput: (e) => def(e.target.value) });
              return el('td', { class: col === 'ativa' ? 'estreita' : '' }, entrada);
            }),
            el('td', { class: 'estreita' },
              errosFonte[linha.nome] ? el('span', { class: 'erro-fonte', title: `Falhou na última leitura: ${errosFonte[linha.nome]}` }, icone('alerta', 'p')) : null,
              el('button', { type: 'button', class: 'botao fantasma pequeno perigo', title: 'Remover fonte', 'aria-label': `Remover ${linha.nome}`,
                onclick: () => { linhas.splice(i, 1); alterado(); desenharTabela(); } }, icone('lixo', 'p')))))))),
        el('div', { class: 'tabela-acoes' },
          el('span', { class: 'resultado' }, `${linhas.length} fontes · ${ativas} ativas`),
          el('button', { type: 'button', class: 'botao pequeno', onclick: () => {
            linhas.push({ ativa: true, nome: '', url: '', tema: 'geral' });
            alterado(); desenharTabela();
            caixa.querySelector('tbody tr:last-child input[type=text]')?.focus();
          } }, icone('mais', 'p'), 'Adicionar fonte')));
    };
    desenharTabela();
    return caixa;
  }

  function desenhar() {
    menu.replaceChildren(...abas.map(([id, nome, icon]) => el('button', {
      type: 'button', class: id === estado.abaConfig ? 'ativo' : '', onclick: () => { estado.abaConfig = id; desenhar(); },
    }, icone(icon, 'p'), nome)));
    const r = estado.rascunho;
    let blocos;
    if (estado.abaConfig === 'geral') {
      blocos = ['silencio', 'envio'].filter((s) => s in r).map((s) =>
        card(rotulo(s), DESC_SECAO[s], null, Object.entries(r[s]).map(([k, v]) => campo([s, k], k, v))));
    } else {
      const s = estado.abaConfig;
      const entradas = Object.entries(r[s]);
      const escalares = entradas.filter(([, v]) => !Array.isArray(v) && typeof v !== 'object');
      const listas = entradas.filter(([, v]) => Array.isArray(v) && !(v.length && typeof v[0] === 'object'));
      const tabelas = entradas.filter(([, v]) => Array.isArray(v) && v.length && typeof v[0] === 'object');
      blocos = [
        escalares.length ? card('Ritmo e limites', null, null, escalares.map(([k, v]) => campo([s, k], k, v))) : null,
        listas.length ? card('Palavras-chave', 'Comparação sem diferenciar maiúsculas e acentos', null, listas.map(([k, v]) => campo([s, k], k, v))) : null,
        ...tabelas.map(([k, v]) => card(rotulo(k), k === 'fontes' ? 'Ligue, desligue, edite ou adicione feeds' : null, null, tabelaFontes([s, k], v))),
      ];
    }
    secoes.replaceChildren(...blocos.filter(Boolean));
    alterado();
  }

  raiz.replaceChildren(
    cabecalho('Configurações', 'Tudo fica salvo no config.json do seu PC. Segredos (.env) nunca aparecem aqui.'),
    el('div', { class: 'config-layout' }, menu, secoes), barra);
  desenhar();
}

// ================= Histórico =================
async function telaHistorico(raiz) {
  const h = await api('GET', '/api/historico');
  const lista = el('ul', { class: 'linhas-hist' });
  const filtros = el('div', { class: 'chips' });
  const abas = el('div', { class: 'segmentado' });

  const ORIGENS = { '': 'Todos', noticias: 'Automáticos', comando: 'Comandos', painel: 'Painel' };
  const NIVEIS = { '': 'Todos', erro: 'Erros', aviso: 'Avisos', info: 'Informações' };
  const NIVEL_TAG = { erro: ['Erro', 'erro'], aviso: ['Aviso', 'alerta'], info: ['Info', 'neutra'] };

  function desenhar() {
    abas.replaceChildren(...[['envios', 'Envios'], ['eventos', 'Erros e avisos']].map(([id, nome]) => el('button', {
      type: 'button', class: estado.abaHist === id ? 'ativo' : '', onclick: () => { estado.abaHist = id; estado.filtroHist = ''; desenhar(); },
    }, nome)));
    const opcoes = estado.abaHist === 'envios' ? ORIGENS : NIVEIS;
    filtros.replaceChildren(...Object.entries(opcoes).map(([v, nome]) => el('button', {
      type: 'button', class: `chip ${estado.filtroHist === v ? 'ativo' : ''}`, onclick: () => { estado.filtroHist = v; desenhar(); },
    }, nome)));

    const linhas = estado.abaHist === 'envios'
      ? h.envios.filter((e) => !estado.filtroHist || (estado.filtroHist === 'noticias' ? !['comando', 'painel'].includes(e.origem) : e.origem === estado.filtroHist))
        .map((e) => [e.quando, e.origem === 'comando' ? 'comando' : e.origem === 'painel' ? 'painel' : 'automático',
          e.ok ? e.texto : `${e.erro}\n${e.texto}`, e.ok ? el('span', { class: 'tag ok' }, 'Enviado') : el('span', { class: 'tag erro' }, 'Falhou')])
      : h.eventos.filter((e) => !estado.filtroHist || e.nivel === estado.filtroHist)
        .map((e) => [e.quando, e.origem, e.mensagem,
          el('span', { class: `tag ${(NIVEL_TAG[e.nivel] || [, 'neutra'])[1]}` }, (NIVEL_TAG[e.nivel] || [e.nivel])[0])]);

    lista.replaceChildren(...(linhas.length ? linhas.map(([q, origem, texto, selo]) => el('li', {
      onclick: (ev) => ev.currentTarget.classList.toggle('aberto'), title: 'Clique para ver tudo',
    }, el('time', {}, dataHora(q)), el('span', { class: 'origem' }, el('span', { class: 'tag neutra' }, origem)), el('div', { class: 'txt' }, texto), selo))
      : [el('li', {}, vazio('relogio', 'Nada por aqui ainda'))]));
  }

  raiz.replaceChildren(
    cabecalho('Histórico', 'As últimas mensagens enviadas e os eventos do sistema.',
      el('button', { class: 'botao', onclick: () => telaHistorico(raiz) }, icone('atualizar'), 'Atualizar')),
    el('section', { class: 'card' },
      el('div', { class: 'card-cab' }, abas, filtros),
      el('div', { class: 'card-corpo' }, lista)));
  desenhar();
}

// ================= início =================
aplicarTema(ler('tema') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro'));
$('#bt-tema').addEventListener('click', () => {
  const novo = document.documentElement.dataset.tema === 'escuro' ? 'claro' : 'escuro';
  guardar('tema', novo);
  aplicarTema(novo);
});
window.addEventListener('hashchange', navegar);
await atualizarStatus();
navegar();
setInterval(atualizarStatus, 5000);
