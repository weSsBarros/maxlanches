// Gráfico de colunas em SVG, sem dependências. Uma série só (cor da marca), eixo único,
// colunas finas com topo arredondado, tooltip por coluna (mouse e teclado) e rótulo só no maior valor.

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function niceScale(max, ticks = 4) {
  if (max <= 0) return { top: 1, step: 1 / ticks };
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  return { top: Math.ceil(max / step) * step, step };
}

/** Coluna com cantos de 4px no topo e base reta. */
function columnPath(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/**
 * @param {HTMLElement} container
 * @param {{ data: {label: string, value: number, title: string, lines: string[]}[], format: (v:number)=>string,
 *           axisFormat?: (v:number)=>string, ariaLabel: string, height?: number }} opts
 */
export function columnChart(container, opts) {
  const draw = () => drawColumns(container, opts);
  draw();
  const ro = new ResizeObserver(() => {
    if (String(container.clientWidth) !== container.dataset.w) draw();
  });
  ro.observe(container);
  return () => ro.disconnect();
}

function drawColumns(container, { data, format, axisFormat = format, ariaLabel, height = 220 }) {
  const width = Math.max(280, container.clientWidth);
  container.dataset.w = container.clientWidth;
  container.replaceChildren();
  container.classList.add('chart');

  const pad = { top: 22, right: 8, bottom: 28, left: 64 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const maxValue = Math.max(0, ...data.map((d) => d.value));
  const { top, step } = niceScale(maxValue);
  const y = (v) => pad.top + plotH - (v / top) * plotH;

  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': ariaLabel });

  for (let v = 0; v <= top + step / 2; v += step) {
    const yy = Math.round(y(v)) + 0.5;
    svg.append(svgEl('line', { class: 'grid-line', x1: pad.left, x2: width - pad.right, y1: yy, y2: yy }));
    const t = svgEl('text', { class: 'axis-text', x: pad.left - 8, y: yy + 4, 'text-anchor': 'end' });
    t.textContent = axisFormat(v);
    svg.append(t);
  }

  const band = plotW / data.length;
  const barW = Math.max(2, Math.min(24, band * 0.62));
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(plotW / 44)));
  const maxIndex = data.findIndex((d) => d.value === maxValue && maxValue > 0);

  const tooltip = document.createElement('div');
  tooltip.className = 'chart-tooltip';
  tooltip.hidden = true;

  data.forEach((d, i) => {
    const cx = pad.left + band * i + band / 2;
    const h = Math.max(0, pad.top + plotH - y(d.value));
    const hit = svgEl('rect', {
      class: 'hit', x: pad.left + band * i, y: pad.top, width: band, height: plotH, tabindex: 0,
      'aria-label': `${d.title}: ${d.lines.join(', ')}`,
    });
    const bar = svgEl('path', { class: 'bar', d: columnPath(cx - barW / 2, pad.top + plotH - h, barW, h) });
    svg.append(hit, bar);

    if (i % labelEvery === 0) {
      const t = svgEl('text', { class: 'axis-text', x: cx, y: height - 8, 'text-anchor': 'middle' });
      t.textContent = d.label;
      svg.append(t);
    }
    if (i === maxIndex) {
      const t = svgEl('text', { class: 'axis-text', x: cx, y: pad.top + plotH - h - 6, 'text-anchor': 'middle' });
      t.textContent = format(d.value);
      svg.append(t);
    }

    const show = () => {
      tooltip.replaceChildren();
      const strong = document.createElement('strong');
      strong.textContent = d.lines[0];
      tooltip.append(strong);
      for (const line of [...d.lines.slice(1), d.title]) {
        const span = document.createElement('span');
        span.textContent = line;
        tooltip.append(span, document.createElement('br'));
      }
      tooltip.hidden = false;
      const scale = container.clientWidth / width;
      const left = Math.min(Math.max(cx * scale, 80), container.clientWidth - 80);
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${(pad.top + plotH - h) * scale}px`;
      bar.classList.add('hover');
    };
    const hide = () => {
      tooltip.hidden = true;
      bar.classList.remove('hover');
    };
    hit.addEventListener('pointerenter', show);
    hit.addEventListener('focus', show);
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('blur', hide);
  });

  container.append(svg, tooltip);
}
