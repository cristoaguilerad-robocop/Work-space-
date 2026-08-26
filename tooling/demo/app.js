/* Demo del Workspace Funcional.
 *
 * Los modelos vienen pre-derivados (la derivacion simbolica necesita SymPy),
 * pero toda la evaluacion numerica es la que hace la app real, corriendo en el
 * navegador. Por eso los diagramas, el mapa de campo y el arrastre de la carga
 * movil responden al instante.
 */
(() => {
  'use strict';

  const CASES = JSON.parse(document.getElementById('payloads').textContent);

  // -------------------------------------------------------------- evaluador
  //
  // Se recorre el arbol serializado por el motor en vez de compilar su codigo
  // JavaScript: esta pagina corre bajo una CSP que prohibe eval. El backend
  // emite las dos formas a partir de la misma expresion de SymPy.

  function sf(x, a, n) {
    if (n < 0 || x < a) return 0;
    return n === 0 ? 1 : Math.pow(x - a, n);
  }

  const FN = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh,
    exp: Math.exp, log: Math.log, abs: Math.abs,
  };

  function evaluate(node, x, params) {
    if (typeof node === 'number') return node;
    if (node === null || node === undefined) return NaN;
    if (node.v !== undefined) return node.v === 'x' ? x : params[node.v];

    const a = node.a;
    switch (node.f) {
      case '+': { let out = 0; for (const t of a) out += evaluate(t, x, params); return out; }
      case '*': { let out = 1; for (const t of a) out *= evaluate(t, x, params); return out; }
      case '^': return Math.pow(evaluate(a[0], x, params), evaluate(a[1], x, params));
      case 'sf': return sf(evaluate(a[0], x, params), evaluate(a[1], x, params), evaluate(a[2], x, params));
      case 'hv': return evaluate(a[0], x, params) < 0 ? 0 : 1;
      default: {
        const fn = FN[node.f];
        return fn ? fn(...a.map((arg) => evaluate(arg, x, params))) : NaN;
      }
    }
  }

  const compile = (packaged) => (x, b) => {
    const out = evaluate(packaged.js.ast, x, b);
    return Number.isFinite(out) ? out : NaN;
  };

  const val = (packaged, b) => compile(packaged)(0, b);

  // ------------------------------------------------------------ cuadratura

  const MAP_STEPS = 16;
  const PROBE_STEPS = 200;

  function simpson(f, start, end, steps) {
    if (!(end > start)) return 0;
    const h = (end - start) / steps;
    let total = f(start) + f(end);
    for (let i = 1; i < steps; i += 1) total += f(start + i * h) * (i % 2 ? 4 : 2);
    return (total * h) / 3;
  }

  /** Campo en un punto: aporte exacto de las cargas puntuales mas cuadratura. */
  function fieldAt(setup, bindings, observer, steps) {
    const scope = Object.assign({}, bindings, observer);
    let total = evaluate(setup.discrete.js.ast, 0, scope);
    if (!Number.isFinite(total)) total = 0;
    for (const part of setup.parts) {
      const start = evaluate(part.start.js.ast, 0, scope);
      const end = evaluate(part.end.js.ast, 0, scope);
      const contribution = simpson(
        (x) => evaluate(part.integrand.js.ast, x, scope), start, end, steps,
      );
      if (Number.isFinite(contribution)) total += contribution;
    }
    return total;
  }

  /**
   * Escala del mapa. Divergente si el campo cambia de signo -- que es justo el
   * dato que interesa en un dipolo -- y secuencial si no, porque ahi una
   * divergente pinta todo del mismo lado y no se lee nada.
   */
  function fieldColor(v, low, high, diverging) {
    if (!Number.isFinite(v)) return [128, 128, 128];
    if (diverging) {
      const span = Math.max(Math.abs(low), Math.abs(high)) || 1;
      const t = Math.max(-1, Math.min(1, v / span));
      const eased = Math.sign(t) * Math.pow(Math.abs(t), 0.42);
      if (eased >= 0) {
        return [Math.round(247 - 60 * (1 - eased)), Math.round(247 - 150 * eased),
                Math.round(247 - 190 * eased)];
      }
      const s = -eased;
      return [Math.round(247 - 200 * s), Math.round(247 - 110 * s), Math.round(247 - 20 * s)];
    }
    const range = high - low || 1;
    const t = Math.pow(Math.max(0, Math.min(1, (v - low) / range)), 0.5);
    return [
      Math.round(28 + 219 * Math.pow(t, 0.8)),
      Math.round(52 + 150 * t),
      Math.round(120 + 40 * t - 90 * Math.pow(t, 2)),
    ];
  }

  // -------------------------------------------------------------- estado

  const MODULES = [
    { id: 'statics', label: 'Estatica' },
    { id: 'em', label: 'Electro' },
    { id: 'thermo', label: 'Termo' },
  ];

  const state = {
    caseId: CASES[0].id,
    stage: 1,
    mapField: 'V',
    mapMode: '2d',
    bindings: Object.fromEntries(CASES.map((c) => [
      c.id, Object.fromEntries(c.derived.symbols.map((s) => [s.name, s.value])),
    ])),
  };

  const current = () => CASES.find((c) => c.id === state.caseId);
  const bindings = () => state.bindings[state.caseId];
  const body = () => current().derived.bodies[0];
  const moduleOf = () => current().module;
  /** Un cable vive en Estatica pero grafica otras cosas. */
  const diagramsOf = () => (body().kind === 'cable' ? 'cable' : current().module);

  // -------------------------------------------------------------- utilidades

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : String(v));
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  const svg = (tag, attrs = {}) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v !== null && v !== undefined) node.setAttribute(k, String(v));
    }
    return node;
  };

  /** Rinde LaTeX en el momento. Con KaTeX en la pagina, el usuario puede
   *  escribir y ver lo que escribe, no solo leer lo que vino hecho. */
  function tex(latex, display = false) {
    if (!latex) return '';
    try {
      return katex.renderToString(latex, { displayMode: display, throwOnError: false });
    } catch {
      return `<code class="katex-fallback">${latex}</code>`;
    }
  }

  const math = (packaged, display = false) =>
    el('span', { html: tex(typeof packaged === 'string' ? packaged : packaged.latex, display) });

  /** Texto con matematica intercalada entre `$...$`. */
  function mathText(text) {
    const node = el('span', { class: 'mathtext' });
    let buffer = '';
    let inMath = false;
    const flush = () => {
      if (buffer === '') return;
      if (inMath) node.insertAdjacentHTML('beforeend', tex(buffer));
      else {
        buffer.split('\n').forEach((line, i, all) => {
          node.append(document.createTextNode(line));
          if (i < all.length - 1) node.append(el('br'));
        });
      }
      buffer = '';
    };
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] === '$' && text[i - 1] !== '\\') { flush(); inMath = !inMath; continue; }
      buffer += text[i];
    }
    flush();
    return node;
  }

  function fmt(v) {
    if (!Number.isFinite(v)) return '—';
    if (v === 0) return '0';
    const abs = Math.abs(v);
    if (abs >= 1e5 || abs < 1e-3) return v.toExponential(3);
    return v.toFixed(abs < 1 ? 5 : 3);
  }

  function axisFmt(v) {
    if (!Number.isFinite(v)) return '';
    if (v === 0) return '0';
    const abs = Math.abs(v);
    return abs >= 1e4 || abs < 1e-2 ? v.toExponential(1) : v.toFixed(2);
  }

  // -------------------------------------------------------------- canvas

  const CW = 660, CH = 300, BEAM_Y = 205, MARGIN = 66, LOAD_PX = 92;

  function drawCanvas() {
    const c = current(), b = body(), bd = bindings();
    const L = val(b.length, bd) || 1;
    const px = (x) => MARGIN + (x / L) * (CW - 2 * MARGIN);
    const fromPx = (p) => ((p - MARGIN) / (CW - 2 * MARGIN)) * L;
    const module = c.module;

    const root = svg('svg', {
      class: 'canvas' + (c.draggable ? ' draggable' : ''),
      viewBox: `0 0 ${CW} ${CH}`,
      role: 'img', 'aria-label': 'Diagrama del modelo',
    });

    const defs = svg('defs');
    const marker = svg('marker', {
      id: 'ar', viewBox: '0 0 10 10', refX: 9, refY: 5,
      markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse',
    });
    marker.append(svg('path', { d: 'M 0 0 L 10 5 L 0 10 z' }));
    defs.append(marker);
    root.append(defs);

    const dist = b.loads.filter((l) => l.kind === 'distributed' && l.profile);

    let peak = 0;
    for (const load of dist) {
      for (let i = 0; i <= 60; i += 1) {
        peak = Math.max(peak, Math.abs(evaluate(load.profile.js.ast, (i / 60) * L, bd)));
      }
    }
    const scale = peak > 0 ? LOAD_PX / peak : 0;

    for (const load of dist) {
      const a = val(load.start, bd), z = val(load.end, bd);
      const h = (x) => Math.abs(evaluate(load.profile.js.ast, x, bd)) * scale;
      const down = evaluate(load.profile.js.ast, (a + z) / 2, bd) <= 0;

      const pts = [];
      for (let i = 0; i <= 80; i += 1) {
        const x = a + ((z - a) * i) / 80;
        pts.push(`${px(x).toFixed(1)},${(BEAM_Y - h(x)).toFixed(1)}`);
      }

      const g = svg('g', { class: `dist ${module}` });
      g.append(svg('polygon', {
        points: `${px(a).toFixed(1)},${BEAM_Y} ${pts.join(' ')} ${px(z).toFixed(1)},${BEAM_Y}`,
      }));
      g.append(svg('polyline', { points: pts.join(' ') }));

      // Las flechas indican sentido de aplicacion: eso solo tiene sentido para
      // una fuerza. Una densidad de carga o una generacion de calor son
      // escalares y dibujarles flechas sugiere una direccion que no existe.
      if (load.quantity === 'force') {
        for (let i = 0; i < 6; i += 1) {
          const x = a + ((z - a) * (i + 0.5)) / 6;
          const top = BEAM_Y - h(x);
          if (Math.abs(BEAM_Y - top) < 7) continue;
          g.append(svg('line', {
            x1: px(x), y1: down ? top : BEAM_Y, x2: px(x), y2: down ? BEAM_Y : top,
            'marker-end': 'url(#ar)',
          }));
        }
      }

      const top = Math.max(...pts.map((p) => BEAM_Y - Number(p.split(',')[1])), 0);
      const label = svg('text', {
        x: px((a + z) / 2), y: BEAM_Y - top - 10, 'text-anchor': 'middle', class: 'lab',
      });
      label.textContent = load.label;
      g.append(label);
      root.append(g);
    }

    for (const load of b.loads.filter((l) => l.kind === 'point')) {
      const at = px(val(load.start, bd));
      const magnitude = load.magnitude ? val(load.magnitude, bd) : 1;

      // Una fuerza tiene sentido y se dibuja como flecha. Una carga o una
      // fuente de calor concentradas son escalares: se dibujan con su signo,
      // sin insinuar una direccion que el modelo no tiene.
      if (load.quantity !== 'force') {
        const g = svg('g', { class: `scalar-pt ${magnitude >= 0 ? 'pos' : 'neg'}` });
        g.append(svg('circle', { cx: at, cy: BEAM_Y, r: 11 }));
        const sign = svg('text', { x: at, y: BEAM_Y + 5, 'text-anchor': 'middle', class: 'glyph' });
        sign.textContent = magnitude >= 0 ? '+' : '−';
        g.append(sign);
        const name = svg('text', { x: at, y: BEAM_Y - 20, 'text-anchor': 'middle', class: 'lab' });
        name.textContent = load.label;
        g.append(name);
        root.append(g);
        continue;
      }

      const down = magnitude >= 0;
      const y0 = BEAM_Y - (down ? 66 : -66);
      const g = svg('g', { class: 'pt' });
      const shaft = svg('line', { x1: at, y1: y0, x2: at, y2: BEAM_Y, 'marker-end': 'url(#ar)' });
      g.append(shaft);
      const t = svg('text', { x: at, y: y0 - 9, 'text-anchor': 'middle', class: 'lab' });
      t.textContent = load.label;
      g.append(t);

      // Arrastre real: si la posicion de esta carga es un simbolo, moverla no
      // cambia el planteo -- solo el valor de ese simbolo. Por eso funciona en
      // una pagina estatica, sin volver a derivar nada.
      if (c.draggable && c.draggable.field === load.id) {
        const handle = svg('circle', { cx: at, cy: y0, r: 9, class: 'grab' });
        const hint = svg('text', { x: at, y: y0 - 26, 'text-anchor': 'middle', class: 'drag-lab' });
        hint.textContent = `${c.draggable.symbol} = ${(bd[c.draggable.symbol] ?? 0).toFixed(2)} m`;

        handle.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          handle.setPointerCapture(event.pointerId);

          const move = (e) => {
            const rect = root.getBoundingClientRect();
            const local = ((e.clientX - rect.left) / rect.width) * CW;
            const position = Math.max(0, Math.min(L, fromPx(local)));
            bindings()[c.draggable.symbol] = Number(position.toFixed(3));

            // Se mueven los elementos en el lugar en vez de redibujar el
            // canvas: rehacerlo destruiria el nodo que tiene la captura del
            // puntero y el arrastre se cortaria en el primer movimiento.
            const cx = px(position);
            handle.setAttribute('cx', cx);
            shaft.setAttribute('x1', cx);
            shaft.setAttribute('x2', cx);
            t.setAttribute('x', cx);
            hint.setAttribute('x', cx);
            hint.textContent = `${c.draggable.symbol} = ${position.toFixed(2)} m`;
            refresh();
          };
          const up = () => {
            handle.removeEventListener('pointermove', move);
            handle.removeEventListener('pointerup', up);
          };
          handle.addEventListener('pointermove', move);
          handle.addEventListener('pointerup', up);
        });

        g.append(handle);
        g.append(hint);
      }
      root.append(g);
    }

    for (const load of b.loads.filter((l) => l.kind === 'couple')) {
      const at = px(val(load.start, bd));
      const g = svg('g', { class: 'cpl' });
      g.append(svg('path', {
        d: `M ${at - 24} ${BEAM_Y - 5} A 24 24 0 1 1 ${at + 24} ${BEAM_Y - 5}`,
        'marker-end': 'url(#ar)',
      }));
      const t = svg('text', { x: at, y: BEAM_Y - 38, 'text-anchor': 'middle', class: 'lab' });
      t.textContent = load.label;
      g.append(t);
      root.append(g);
    }

    // Un cable no es una recta: su curva es el resultado del problema. La
    // escala vertical se ajusta a la flecha para que se vea la forma y no una
    // linea casi plana.
    if (b.shape) {
      const samples = [];
      for (let i = 0; i <= 80; i += 1) {
        const sx = (i / 80) * L;
        const sy = evaluate(b.shape.js.ast, sx, bd);
        if (Number.isFinite(sy)) samples.push({ x: sx, y: sy });
      }
      if (samples.length > 1) {
        const lo = Math.min(...samples.map((s) => s.y));
        const hi = Math.max(...samples.map((s) => s.y));
        const vScale = Math.min(74 / Math.max(hi - lo, 1e-9), (CW - 2 * MARGIN) / L);
        root.append(svg('polyline', {
          class: 'cable',
          points: samples
            .map((s) => `${px(s.x).toFixed(1)},${(BEAM_Y - (s.y - hi) * vScale).toFixed(1)}`)
            .join(' '),
        }));
      }
    } else {
      root.append(svg('line', {
        x1: px(0), y1: BEAM_Y, x2: px(L), y2: BEAM_Y, class: `beam ${module}`,
      }));
    }

    for (const support of b.supports ?? []) {
      const at = px(val(support.at, bd));
      const g = svg('g', { class: 'support' });
      if (support.type === 'fixed') {
        g.append(svg('line', { x1: at, y1: BEAM_Y - 28, x2: at, y2: BEAM_Y + 28, class: 'wall' }));
        for (const dy of [-21, -10.5, 0, 10.5, 21]) {
          g.append(svg('line', { x1: at, y1: BEAM_Y + dy, x2: at - 12, y2: BEAM_Y + dy + 10 }));
        }
      } else {
        g.append(svg('polygon', {
          points: `${at},${BEAM_Y} ${at - 14},${BEAM_Y + 23} ${at + 14},${BEAM_Y + 23}`,
        }));
        if (support.type === 'roller') {
          g.append(svg('circle', { cx: at - 7.5, cy: BEAM_Y + 28, r: 4.5 }));
          g.append(svg('circle', { cx: at + 7.5, cy: BEAM_Y + 28, r: 4.5 }));
        }
      }
      const t = svg('text', {
        x: at, y: BEAM_Y + (support.type === 'fixed' ? 48 : 50),
        'text-anchor': 'middle', class: 'lab',
      });
      t.textContent = support.id;
      g.append(t);
      root.append(g);
    }

    for (const boundary of b.boundaries ?? []) {
      const at = px(val(boundary.at, bd));
      const glyph = { temperature: 'T', flux: 'Q', convection: 'h', insulated: '//' }[boundary.type];
      const g = svg('g', { class: `bc bc-${boundary.type}` });
      g.append(svg('line', { x1: at, y1: BEAM_Y - 21, x2: at, y2: BEAM_Y + 21 }));
      g.append(svg('rect', { x: at - 13, y: BEAM_Y + 23, width: 26, height: 20, rx: 3 }));
      const t = svg('text', { x: at, y: BEAM_Y + 37, 'text-anchor': 'middle', class: 'glyph' });
      t.textContent = glyph;
      g.append(t);
      const n = svg('text', { x: at, y: BEAM_Y + 57, 'text-anchor': 'middle', class: 'lab' });
      n.textContent = boundary.label || boundary.id;
      g.append(n);
      root.append(g);
    }

    for (const probe of b.probes ?? []) {
      const p = px(val(probe.at[0], bd));
      const y = BEAM_Y - val(probe.at[1], bd) * 90;
      const g = svg('g', { class: 'probe' });
      g.append(svg('line', { x1: p, y1: BEAM_Y, x2: p, y2: y, class: 'lead' }));
      g.append(svg('circle', { cx: p, cy: y, r: 7 }));
      const t = svg('text', { x: p + 12, y: y + 4, class: 'lab' });
      t.textContent = probe.label;
      g.append(t);
      root.append(g);
    }

    root.append(svg('line', { x1: px(0), y1: BEAM_Y + 66, x2: px(L), y2: BEAM_Y + 66, class: 'dim' }));
    const dim = svg('text', { x: px(L / 2), y: BEAM_Y + 82, 'text-anchor': 'middle', class: 'lab' });
    dim.textContent = `L = ${L} m`;
    root.append(dim);

    return root;
  }

  // -------------------------------------------------------------- diagramas

  const PW = 560, PH = 132, PAD = { t: 12, r: 12, b: 20, l: 62 };

  function drawPlot(packaged, color, length, breaks) {
    const bd = bindings();
    const span = length * (1 - 1e-9);
    const eps = length * 1e-6;

    const grid = new Set();
    for (let i = 0; i <= 400; i += 1) grid.add((i / 400) * span);
    for (const brk of breaks) {
      if (brk > eps && brk < span - eps) { grid.add(brk - eps); grid.add(brk + eps); }
    }

    const xs = [...grid].sort((a, b) => a - b);
    const ys = xs.map((x) => evaluate(packaged.js.ast, x, bd));
    const finite = ys.filter(Number.isFinite);
    const lo = finite.length ? Math.min(...finite) : 0;
    const hi = finite.length ? Math.max(...finite) : 0;

    const pad = Math.max(Math.abs(lo), Math.abs(hi), 1e-12) * 0.09;
    const low = Math.min(lo, 0) - pad;
    const range = (Math.max(hi, 0) + pad) - low || 1;

    const sx = (x) => PAD.l + (x / length) * (PW - PAD.l - PAD.r);
    const sy = (y) => PAD.t + (1 - (y - low) / range) * (PH - PAD.t - PAD.b);

    let d = '', pen = false;
    xs.forEach((x, i) => {
      const y = ys[i];
      if (!Number.isFinite(y)) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${sx(x).toFixed(2)},${sy(y).toFixed(2)}`;
      pen = true;
    });

    const root = svg('svg', { viewBox: `0 0 ${PW} ${PH}` });
    root.append(svg('line', { x1: PAD.l, x2: PW - PAD.r, y1: sy(0), y2: sy(0), class: 'zero' }));
    root.append(svg('path', { d, fill: 'none', stroke: color, 'stroke-width': 1.9 }));
    for (const [x, y, text, anchor] of [
      [PAD.l - 7, PAD.t + 7, axisFmt(hi), 'end'],
      [PAD.l - 7, PH - PAD.b, axisFmt(lo), 'end'],
      [PAD.l, PH - 6, '0', 'start'],
      [PW - PAD.r, PH - 6, `${length.toFixed(2)} m`, 'end'],
    ]) {
      const t = svg('text', { x, y, class: 'tick', 'text-anchor': anchor });
      t.textContent = text;
      root.append(t);
    }
    return root;
  }

  // ---------------------------------------------------------- superficie 3D
  //
  // Misma grilla que el mapa 2D: lo unico que cambia es como se proyecta. Se
  // dibuja de atras hacia adelante (algoritmo del pintor), que en una malla
  // regular vista desde fuera siempre alcanza y evita llevar un z-buffer.

  const DEFAULT_VIEW = { yaw: -0.62, pitch: 0.62 };
  const view = { ...DEFAULT_VIEW };

  function project(u, v, h, width, height) {
    const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw);
    const cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
    const rx = u * cy - v * sy;
    const ry = u * sy + v * cy;
    return {
      x: width / 2 + rx * width * 0.46,
      y: height * 0.55 - ry * cp * height * 0.26 - h * height * 0.26,
      depth: ry * cp - h * sp,
    };
  }

  /**
   * Altura normalizada. Si el campo cambia de signo el cero queda en el medio,
   * porque la altura tiene que decir de que lado esta cada punto. Si no cambia
   * de signo eso solo desperdicia medio lienzo y la superficie se estira.
   */
  function heightsOf(values, low, high, diverging) {
    const span = Math.max(Math.abs(low), Math.abs(high)) || 1;
    const out = new Float64Array(values.length);
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < values.length; i += 1) {
      const v = values[i];
      if (!Number.isFinite(v)) { out[i] = 0; continue; }
      const t = Math.max(-1, Math.min(1, v / span));
      const eased = Math.sign(t) * Math.pow(Math.abs(t), 0.45);
      out[i] = eased;
      if (eased < min) min = eased;
      if (eased > max) max = eased;
    }
    if (diverging || !Number.isFinite(min) || max - min < 1e-9) return out;
    const scale = 1.8 / (max - min);
    for (let i = 0; i < out.length; i += 1) out[i] = (out[i] - min) * scale - 0.9;
    return out;
  }

  // -------------------------------------------------------------- mapa 2D

  const GRID_W = 150, GRID_H = 95, PIXEL = 4;
  /** La malla 3D va mas gruesa: cada celda es un poligono, no un pixel. */
  const GRID3_W = 56, GRID3_H = 40;

  const MAP_FIELDS = [
    { key: 'V', label: 'Potencial V', units: 'V' },
    { key: 'Ey', label: 'Campo E_y', units: 'V/m' },
    { key: 'Ex', label: 'Campo E_x', units: 'V/m' },
    { key: 'Bz', label: 'Campo B_z', units: 'T' },
  ];

  function drawFieldMap(canvas, key) {
    const b = body(), bd = bindings();
    const setup = b.field_setups[key];
    if (!setup) return null;

    const three = state.mapMode === '3d';
    const cols = three ? GRID3_W : GRID_W;
    const rows = three ? GRID3_H : GRID_H;

    const L = val(b.length, bd) || 1;
    const bounds = { x0: -0.6 * L, x1: 1.6 * L, y0: -0.75 * L, y1: 0.75 * L };
    const context = canvas.getContext('2d');

    const values = new Float64Array(cols * rows);
    for (let row = 0; row < rows; row += 1) {
      const py = bounds.y1 - ((row + 0.5) / rows) * (bounds.y1 - bounds.y0);
      for (let col = 0; col < cols; col += 1) {
        const px = bounds.x0 + ((col + 0.5) / cols) * (bounds.x1 - bounds.x0);
        values[row * cols + col] = fieldAt(setup, bd, { px, py, pz: 0 }, MAP_STEPS);
      }
    }

    // Los limites por percentil y no por el extremo: cerca de una carga puntual
    // el campo diverge, y un pixel enorme dejaria plano todo el resto.
    const finite = Array.from(values).filter(Number.isFinite).sort((a, b) => a - b);
    const at = (q) => finite[Math.min(finite.length - 1, Math.floor(finite.length * q))] ?? 0;
    const low = at(0.04), high = at(0.96);
    const diverging = low < 0 && high > 0;
    const range = { min: finite[0] ?? 0, max: finite[finite.length - 1] ?? 0 };

    if (three) {
      const height = heightsOf(values, low, high, diverging);
      const ground = getComputedStyle(canvas).getPropertyValue('--plate').trim() || '#fff';
      context.fillStyle = ground;
      context.fillRect(0, 0, canvas.width, canvas.height);

      const corner = (row, col) => ({
        p: project(col / (cols - 1) - 0.5, row / (rows - 1) - 0.5,
                   height[row * cols + col], canvas.width, canvas.height),
        i: row * cols + col,
      });

      const quads = [];
      for (let row = 0; row < rows - 1; row += 1) {
        for (let col = 0; col < cols - 1; col += 1) {
          const cs = [corner(row, col), corner(row, col + 1),
                      corner(row + 1, col + 1), corner(row + 1, col)];
          quads.push({
            depth: cs.reduce((sum, c) => sum + c.p.depth, 0) / 4,
            pts: cs.map((c) => c.p),
            i: cs[0].i,
          });
        }
      }
      quads.sort((a, b) => b.depth - a.depth);

      for (const quad of quads) {
        const [r, g, bl] = fieldColor(values[quad.i], low, high, diverging);
        context.fillStyle = `rgb(${r},${g},${bl})`;
        context.strokeStyle = `rgba(${r},${g},${bl},0.85)`;
        context.lineWidth = 0.6;
        context.beginPath();
        context.moveTo(quad.pts[0].x, quad.pts[0].y);
        for (const p of quad.pts.slice(1)) context.lineTo(p.x, p.y);
        context.closePath();
        context.fill();
        context.stroke();
      }

      // El cuerpo va como sombra en la base: sobre la superficie, un campo que
      // cambia de signo lo convierte en un muro vertical donde cruza el cero,
      // y eso se lee como error de dibujo en vez de como el dato que es.
      let floor = Infinity;
      for (const value of height) if (value < floor) floor = value;
      floor = (Number.isFinite(floor) ? floor : -1) - 0.18;
      const rowY = ((bounds.y1 - 0) / (bounds.y1 - bounds.y0)) * (rows - 1);
      context.save();
      context.strokeStyle = '#111';
      context.globalAlpha = 0.45;
      context.setLineDash([6, 4]);
      context.lineWidth = 2.5;
      context.beginPath();
      for (let i = 0; i <= 2; i += 1) {
        const u = ((i / 2) * L - bounds.x0) / (bounds.x1 - bounds.x0);
        const p = project(u - 0.5, rowY / (rows - 1) - 0.5, floor, canvas.width, canvas.height);
        if (i === 0) context.moveTo(p.x, p.y); else context.lineTo(p.x, p.y);
      }
      context.stroke();
      context.restore();
      return range;
    }

    const image = context.createImageData(cols, rows);
    for (let i = 0; i < values.length; i += 1) {
      const [r, g, bl] = fieldColor(values[i], low, high, diverging);
      image.data[i * 4] = r;
      image.data[i * 4 + 1] = g;
      image.data[i * 4 + 2] = bl;
      image.data[i * 4 + 3] = 255;
    }

    const buffer = document.createElement('canvas');
    buffer.width = cols;
    buffer.height = rows;
    buffer.getContext('2d').putImageData(image, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(buffer, 0, 0, canvas.width, canvas.height);

    const toX = (x) => ((x - bounds.x0) / (bounds.x1 - bounds.x0)) * canvas.width;
    const toY = (y) => ((bounds.y1 - y) / (bounds.y1 - bounds.y0)) * canvas.height;
    context.strokeStyle = '#111';
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(toX(0), toY(0));
    context.lineTo(toX(L), toY(0));
    context.stroke();

    for (const probe of b.probes ?? []) {
      context.lineWidth = 2;
      context.beginPath();
      context.arc(toX(val(probe.at[0], bd)), toY(val(probe.at[1], bd)), 6, 0, Math.PI * 2);
      context.stroke();
    }

    return range;
  }

  // ------------------------------------------------------------- cuaderno
  //
  // Lo unico de esta pagina que no es de solo lectura. No necesita backend: se
  // escribe, se rinde con KaTeX y se guarda en el navegador. Es la parte que
  // mas importa de la herramienta, asi que tiene que estar donde se pueda
  // probar sin instalar nada.

  const NOTES_KEY = 'wf:demo:notas';

  function loadNotes() {
    try { return JSON.parse(localStorage.getItem(NOTES_KEY) || '{}'); }
    catch { return {}; }
  }

  function saveNotes(notes) {
    try { localStorage.setItem(NOTES_KEY, JSON.stringify(notes)); }
    catch { /* modo privado o cuota llena: se sigue trabajando en memoria */ }
  }

  let notes = loadNotes();

  const stepsOf = (stage) => (notes[state.caseId] && notes[state.caseId][stage]) || [];

  function setSteps(stage, steps) {
    notes[state.caseId] = { ...(notes[state.caseId] || {}), [stage]: steps };
    saveNotes(notes);
  }

  const MATH_GROUPS = [
    { id: 'griegas', label: 'Griegas', keys: [
      '\\alpha','\\beta','\\gamma','\\delta','\\epsilon','\\varepsilon','\\zeta','\\eta',
      '\\theta','\\kappa','\\lambda','\\mu','\\nu','\\xi','\\rho','\\sigma','\\tau',
      '\\phi','\\varphi','\\chi','\\psi','\\omega','\\Gamma','\\Delta','\\Theta',
      '\\Lambda','\\Pi','\\Sigma','\\Phi','\\Omega',
    ].map((latex) => ({ label: latex, latex })) },
    { id: 'calculo', label: 'Calculo', keys: [
      { label: '\\int', latex: '\\int ' },
      { label: '\\int_{a}^{b}', latex: '\\int_{}^{} ', caret: 5 },
      { label: '\\iint', latex: '\\iint ' },
      { label: '\\oint', latex: '\\oint ' },
      { label: 'dx', latex: '\\,dx' },
      { label: '\\partial', latex: '\\partial ' },
      { label: '\\frac{d}{dx}', latex: '\\frac{d}{dx} ' },
      { label: '\\frac{\\partial}{\\partial x}', latex: '\\frac{\\partial }{\\partial x} ', caret: 14 },
      { label: '\\lim_{x \\to a}', latex: '\\lim_{ \\to } ', caret: 6 },
      { label: '\\sum', latex: '\\sum_{}^{} ', caret: 5 },
      { label: '\\nabla', latex: '\\nabla ' },
      { label: '\\infty', latex: '\\infty ' },
    ] },
    { id: 'estructura', label: 'Estructura', keys: [
      { label: '\\frac{a}{b}', latex: '\\frac{}{}', caret: 3 },
      { label: 'x^{n}', latex: '^{}', caret: 1 },
      { label: 'x_{i}', latex: '_{}', caret: 1 },
      { label: '\\sqrt{x}', latex: '\\sqrt{}', caret: 1 },
      { label: '\\left(\\right)', latex: '\\left( \\right)', caret: 8 },
      { label: '\\left[\\right]', latex: '\\left[ \\right]', caret: 8 },
      { label: '\\left|x\\right|', latex: '\\left| \\right|', caret: 8 },
      { label: '\\vec{F}', latex: '\\vec{}', caret: 1 },
      { label: '\\hat{n}', latex: '\\hat{}', caret: 1 },
      { label: '\\bar{x}', latex: '\\bar{}', caret: 1 },
      { label: '\\begin{cases}\\end{cases}', latex: '\\begin{cases} \\\\ \\end{cases}', caret: 17 },
    ] },
    { id: 'relaciones', label: 'Relaciones', keys: [
      '=','\\neq','\\approx','\\equiv','\\propto','<','>','\\leq','\\geq',
      '\\pm','\\times','\\cdot','\\div','\\to','\\Rightarrow','\\therefore','\\in',
    ].map((latex) => ({ label: latex, latex })) },
    { id: 'fisica', label: 'Fisica', keys: [
      { label: '\\sum F_x = 0', latex: '\\sum F_x = 0' },
      { label: '\\sum F_y = 0', latex: '\\sum F_y = 0' },
      { label: '\\sum M = 0', latex: '\\sum M_{} = 0', caret: 5 },
      { label: '\\vec{F}', latex: '\\vec{F}' },
      { label: '\\Delta T', latex: '\\Delta T' },
      { label: '\\varepsilon_0', latex: '\\varepsilon_0' },
      { label: '\\mu_0', latex: '\\mu_0' },
      { label: '^\\circ', latex: '^\\circ' },
      { label: '\\,\\mathrm{N}', latex: '\\,\\mathrm{N}' },
      { label: '\\,\\mathrm{m}', latex: '\\,\\mathrm{m}' },
      { label: '\\,\\mathrm{W}', latex: '\\,\\mathrm{W}' },
      { label: '\\,\\mathrm{V}', latex: '\\,\\mathrm{V}' },
    ] },
  ];

  /** Si la posicion cae dentro de un tramo `$...$`. */
  function insideMath(text, position) {
    let open = false;
    for (let i = 0; i < position && i < text.length; i += 1) {
      if (text[i] === '$' && text[i - 1] !== '\\') open = !open;
    }
    return open;
  }

  /**
   * Cuaderno de una etapa.
   *
   * El DOM se construye una vez y despues se actualiza a mano. Volver a
   * renderizar toda la pagina en cada tecla le sacaria el foco al textarea, que
   * es exactamente donde la persona esta escribiendo.
   */
  function notebook(stage, title, hint, suggestions) {
    let steps = stepsOf(stage);
    let focused = null;
    const areas = new Map();
    const list = el('ol', { class: 'usersteps' });

    const commit = () => setSteps(stage, steps);

    function draw() {
      list.replaceChildren();
      steps.forEach((step, index) => {
        const area = el('textarea', {
          rows: 3,
          placeholder: 'Escribi aca. La matematica va entre signos peso: $\\sum F_y = 0$',
        });
        area.value = step.body;
        areas.set(step.id, area);

        const preview = el('div', { class: 'step-preview' });
        const refresh = () => preview.replaceChildren(
          step.body.trim() ? mathText(step.body) : document.createTextNode(''),
        );
        refresh();

        area.addEventListener('focus', () => { focused = step.id; });
        area.addEventListener('input', () => { step.body = area.value; refresh(); commit(); });

        const name = el('input', { class: 'step-title', placeholder: 'Que hago en este paso' });
        name.value = step.title;
        name.addEventListener('input', () => { step.title = name.value; commit(); });

        const move = (delta) => {
          const target = index + delta;
          if (target < 0 || target >= steps.length) return;
          [steps[index], steps[target]] = [steps[target], steps[index]];
          commit(); draw();
        };

        list.append(el('li', {},
          el('div', { class: 'step-bar' },
            el('span', { class: 'step-n' }, index + 1),
            name,
            el('button', { type: 'button', 'aria-label': 'Subir', onclick: () => move(-1) }, '↑'),
            el('button', { type: 'button', 'aria-label': 'Bajar', onclick: () => move(1) }, '↓'),
            el('button', { type: 'button', 'aria-label': 'Quitar paso', onclick: () => {
              steps = steps.filter((s) => s.id !== step.id); commit(); draw();
            } }, '✕')),
          area, preview));
      });
    }

    const add = (body = '', stepTitle = '') => {
      const step = {
        id: Math.random().toString(36).slice(2, 10),
        title: stepTitle, body, createdAt: new Date().toISOString(),
      };
      steps = [...steps, step];
      commit(); draw();
      requestAnimationFrame(() => areas.get(step.id)?.focus());
    };

    const insert = (key) => {
      const id = focused ?? steps[steps.length - 1]?.id;
      const area = areas.get(id);
      const step = steps.find((s) => s.id === id);
      if (!area || !step) return;
      const start = area.selectionStart;
      const end = area.selectionEnd;
      const inside = insideMath(step.body, start);
      const payload = inside ? key.latex : `$${key.latex}$`;
      step.body = step.body.slice(0, start) + payload + step.body.slice(end);
      const caret = start + payload.length - (key.caret ?? 0) - (inside ? 0 : 1);
      commit(); draw();
      requestAnimationFrame(() => {
        const again = areas.get(step.id);
        if (!again) return;
        again.focus();
        again.setSelectionRange(caret, caret);
      });
    };

    let group = MATH_GROUPS[0].id;
    const keyboard = el('div', { class: 'mathkeys' });
    function drawKeys() {
      const active = MATH_GROUPS.find((g) => g.id === group) ?? MATH_GROUPS[0];
      keyboard.replaceChildren(
        el('div', { class: 'mathkeys-tabs' }, MATH_GROUPS.map((entry) => el('button', {
          type: 'button', 'aria-pressed': entry.id === group,
          onclick: () => { group = entry.id; drawKeys(); },
        }, entry.label))),
        el('div', { class: 'mathkeys-grid' }, active.keys.map((key) => {
          const button = el('button', { type: 'button', title: key.latex });
          const isLatex = /[\\{^_]/.test(key.label);
          if (isLatex) button.innerHTML = tex(key.label);
          else button.textContent = key.label;
          // onmousedown y no onclick: al hacer click el textarea ya perdio el
          // foco y con el la posicion del cursor, que es donde hay que insertar.
          button.addEventListener('mousedown', (event) => { event.preventDefault(); insert(key); });
          return button;
        })),
      );
    }
    drawKeys();

    draw();

    return el('section', { class: 'plate notebook' },
      el('div', { class: 'panel-head' },
        el('h2', {}, title),
        el('button', { type: 'button', onclick: () => add() }, '+ Paso')),
      el('p', { class: 'hint' }, hint),
      list,
      keyboard,
      suggestions.length
        ? el('details', { class: 'suggestions' },
            el('summary', {}, `Traer algo de lo que dedujo el motor (${suggestions.length})`),
            el('p', { class: 'hint' },
              'Se agrega como paso nuevo, para que puedas editarlo y decir con tus ' +
              'palabras por que lo usaste.'),
            el('div', { class: 'cases' }, suggestions.map((suggestion) => el('button', {
              type: 'button',
              onclick: () => add(`$${suggestion.latex}$`, suggestion.label),
            }, suggestion.label))))
        : null);
  }

  // -------------------------------------------------------------- etapas

  const STAGES = [
    ['Armar', 'Cuerpo, dominio, fuentes y bordes'],
    ['Plantear', 'Ecuaciones derivadas del modelo'],
    ['Valorizar', 'Numeros, diagramas y mapas'],
  ];

  const KIND_MARK = { algebra: '=', integrate: '∫', solve: '→', substitute: '↦', check: '✓' };

  const DIAGRAMS = {
    statics: [
      ['V', 'Cortante V(x)', 'N', 'var(--shear)'],
      ['M', 'Momento flector M(x)', 'N·m', 'var(--moment)'],
      ['theta', 'Pendiente θ(x)', 'rad', 'var(--slope)'],
      ['y', 'Deflexion y(x)', 'm', 'var(--defl)'],
    ],
    thermo: [
      ['T', 'Temperatura T(x)', '°C', 'var(--moment)'],
      ['Q', 'Flujo de calor Q(x)', 'W', 'var(--shear)'],
    ],
    em: [],
    cable: [
      ['y', 'Curva del cable y(x)', 'm', 'var(--defl)'],
      ['V', 'Componente vertical V(x)', 'N', 'var(--shear)'],
      ['T', 'Tension T(x)', 'N', 'var(--moment)'],
    ],
  };

  const SCALAR_LABELS = {
    elongation: 'Alargamiento δ',
    generated: 'Potencia generada',
    Q_in: 'Calor entrante',
    Q_out: 'Calor saliente',
    total: 'Carga / corriente total',
    centroid: 'Centroide de la fuente',
    H: 'Tension horizontal H',
    T_A: 'Tension en A',
    T_B: 'Tension en B',
    length: 'Longitud del cable',
  };

  function describeField(field, model) {
    const end = model.bodies[0].domain.end;
    if (field.kind === 'thermal') {
      return `T_sup = ${field.profile.T_top}, T_inf = ${field.profile.T_bottom}`;
    }
    const d = field.distribution;
    if (d.type === 'point') return `${d.magnitude} en x = ${field.region.at}`;
    const region = field.region.type === 'full'
      ? `[0, ${end}]` : `[${field.region.start}, ${field.region.end}]`;
    if (d.type === 'linear') return `${d.w_start} → ${d.w_end} sobre ${region}`;
    if (d.type === 'uniform') return `${d.w} sobre ${region}`;
    return `${d.expr} sobre ${region}`;
  }

  const KIND_WORDS = {
    thermal: 'campo de temperatura',
    couple: 'par concentrado',
    point: 'fuente concentrada',
    distributed: 'fuente distribuida',
  };

  function stage1() {
    const c = current(), b = body();
    const model = c.model.bodies[0];

    const rows = [
      el('div', { class: 'spec-row' },
        el('div', { class: 'spec-key' }, 'Dominio'),
        el('div', { class: 'spec-val', html: `<code>x ∈ [0, ${model.domain.end}]</code>` })),
      ...(c.module === 'statics' ? [el('div', { class: 'spec-row' },
        el('div', { class: 'spec-key' }, 'Analisis'),
        el('div', { class: 'spec-val' },
          model.analysis.mode === 'rigid'
            ? el('span', {}, 'Rigido ', el('em', {}, '— resultantes y equilibrio'))
            : el('span', {}, 'Deformable ', el('em', {}, '— hasta la elastica'))))] : []),
      ...model.fields.map((field) => {
        const load = b.loads.find((l) => l.id === field.id);
        return el('div', { class: 'spec-row' },
          el('div', { class: 'spec-key' }, field.id),
          el('div', { class: 'spec-val' },
            el('code', {}, describeField(field, c.model)),
            el('br'),
            el('em', {}, KIND_WORDS[load ? load.kind : 'thermal'] ?? 'fuente')));
      }),
      ...(c.model.supports?.length ? [el('div', { class: 'spec-row' },
        el('div', { class: 'spec-key' }, 'Apoyos'),
        el('div', { class: 'spec-val', html: c.model.supports.map((s) =>
          `<code>${s.id}</code> <em>${{ pin: 'articulado', roller: 'movil', fixed: 'empotrado' }[s.type]} en ${s.at}</em>`
        ).join('<br>') }))] : []),
      ...(c.model.boundaries?.length ? [el('div', { class: 'spec-row' },
        el('div', { class: 'spec-key' }, 'Bordes'),
        el('div', { class: 'spec-val', html: c.model.boundaries.map((bc) =>
          `<code>${bc.id}</code> <em>${{
            temperature: 'temperatura', flux: 'flujo', convection: 'conveccion', insulated: 'aislado',
          }[bc.type]}${bc.value ? ' = ' + bc.value : ''} en ${bc.at}</em>`
        ).join('<br>') }))] : []),
      ...(c.model.probes?.length ? [el('div', { class: 'spec-row' },
        el('div', { class: 'spec-key' }, 'Sondas'),
        el('div', { class: 'spec-val', html: c.model.probes.map((p) =>
          `<code>${p.label || p.id}</code> <em>en (${p.at[0]}, ${p.at[1]})</em>`).join('<br>') }))] : []),
    ];

    return el('div', { class: 'sheet' },
      el('div', { class: 'sheet cols-model' },
        el('section', { class: 'plate' },
          el('h2', {}, c.module === 'statics' ? 'Diagrama de cuerpo libre' : 'Modelo'),
          drawCanvas(),
          c.draggable
            ? el('p', { class: 'note' },
                'Arrastra el circulo de la carga. Su posicion es el simbolo ',
                el('code', {}, c.draggable.symbol),
                ', asi que moverla no cambia el planteo: cambia el valor de ese simbolo, ' +
                'y las reacciones y los diagramas se rehacen al instante.')
            : null,
          el('span', { class: 'plate-code' }, 'ETAPA 1 / MODELO')),
        el('section', { class: 'plate' },
          el('h2', {}, 'Especificacion'),
          el('div', { class: 'spec' }, rows),
          el('span', { class: 'plate-code' }, 'ESPEC'))),

      el('div', { class: 'demo-note' },
        el('b', {}, 'Demo'),
        el('span', {}, 'Esta pagina es un catalogo de resultados: los modelos vienen ' +
          'pre-derivados porque la derivacion simbolica necesita SymPy. Todo lo numerico ' +
          '-- diagramas, mapas de campo y el arrastre de la carga movil -- corre aca, con ' +
          'el mismo codigo que la app. El canvas donde se arman sistemas libremente ' +
          '(poner cuerpos donde uno quiera, girarlos, colgarles cargas y apoyos) es la ' +
          'app, que necesita el backend Python.')),

      el('section', { class: 'plate' },
        el('h2', {}, 'Casos'),
        ...MODULES.map((mod) => {
          const group = CASES.filter((item) => item.module === mod.id);
          if (!group.length) return null;
          return el('div', { class: 'case-group' },
            el('h3', {}, mod.label),
            el('div', { class: 'cases' }, group.map((item) => el('button', {
              class: 'case', type: 'button',
              'aria-pressed': item.id === state.caseId,
              onclick: () => { state.caseId = item.id; state.mapField = 'V'; render(); },
            }, el('b', {}, item.name), el('span', {}, item.note)))));
        }),
        el('span', { class: 'plate-code' }, 'INDICE')));
  }

  const ROLES = [
    ['equilibrium', 'Equilibrio y condiciones de borde'],
    ['result', 'Resultados simbolicos'],
    ['field', 'Funciones y planteamientos'],
  ];

  function stage2() {
    const b = body();
    const suggestions = b.equations
      .filter((e) => ['equilibrium', 'result', 'field'].includes(e.role))
      .map((e) => ({ label: e.title, latex: e.latex }));

    return el('div', { class: 'sheet' },
      notebook('stage2', 'Mi planteo',
        'Escribi como encaras el ejercicio: que ecuaciones planteas y por que. La ' +
        'matematica va entre signos peso y el teclado de abajo la inserta. Se guarda ' +
        'en este navegador.',
        suggestions),
      ...(b.notes?.length ? [el('div', { class: 'demo-note' },
        el('b', {}, 'Nota'), el('span', {}, b.notes.join(' ')))] : []),
      ...ROLES.map(([role, title]) => {
        const group = b.equations.filter((e) => e.role === role);
        if (!group.length) return null;
        return el('section', { class: 'plate derivation' },
          el('h2', {}, title),
          ...group.map((eq) => el('article', { class: 'eq' },
            el('div', { class: 'eq-head' }, el('b', {}, eq.title), el('code', {}, eq.id)),
            el('div', { class: 'eq-body' }, math(eq.latex, true)),
            eq.detail ? el('p', {}, eq.detail) : null)),
          el('span', { class: 'plate-code' }, 'ETAPA 2'));
      }),
      el('section', { class: 'plate derivation' },
        el('h2', {}, `Desarrollo paso a paso — ${b.steps.length} pasos`),
        el('ol', { class: 'steps' }, b.steps.map((step) => el('li', { 'data-kind': step.kind },
          el('span', { class: 'step-mark', 'aria-hidden': 'true' }, KIND_MARK[step.kind] || '·'),
          el('div', {},
            el('b', {}, step.title),
            step.latex ? el('div', { class: 'eq-body' }, math(step.latex, true)) : null,
            step.detail ? el('p', {}, step.detail) : null)))),
        el('span', { class: 'plate-code' }, 'ETAPA 2 / TRAZA')));
  }

  /** Redibuja solo lo que depende de los numeros. La derivacion no se toca. */
  function refresh() {
    const c = current(), b = body(), bd = bindings();
    const L = val(b.length, bd) || 1;
    const breaks = b.loads
      .filter((l) => l.kind === 'point' || l.kind === 'couple')
      .map((l) => val(l.start, bd))
      .filter(Number.isFinite);

    for (const [key, , , color] of DIAGRAMS[diagramsOf()] ?? []) {
      const slot = document.querySelector(`[data-plot="${key}"]`);
      if (slot && b.functions[key]) slot.replaceChildren(drawPlot(b.functions[key], color, L, breaks));
    }
    for (const cell of document.querySelectorAll('[data-num]')) {
      const packaged = b.reactions[cell.dataset.num] || b.scalars[cell.dataset.num];
      if (packaged) cell.textContent = fmt(val(packaged, bd));
    }
    for (const cell of document.querySelectorAll('[data-probe]')) {
      const [probeId, key] = cell.dataset.probe.split('|');
      const probe = (b.probes ?? []).find((p) => p.id === probeId);
      if (!probe) continue;
      cell.firstChild.textContent = fmt(fieldAt(b.field_setups[key], bd, {
        px: val(probe.at[0], bd), py: val(probe.at[1], bd), pz: val(probe.at[2], bd),
      }, PROBE_STEPS));
    }
    for (const slot of document.querySelectorAll('[data-canvas]')) {
      slot.replaceChildren(drawCanvas());
    }
    const map = document.querySelector('[data-map]');
    if (map) {
      const range = drawFieldMap(map, state.mapField);
      const caption = document.querySelector('[data-map-range]');
      if (caption && range) {
        caption.textContent = `Rango en la vista: ${fmt(range.min)} a ${fmt(range.max)}.`;
      }
    }
  }

  /** Lienzo del mapa, con rotacion al arrastrar cuando esta en 3D. */
  function mapCanvas() {
    const three = state.mapMode === '3d';
    const canvas = el('canvas', {
      'data-map': 'true',
      class: three ? 'surface' : '',
      width: (three ? GRID3_W * 3.4 : GRID_W) * PIXEL,
      height: (three ? GRID3_H * 2.4 : GRID_H) * PIXEL,
    });
    if (!three) return canvas;

    let last = null;
    canvas.addEventListener('pointerdown', (event) => {
      canvas.setPointerCapture(event.pointerId);
      last = { x: event.clientX, y: event.clientY };
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!last) return;
      view.yaw += (event.clientX - last.x) * 0.008;
      // Se limita la inclinacion: pasando la vertical se ve desde abajo y el
      // orden por profundidad deja de tener sentido.
      view.pitch = Math.max(0.12, Math.min(1.45, view.pitch + (event.clientY - last.y) * 0.006));
      last = { x: event.clientX, y: event.clientY };
      drawFieldMap(canvas, state.mapField);
    });
    const release = () => { last = null; };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointerleave', release);
    return canvas;
  }

  function stage3() {
    const c = current(), b = body(), bd = bindings();
    const L = val(b.length, bd) || 1;
    const breaks = b.loads
      .filter((l) => l.kind === 'point' || l.kind === 'couple')
      .map((l) => val(l.start, bd))
      .filter(Number.isFinite);

    const controls = c.derived.symbols.map((symbol) => {
      const base = symbol.value || 1;
      const number = el('input', {
        type: 'number', step: 'any', value: bd[symbol.name],
        'aria-label': symbol.description || symbol.name,
      });
      const range = el('input', {
        type: 'range', min: base * 0.2, max: base * 3, step: (base * 2.8) / 240,
        value: bd[symbol.name], 'aria-label': `${symbol.name} (deslizador)`,
      });
      const apply = (next) => {
        if (!Number.isFinite(next)) return;
        bd[symbol.name] = next;
        number.value = String(Number(next.toPrecision(6)));
        range.value = String(next);
        refresh();
      };
      number.addEventListener('input', () => apply(Number(number.value)));
      range.addEventListener('input', () => apply(Number(range.value)));

      return el('div', {},
        el('div', { class: 'binding', title: symbol.description },
          el('span', { class: 'sym' }, math(symbol.latex)),
          number,
          el('span', { class: 'u' }, symbol.units)),
        el('div', { class: 'binding', style: 'padding-top:0;border:none' },
          el('span', {}), range, el('span', {})));
    });

    const rows = [
      ...Object.entries(b.reactions).map(([key, p]) => ({ key, label: key, packaged: p })),
      ...Object.entries(b.scalars).map(([key, p]) =>
        ({ key, label: SCALAR_LABELS[key] || key, packaged: p })),
    ];

    const available = MAP_FIELDS.filter((f) => b.field_setups && b.field_setups[f.key]);
    if (available.length && !available.some((f) => f.key === state.mapField)) {
      state.mapField = available[0].key;
    }

    const output = c.module === 'em'
      ? el('section', { class: 'plate' },
          el('h2', {}, 'Mapa del campo'),
          el('div', { class: 'fieldmap-tabs' },
            ...available.map((field) => el('button', {
              type: 'button', 'aria-pressed': state.mapField === field.key,
              onclick: () => { state.mapField = field.key; render(); },
            }, field.label)),
            el('span', { class: 'fieldmap-modes' }, ['2d', '3d'].map((option) => el('button', {
              type: 'button', 'aria-pressed': state.mapMode === option,
              onclick: () => { state.mapMode = option; render(); },
            }, option.toUpperCase())))),
          mapCanvas(),
          el('p', { class: 'hint', 'data-map-range': 'true' }, ''),
          el('p', { class: 'hint' },
            'La escala se recorta a los percentiles 4 y 96 para que el pico junto a una ' +
            'carga no aplane el resto. Todo el barrido se integra aca, en el navegador.'),
          available.length && (b.probes ?? []).length
            ? el('table', { class: 'results' }, el('tbody', {}, (b.probes ?? []).map((probe) =>
                el('tr', {},
                  el('th', { class: 'sym-cell' }, probe.label),
                  ...available.map((field) => el('td', { class: 'num', 'data-probe': `${probe.id}|${field.key}` },
                    el('span', {}, ''), el('span', { class: 'u' }, ` ${field.units}`))))))) 
            : null,
          el('span', { class: 'plate-code' }, 'ETAPA 3 / MAPA'))
      : el('section', { class: 'plate' },
          el('h2', {}, 'Diagramas'),
          ...(DIAGRAMS[diagramsOf()] ?? []).filter(([key]) => b.functions[key])
            .map(([key, title, units, color]) => el('figure', { class: 'plot' },
              el('figcaption', {}, el('span', {}, title), el('span', {}, units)),
              el('div', { 'data-plot': key }, drawPlot(b.functions[key], color, L, breaks)))),
          el('span', { class: 'plate-code' }, 'ETAPA 3 / DIAGRAMAS'));

    const suggestions = [
      ...Object.entries(b.reactions).map(([k, p]) => ({ label: k, latex: p.latex })),
      ...Object.entries(b.scalars).map(([k, p]) =>
        ({ label: SCALAR_LABELS[k] || k, latex: p.latex })),
    ];

    return el('div', { class: 'sheet' },
      notebook('stage3', 'Mi desarrollo',
        'Anota el reemplazo de valores y el resultado al que llegas, con tus unidades ' +
        'y tus cuentas.', suggestions),
      el('div', { class: 'sheet cols-values' },
      el('div', { class: 'stack' },
        el('section', { class: 'plate' },
          el('h2', {}, 'Valores'),
          ...controls,
          el('span', { class: 'plate-code' }, 'ETAPA 3 / ENTRADAS')),
        el('section', { class: 'plate' },
          el('h2', {}, 'Lo armado en la etapa 1'),
          el('div', { 'data-canvas': 'true' }, drawCanvas()),
          el('span', { class: 'plate-code' }, 'REF. ETAPA 1'))),

      el('div', { class: 'stack' },
        rows.length ? el('section', { class: 'plate' },
          el('h2', {}, 'Resultados'),
          el('table', { class: 'results' }, el('tbody', {}, rows.map((row) =>
            el('tr', {},
              el('th', { class: 'sym-cell' }, row.label),
              el('td', { class: 'expr' }, math(row.packaged.latex)),
              el('td', { class: 'num', 'data-num': row.key }, fmt(val(row.packaged, bd))))))),
          el('span', { class: 'plate-code' }, 'ETAPA 3 / SALIDAS')) : null,
        output)));
  }

  // -------------------------------------------------------------- montaje

  function render() {
    const root = document.getElementById('app');
    const module = moduleOf();

    const header = el('header', { class: 'titleblock' },
      el('div', { class: 'tb-cell' },
        el('span', { class: 'tb-label' }, 'Proyecto'),
        el('span', { class: 'tb-name' }, 'Workspace Funcional')),
      el('div', { class: 'tb-cell tb-modules' },
        el('span', { class: 'tb-label' }, 'Modulo'),
        el('div', { class: 'modules' }, MODULES.map((mod) => el('button', {
          type: 'button', 'aria-pressed': module === mod.id,
          onclick: () => {
            const first = CASES.find((item) => item.module === mod.id);
            if (first) { state.caseId = first.id; state.mapField = 'V'; render(); }
          },
        }, mod.label)))),
      el('nav', { class: 'stepper' }, STAGES.map(([title, hint], i) => el('button', {
        class: 'step', type: 'button', 'aria-current': state.stage === i + 1,
        onclick: () => { state.stage = i + 1; render(); },
      }, el('span', { class: 'step-n' }, i + 1),
         el('span', { class: 'step-t' }, el('b', {}, title), el('span', {}, hint))))));

    const stage = [stage1, stage2, stage3][state.stage - 1]();
    root.replaceChildren(header, el('main', {}, stage));
    if (state.stage === 3) refresh();
    window.scrollTo({ top: 0 });
  }

  render();
})();
