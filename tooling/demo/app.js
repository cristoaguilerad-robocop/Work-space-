/* Demo del Workspace Funcional.
 *
 * Los modelos vienen pre-derivados (la derivacion simbolica necesita SymPy),
 * pero la evaluacion numerica es el codigo que genera el motor, corriendo en
 * el navegador igual que en la app real. Por eso los diagramas responden al
 * instante al mover un valor.
 */
(() => {
  'use strict';

  const CASES = JSON.parse(document.getElementById('payloads').textContent);

  // -------------------------------------------------------------- evaluador
  //
  // Se recorre el arbol serializado por el motor en vez de compilar su codigo
  // JavaScript. Es una pizca mas lento, pero funciona bajo una CSP que
  // prohibe eval, que es donde vive esta pagina. El backend emite las dos
  // formas a partir de la misma expresion de SymPy.

  function sf(x, a, n) {
    if (n < 0 || x < a) return 0;
    return n === 0 ? 1 : Math.pow(x - a, n);
  }

  const FN = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    exp: Math.exp, log: Math.log, abs: Math.abs,
  };

  function evaluate(node, x, params) {
    if (typeof node === 'number') return node;
    if (node.v !== undefined) return node.v === 'x' ? x : params[node.v];

    const a = node.a;
    switch (node.f) {
      case '+': {
        let out = 0;
        for (const term of a) out += evaluate(term, x, params);
        return out;
      }
      case '*': {
        let out = 1;
        for (const factor of a) out *= evaluate(factor, x, params);
        return out;
      }
      case '^': return Math.pow(evaluate(a[0], x, params), evaluate(a[1], x, params));
      case 'sf': return sf(evaluate(a[0], x, params), evaluate(a[1], x, params), evaluate(a[2], x, params));
      case 'hv': return evaluate(a[0], x, params) < 0 ? 0 : 1;
      default: {
        const fn = FN[node.f];
        return fn ? fn(...a.map((arg) => evaluate(arg, x, params))) : NaN;
      }
    }
  }

  /** Devuelve un evaluador de una expresion empaquetada. */
  const compile = (packaged) => (x, b) => {
    const out = evaluate(packaged.ast, x, b);
    return Number.isFinite(out) ? out : NaN;
  };

  const val = (packaged, b) => compile(packaged)(0, b);

  // -------------------------------------------------------------- estado

  const state = {
    caseId: CASES[0].id,
    stage: 1,
    bindings: Object.fromEntries(CASES.map((c) => [
      c.id,
      Object.fromEntries(c.derived.symbols.map((s) => [s.name, s.value])),
    ])),
  };

  const current = () => CASES.find((c) => c.id === state.caseId);
  const bindings = () => state.bindings[state.caseId];
  const body = () => current().derived.bodies[0];

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

  // El modo (inline o display) ya lo decidio el build; aca solo se inserta.
  const math = (packaged) => el('span', { html: packaged.html });

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
    const b = body(), bd = bindings();
    const L = val(b.length, bd) || 1;
    const px = (x) => MARGIN + (x / L) * (CW - 2 * MARGIN);

    const root = svg('svg', {
      class: 'canvas', viewBox: `0 0 ${CW} ${CH}`,
      role: 'img', 'aria-label': 'Diagrama de cuerpo libre',
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
      const f = compile(load.profile);
      for (let i = 0; i <= 60; i += 1) peak = Math.max(peak, Math.abs(f((i / 60) * L, bd)));
    }
    const scale = peak > 0 ? LOAD_PX / peak : 0;

    for (const load of dist) {
      const f = compile(load.profile);
      const a = val(load.start, bd), z = val(load.end, bd);
      const h = (x) => Math.abs(f(x, bd)) * scale;
      const down = f((a + z) / 2, bd) <= 0;

      const pts = [];
      for (let i = 0; i <= 80; i += 1) {
        const x = a + ((z - a) * i) / 80;
        pts.push(`${px(x).toFixed(1)},${(BEAM_Y - h(x)).toFixed(1)}`);
      }

      const g = svg('g', { class: 'dist' });
      g.append(svg('polygon', {
        points: `${px(a).toFixed(1)},${BEAM_Y} ${pts.join(' ')} ${px(z).toFixed(1)},${BEAM_Y}`,
      }));
      g.append(svg('polyline', { points: pts.join(' ') }));

      for (let i = 0; i < 6; i += 1) {
        const x = a + ((z - a) * (i + 0.5)) / 6;
        const top = BEAM_Y - h(x);
        if (Math.abs(BEAM_Y - top) < 7) continue;
        g.append(svg('line', {
          x1: px(x), y1: down ? top : BEAM_Y, x2: px(x), y2: down ? BEAM_Y : top,
          'marker-end': 'url(#ar)',
        }));
      }

      const top = Math.max(...pts.map((p) => BEAM_Y - Number(p.split(',')[1])));
      const label = svg('text', {
        x: px((a + z) / 2), y: BEAM_Y - top - 10, 'text-anchor': 'middle', class: 'lab',
      });
      label.textContent = load.label;
      g.append(label);
      root.append(g);
    }

    for (const load of b.loads.filter((l) => l.kind === 'point')) {
      const at = px(val(load.start, bd));
      const down = load.magnitude ? val(load.magnitude, bd) >= 0 : true;
      const y0 = BEAM_Y - (down ? 66 : -66);
      const g = svg('g', { class: 'pt' });
      g.append(svg('line', { x1: at, y1: y0, x2: at, y2: BEAM_Y, 'marker-end': 'url(#ar)' }));
      const t = svg('text', { x: at, y: y0 - 9, 'text-anchor': 'middle', class: 'lab' });
      t.textContent = load.label;
      g.append(t);
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

    root.append(svg('line', { x1: px(0), y1: BEAM_Y, x2: px(L), y2: BEAM_Y, class: 'beam' }));

    for (const support of b.supports) {
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
    const f = compile(packaged);
    const span = length * (1 - 1e-9);
    const eps = length * 1e-6;

    const grid = new Set();
    for (let i = 0; i <= 400; i += 1) grid.add((i / 400) * span);
    for (const brk of breaks) {
      if (brk > eps && brk < span - eps) { grid.add(brk - eps); grid.add(brk + eps); }
    }

    const xs = [...grid].sort((a, b) => a - b);
    const ys = xs.map((x) => f(x, bd));
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

    const marks = [
      [PAD.l - 7, PAD.t + 7, axisFmt(hi), 'end'],
      [PAD.l - 7, PH - PAD.b, axisFmt(lo), 'end'],
      [PAD.l, PH - 6, '0', 'start'],
      [PW - PAD.r, PH - 6, `${length.toFixed(2)} m`, 'end'],
    ];
    for (const [x, y, text, anchor] of marks) {
      const t = svg('text', { x, y, class: 'tick', 'text-anchor': anchor });
      t.textContent = text;
      root.append(t);
    }
    return root;
  }

  // -------------------------------------------------------------- etapas

  const STAGES = [
    ['Modelar', 'Cuerpo, dominio, cargas y apoyos'],
    ['Plantear', 'Ecuaciones derivadas del modelo'],
    ['Valorizar', 'Numeros y diagramas'],
  ];

  const KIND_MARK = { algebra: '=', integrate: '∫', solve: '→', substitute: '↦', check: '✓' };

  function describeLoad(load) {
    if (load.kind === 'thermal') return 'campo de temperatura sobre todo el dominio';
    if (load.kind === 'couple') return 'par concentrado';
    if (load.kind === 'point') return 'fuerza concentrada';
    return 'carga distribuida';
  }

  function stage1() {
    const c = current(), b = body();
    const model = c.model.bodies[0];

    const spec = el('div', { class: 'spec' },
      el('div', { class: 'spec-row' },
        el('div', { class: 'spec-key' }, 'Dominio'),
        el('div', { class: 'spec-val', html: `<code>x ∈ [0, ${model.domain.end}]</code>` })),
      el('div', { class: 'spec-row' },
        el('div', { class: 'spec-key' }, 'Analisis'),
        el('div', { class: 'spec-val' },
          model.analysis.mode === 'rigid'
            ? el('span', {}, 'Rigido ', el('em', {}, '— resultantes y equilibrio'))
            : el('span', {}, 'Deformable ', el('em', {}, '— hasta la elastica')))),
      ...model.fields.map((field) => {
        const load = b.loads.find((l) => l.id === field.id);
        let detail;
        if (field.kind === 'thermal') {
          detail = `T_sup = ${field.profile.T_top}, T_inf = ${field.profile.T_bottom}`;
        } else if (field.distribution.type === 'point') {
          detail = `${field.distribution.magnitude} en x = ${field.region.at}`;
        } else if (field.distribution.type === 'linear') {
          const r = field.region.type === 'full'
            ? `[0, ${model.domain.end}]`
            : `[${field.region.start}, ${field.region.end}]`;
          detail = `${field.distribution.w_start} → ${field.distribution.w_end} sobre ${r}`;
        } else if (field.distribution.type === 'uniform') {
          detail = `w(x) = ${field.distribution.w}`;
        } else {
          detail = `w(x) = ${field.distribution.expr}`;
        }
        return el('div', { class: 'spec-row' },
          el('div', { class: 'spec-key' }, field.id),
          el('div', { class: 'spec-val' },
            el('code', {}, detail),
            el('br'),
            el('em', {}, describeLoad(load || { kind: 'thermal' }))));
      }),
      el('div', { class: 'spec-row' },
        el('div', { class: 'spec-key' }, 'Apoyos'),
        el('div', { class: 'spec-val', html: c.model.supports
          .map((s) => `<code>${s.id}</code> <em>${
            { pin: 'articulado', roller: 'movil', fixed: 'empotrado' }[s.type]
          } en ${s.at}</em>`).join('<br>') })),
    );

    return el('div', { class: 'sheet' },
      el('div', { class: 'sheet cols-model' },
        el('section', { class: 'plate' },
          el('h2', {}, 'Diagrama de cuerpo libre'),
          drawCanvas(),
          el('span', { class: 'plate-code' }, 'ETAPA 1 / MODELO')),
        el('section', { class: 'plate' },
          el('h2', {}, 'Modelo'),
          spec,
          el('span', { class: 'plate-code' }, 'ESPEC'))),

      el('div', { class: 'demo-note' },
        el('b', {}, 'Demo'),
        el('span', {}, 'Los nueve modelos vienen pre-derivados porque la derivacion ' +
          'simbolica necesita SymPy. La etapa 3 en cambio es totalmente viva: evalua ' +
          'el mismo JavaScript que genera el motor. Para editar el modelo libremente ' +
          'hay que correr el backend Python.')),

      el('section', { class: 'plate' },
        el('h2', {}, 'Casos'),
        el('div', { class: 'cases' }, CASES.map((item) => el('button', {
          class: 'case',
          type: 'button',
          'aria-pressed': item.id === state.caseId,
          onclick: () => { state.caseId = item.id; render(); },
        }, el('b', {}, item.name), el('span', {}, item.note)))),
        el('span', { class: 'plate-code' }, 'INDICE')));
  }

  const ROLES = [
    ['equilibrium', 'Equilibrio y condiciones de borde'],
    ['result', 'Resultados simbolicos'],
    ['field', 'Funciones sobre el dominio'],
  ];

  function stage2() {
    const b = body();
    return el('div', { class: 'sheet' },
      ...ROLES.map(([role, title]) => {
        const group = b.equations.filter((e) => e.role === role);
        if (!group.length) return null;
        return el('section', { class: 'plate derivation' },
          el('h2', {}, title),
          ...group.map((eq) => el('article', { class: 'eq' },
            el('div', { class: 'eq-head' }, el('b', {}, eq.title), el('code', {}, eq.id)),
            el('div', { class: 'eq-body' }, math(eq.latex)),
            eq.detail ? el('p', {}, eq.detail) : null)),
          el('span', { class: 'plate-code' }, 'ETAPA 2'));
      }),
      el('section', { class: 'plate derivation' },
        el('h2', {}, `Desarrollo paso a paso — ${b.steps.length} pasos`),
        el('ol', { class: 'steps' }, b.steps.map((step) => el('li', { 'data-kind': step.kind },
          el('span', { class: 'step-mark', 'aria-hidden': 'true' }, KIND_MARK[step.kind] || '·'),
          el('div', {},
            el('b', {}, step.title),
            step.latex.src ? el('div', { class: 'eq-body' }, math(step.latex)) : null,
            step.detail ? el('p', {}, step.detail) : null)))),
        el('span', { class: 'plate-code' }, 'ETAPA 2 / TRAZA')));
  }

  const DIAGRAMS = [
    ['V', 'Cortante V(x)', 'N', 'var(--shear)'],
    ['M', 'Momento flector M(x)', 'N·m', 'var(--moment)'],
    ['theta', 'Pendiente θ(x)', 'rad', 'var(--slope)'],
    ['y', 'Deflexion y(x)', 'm', 'var(--defl)'],
  ];

  const SCALAR_LABELS = { elongation: 'Alargamiento δ' };

  /** Redibuja solo lo que depende de los numeros. La derivacion no se toca. */
  function refreshNumeric() {
    const b = body(), bd = bindings();
    const L = val(b.length, bd) || 1;
    const breaks = b.loads
      .filter((l) => l.kind === 'point' || l.kind === 'couple')
      .map((l) => val(l.start, bd))
      .filter(Number.isFinite);

    for (const [key, , , color] of DIAGRAMS) {
      const slot = document.querySelector(`[data-plot="${key}"]`);
      if (slot && b.functions[key]) slot.replaceChildren(drawPlot(b.functions[key], color, L, breaks));
    }
    for (const cell of document.querySelectorAll('[data-num]')) {
      const key = cell.dataset.num;
      const packaged = b.reactions[key] || b.scalars[key];
      if (packaged) cell.textContent = fmt(val(packaged, bd));
    }
    const preview = document.querySelector('[data-canvas]');
    if (preview) preview.replaceChildren(drawCanvas());
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
        type: 'range',
        min: base * 0.2, max: base * 3, step: (base * 2.8) / 240,
        value: bd[symbol.name], 'aria-label': `${symbol.name} (deslizador)`,
      });
      const apply = (next) => {
        if (!Number.isFinite(next)) return;
        bd[symbol.name] = next;
        number.value = String(Number(next.toPrecision(6)));
        range.value = String(next);
        refreshNumeric();
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
      ...Object.entries(b.reactions).map(([key, packaged]) => ({ key, label: key, packaged })),
      ...Object.entries(b.scalars).map(([key, packaged]) =>
        ({ key, label: SCALAR_LABELS[key] || key, packaged })),
    ];

    return el('div', { class: 'sheet cols-values' },
      el('div', { class: 'stack' },
        el('section', { class: 'plate' },
          el('h2', {}, 'Valores'),
          ...controls,
          el('span', { class: 'plate-code' }, 'ETAPA 3 / ENTRADAS')),
        el('section', { class: 'plate' },
          el('h2', {}, 'Lo definido en la etapa 1'),
          el('div', { 'data-canvas': 'true' }, drawCanvas()),
          el('span', { class: 'plate-code' }, 'REF. ETAPA 1'))),

      el('div', { class: 'stack' },
        el('section', { class: 'plate' },
          el('h2', {}, 'Resultados'),
          el('table', { class: 'results' }, el('tbody', {}, rows.map((row) =>
            el('tr', {},
              el('th', { class: 'sym-cell' }, row.label),
              el('td', { class: 'expr' }, math(row.packaged.latex)),
              el('td', { class: 'num', 'data-num': row.key }, fmt(val(row.packaged, bd))))))),
          el('span', { class: 'plate-code' }, 'ETAPA 3 / SALIDAS')),

        el('section', { class: 'plate' },
          el('h2', {}, 'Diagramas'),
          ...DIAGRAMS.filter(([key]) => b.functions[key]).map(([key, title, units, color]) =>
            el('figure', { class: 'plot' },
              el('figcaption', {}, el('span', {}, title), el('span', {}, units)),
              el('div', { 'data-plot': key }, drawPlot(b.functions[key], color, L, breaks)))),
          el('span', { class: 'plate-code' }, 'ETAPA 3 / DIAGRAMAS'))));
  }

  // -------------------------------------------------------------- montaje

  function render() {
    const root = document.getElementById('app');
    const header = el('header', { class: 'titleblock' },
      el('div', { class: 'tb-cell' },
        el('span', { class: 'tb-label' }, 'Proyecto'),
        el('span', { class: 'tb-name' }, 'Workspace Funcional')),
      el('nav', { class: 'stepper' }, STAGES.map(([title, hint], i) => el('button', {
        class: 'step', type: 'button', 'aria-current': state.stage === i + 1,
        onclick: () => { state.stage = i + 1; render(); },
      }, el('span', { class: 'step-n' }, i + 1),
         el('span', { class: 'step-t' }, el('b', {}, title), el('span', {}, hint))))),
      el('div', { class: 'tb-cell tb-select' },
        el('span', { class: 'tb-label' }, 'Modulo'),
        el('span', {}, 'Estatica · viga 1D')));

    const stage = [stage1, stage2, stage3][state.stage - 1]();
    root.replaceChildren(header, el('main', {}, stage));
    window.scrollTo({ top: 0 });
  }

  render();
})();
