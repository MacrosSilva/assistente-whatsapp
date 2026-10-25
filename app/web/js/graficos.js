// Gráficos em SVG puro (sem biblioteca): barras empilhadas, rosca e minigráfico.
import { TEMAS } from './util.js';

const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...filhos) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const f of filhos) e.append(f instanceof Node ? f : document.createTextNode(String(f)));
  return e;
}
const ORDEM = ['IA', 'segurança', 'programação', 'geral'];
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function teto(n) {
  if (n <= 5) return 5;
  const passo = 10 ** Math.floor(Math.log10(n));
  return Math.ceil(n / passo) * passo;
}

// porDia: {"2026-10-18": {"IA": 3, "segurança": 1, ...}, ...}
export function barrasEmpilhadas(porDia) {
  const L = 640, A = 230, esq = 34, base = 200, topo = 14;
  const dias = Object.keys(porDia);
  const totais = dias.map((d) => ORDEM.reduce((t, k) => t + (porDia[d][k] || 0), 0));
  const max = teto(Math.max(1, ...totais));
  const svg = s('svg', { viewBox: `0 0 ${L} ${A}`, class: 'grafico', role: 'img', 'aria-label': 'Notícias por dia, por tema' });

  for (let i = 0; i <= 4; i++) {
    const y = base - ((base - topo) * i) / 4;
    svg.append(s('line', { x1: esq, x2: L, y1: y, y2: y, class: 'grade-linha' }));
    svg.append(s('text', { x: esq - 8, y: y + 4, 'text-anchor': 'end' }, Math.round((max * i) / 4)));
  }
  const largura = (L - esq) / dias.length;
  const barra = Math.min(38, largura * 0.5);
  dias.forEach((d, i) => {
    const x = esq + largura * i + (largura - barra) / 2;
    let y = base;
    const g = s('g', { class: 'coluna' });
    const dica = [`${new Date(`${d}T12:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' })}: ${totais[i]} notícias`];
    const camadas = ORDEM.filter((k) => porDia[d][k]);
    camadas.forEach((k, j) => {
      const h = ((base - topo) * porDia[d][k]) / max;
      y -= h;
      const ultima = j === camadas.length - 1;
      g.append(s('rect', { x, y, width: barra, height: Math.max(h - (ultima ? 0 : 1.5), 0.5), rx: ultima ? 5 : 1.5, class: `barra f-${TEMAS[k].classe}` }));
      dica.push(`${TEMAS[k].nome}: ${porDia[d][k]}`);
    });
    if (!camadas.length) g.append(s('rect', { x, y: base - 2, width: barra, height: 2, rx: 1, class: 'grade-linha' }));
    g.append(s('title', {}, dica.join('\n')));
    const data = new Date(`${d}T12:00`);
    const hoje = new Date().toDateString() === data.toDateString();
    g.append(s('text', { x: x + barra / 2, y: base + 18, 'text-anchor': 'middle', 'font-weight': hoje ? 700 : 400 },
      hoje ? 'hoje' : DIAS[data.getDay()]));
    svg.append(g);
  });
  return svg;
}

// porTema: {"IA": 10, ...}
export function rosca(porTema) {
  const total = ORDEM.reduce((t, k) => t + (porTema[k] || 0), 0);
  const r = 52, c = 2 * Math.PI * r;
  const svg = s('svg', { viewBox: '0 0 140 140', class: 'grafico', role: 'img', 'aria-label': 'Notícias por tema' });
  svg.append(s('circle', { cx: 70, cy: 70, r, fill: 'none', 'stroke-width': 16, class: 'rosca-trilho' }));
  let acumulado = 0;
  for (const k of ORDEM) {
    const v = porTema[k] || 0;
    if (!v) continue;
    const parte = (v / total) * c;
    const arco = s('circle', {
      cx: 70, cy: 70, r, fill: 'none', 'stroke-width': 16, class: `s-${TEMAS[k].classe}`,
      'stroke-dasharray': `${Math.max(parte - 2, 0.1)} ${c}`, 'stroke-dashoffset': -acumulado,
      transform: 'rotate(-90 70 70)', 'stroke-linecap': 'butt',
    });
    arco.append(s('title', {}, `${TEMAS[k].nome}: ${v} (${Math.round((v / total) * 100)}%)`));
    svg.append(arco);
    acumulado += parte;
  }
  svg.append(s('text', { x: 70, y: 72, 'text-anchor': 'middle', class: 'rosca-total' }, total));
  svg.append(s('text', { x: 70, y: 90, 'text-anchor': 'middle' }, 'notícias'));
  return svg;
}

export function minigrafico(valores) {
  const L = 96, A = 34, max = Math.max(1, ...valores);
  const pts = valores.map((v, i) => [(L * i) / Math.max(1, valores.length - 1), A - 3 - ((A - 6) * v) / max]);
  const linha = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  return s('svg', { viewBox: `0 0 ${L} ${A}`, class: 'spark', 'aria-hidden': 'true' },
    s('path', { d: `${linha} L${L} ${A} L0 ${A} Z`, class: 'area' }),
    s('path', { d: linha, class: 'linha' }));
}
