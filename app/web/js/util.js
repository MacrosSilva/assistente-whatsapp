// Utilidades do painel. Regra de segurança: dados externos entram sempre como texto (textContent),
// nunca como HTML. Só os ícones (constantes deste arquivo) usam innerHTML.

export const $ = (s, raiz = document) => raiz.querySelector(s);
export const $$ = (s, raiz = document) => [...raiz.querySelectorAll(s)];

// Ícones no estilo "linha" (desenhados à mão, sem biblioteca externa)
const ICONES = {
  painel: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  jornal: '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8M15 18h-5M10 6h8v4h-8z"/>',
  whatsapp: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01"/>',
  blocos: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M17.5 14v7M14 17.5h7"/>',
  ajustes: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M2 14h4M10 8h4M18 16h4"/>',
  relogio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  lua: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  enviar: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  abrir: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  busca: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  atualizar: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  raio: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  rss: '<path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/>',
  alerta: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkCirculo: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  mais: '<path d="M12 5v14M5 12h14"/>',
  lixo: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM21 14v.01M14 21h.01M17 21h4v-4"/>',
  escudo: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
  chip: '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4"/>',
  cadeado: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  codigo: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  globo: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  email: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  calendario: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  lua2: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/><path d="M19 3v4M21 5h-4"/>',
  fila: '<path d="M3 6h18M3 12h18M3 18h12"/>',
  olho: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  filtro: '<path d="M3 4h18l-7 9v6l-4 2v-8Z"/>',
  celular: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
};

const NS = 'http://www.w3.org/2000/svg';
export function icone(nome, classe = '') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `ico ${classe}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONES[nome] || '';
  return svg;
}

// Cria elementos: el('div', {class: 'x', onclick: fn}, 'texto', outroElemento)
export function el(tag, props = {}, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked' || k === 'selected') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat(Infinity)) {
    if (f == null || f === false) continue;
    e.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
  return e;
}

export async function api(metodo, caminho, corpo) {
  const r = await fetch(caminho, {
    method: metodo,
    headers: { 'content-type': 'application/json', 'x-painel': '1' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados.detail || dados.erro || `HTTP ${r.status}`);
  return dados;
}

// ---------- datas ----------
const _data = (v) => (typeof v === 'number' ? new Date(v) : new Date(v));
export function relativo(iso) {
  if (!iso) return '—';
  const seg = (Date.now() - _data(iso)) / 1000;
  if (seg < 0) {
    const min = Math.round(-seg / 60);
    return min < 1 ? 'agora' : min < 60 ? `em ${min} min` : `em ${Math.round(min / 60)} h`;
  }
  if (seg < 60) return 'agora';
  if (seg < 3600) return `há ${Math.floor(seg / 60)} min`;
  if (seg < 86400) return `há ${Math.floor(seg / 3600)} h`;
  const dias = Math.floor(seg / 86400);
  return dias === 1 ? 'ontem' : `há ${dias} dias`;
}
export function dataHora(iso) {
  if (!iso) return '—';
  const d = _data(iso);
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const hoje = new Date();
  const ontem = new Date(Date.now() - 86400000);
  if (d.toDateString() === hoje.toDateString()) return `Hoje, ${hora}`;
  if (d.toDateString() === ontem.toDateString()) return `Ontem, ${hora}`;
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '')}, ${hora}`;
}
export function saudacao() {
  const h = new Date().getHours();
  return h < 5 ? 'Boa madrugada' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

// ---------- temas das notícias ----------
export const TEMAS = {
  IA: { nome: 'IA', classe: 'ia', icone: 'chip' },
  'segurança': { nome: 'Segurança', classe: 'seg', icone: 'cadeado' },
  'programação': { nome: 'Programação', classe: 'prog', icone: 'codigo' },
  geral: { nome: 'Tecnologia', classe: 'geral', icone: 'globo' },
};
export const tema = (t) => TEMAS[t] || TEMAS.geral;
export function tagTema(t) {
  const info = tema(t);
  return el('span', { class: `tag ${info.classe}` }, info.nome);
}

// ---------- avisos flutuantes ----------
export function toast(texto, tipo = 'ok') {
  const t = el('div', { class: `toast ${tipo}` },
    icone(tipo === 'ok' ? 'checkCirculo' : 'alerta'), el('span', {}, texto));
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 4500);
}

// Botão que mostra "carregando" enquanto a ação roda
export async function comCarregando(botao, fn) {
  botao.classList.add('carregando');
  botao.disabled = true;
  try { return await fn(); } finally {
    botao.classList.remove('carregando');
    botao.disabled = false;
  }
}

// Imagem externa com plano B (se não carregar, mostra o ícone do tema)
export function imagemNoticia(n, classe) {
  const reserva = () => el('div', { class: `capa-vazia ${tema(n.tema).classe}` }, icone(tema(n.tema).icone));
  if (!n.imagem) return reserva();
  const img = el('img', { src: n.imagem, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', class: classe });
  img.addEventListener('error', () => img.replaceWith(reserva()), { once: true });
  return img;
}

export function guardar(chave, valor) { try { localStorage.setItem(chave, valor); } catch { /* sem armazenamento */ } }
export function ler(chave) { try { return localStorage.getItem(chave); } catch { return null; } }
