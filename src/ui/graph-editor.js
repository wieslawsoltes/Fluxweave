import { definition, FAMILIES, OPS } from '../core/operators.js';
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));
export const SYMBOLS = {
    noise: '≋', ramp: '◩', constant: '■', shape: '◯', checker: '▦', transform: '⌖', displace: '⌁', kaleido: '✳', blur: '◌', bloom: '☼', level: '◐', composite: '▱', edge: '▧', feedback: '↻', shader: '⌘', image: '▣', video: '▷', camera: '◉', output: '↗', lfo: '∿', value: '1', math: '±', audio: '≋', torus: '◎', sphere: '◉', box: '⬡', grid: '▦', geoTransform: '⌖', render: '◇', particles: '⁙', component: '◈'
};
export const TYPE_COLORS = { texture: FAMILIES.TOP.color, signal: FAMILIES.CHOP.color, geometry: FAMILIES.SOP.color };
export class GraphEditor {
    constructor(graph, engine, actions) {
        this.graph = graph;
        this.engine = engine;
        this.actions = actions;
        this.host = document.querySelector('#graph');
        this.world = document.querySelector('#node-world');
        this.wires = document.querySelector('#wire-world');
        this.elements = new Map();
        this.drag = null;
        this.lastPoint = { x: 400, y: 180 };
        this.host.addEventListener('pointerdown', e => this.down(e));
        this.host.addEventListener('pointermove', e => this.move(e));
        this.host.addEventListener('pointerup', e => this.up(e));
        this.host.addEventListener('pointercancel', e => this.up(e, true));
        this.host.addEventListener('contextmenu', e => {
            e.preventDefault();
            if (!this.contextMoved)
                this.actions.palette(e.clientX, e.clientY);
            this.contextMoved = false;
        });
        this.host.addEventListener('wheel', e => {
            e.preventDefault();
            const r = this.host.getBoundingClientRect();
            this.zoom(Math.exp(-e.deltaY * .0015), e.clientX - r.left, e.clientY - r.top);
        }, { passive: false });
        this.host.addEventListener('dblclick', e => {
            const el = e.target.closest('.node');
            if (el) {
                const n = this.graph.node(el.dataset.id);
                if (n.type === 'component')
                    this.graph.enter(n.componentId);
                else
                    this.actions.view(n.id);
            }
            else if (!e.target.closest('.wire-hit'))
                this.actions.palette(e.clientX, e.clientY);
        });
        this.host.addEventListener('dragover', e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        });
        this.host.addEventListener('drop', e => {
            e.preventDefault();
            const type = e.dataTransfer.getData('fluxweave/operator');
            if (type) {
                const p = this.point(e);
                this.actions.add(type, p.x, p.y);
            }
        });
        graph.addEventListener('change', e => {
            if (e.detail.kind === 'parameter') {
                this.updateFlags();
                return;
            }
            this.render();
        });
        graph.addEventListener('select', () => this.updateFlags());
        graph.addEventListener('navigate', () => this.render());
        this.resize = new ResizeObserver(() => {
            this.updateTransform();
            this.updateWatch();
        });
        this.resize.observe(this.host);
        this.render();
    }
    get view() {
        return this.graph.network.view ||= { x: 20, y: 20, zoom: .8 };
    }
    point(e) {
        const r = this.host.getBoundingClientRect(), v = this.view;
        return { x: (e.clientX - r.left - v.x) / v.zoom, y: (e.clientY - r.top - v.y) / v.zoom };
    }
    center() {
        const r = this.host.getBoundingClientRect(), v = this.view;
        return { x: (r.width / 2 - v.x) / v.zoom - 90, y: (r.height / 2 - v.y) / v.zoom - 68 };
    }
    render() {
        const nodes = this.graph.network.nodes, ids = new Set(nodes.map(n => n.id));
        for (const [id, el] of this.elements)
            if (!ids.has(id)) {
                const c = el.querySelector('canvas');
                if (c)
                    this.engine.detachView(c);
                el.remove();
                this.elements.delete(id);
            }
        for (const n of nodes) {
            let el = this.elements.get(n.id);
            const def = definition(n, this.graph.project), family = FAMILIES[def.family], portSignature = `${this.graph.active || 'root'}:${n.type}:${def.output}:` + def.inputs.map(p => p.type + p.name).join(',');
            if (!el || el.dataset.portSignature !== portSignature) {
                if (el) {
                    this.engine.detachView(el.querySelector('canvas'));
                    el.remove();
                }
                el = document.createElement('div');
                el.className = 'node';
                el.dataset.id = n.id;
                el.dataset.portSignature = portSignature;
                el.style.setProperty('--node-color', family.color);
                el.innerHTML = `<div class="node-head"><span class="node-symbol">${SYMBOLS[n.type] || '◈'}</span><span class="node-name">${escapeHTML(n.name)}</span><span class="node-family">${def.family}</span></div><div class="node-preview">${n.type === 'component' ? `<div class="component-preview"><strong>◈</strong><span>${this.graph.project.components[n.componentId]?.nodes.length || 0} INTERNAL OPERATORS</span></div>` : '<canvas></canvas>'}</div><div class="node-footer"><span class="node-info"></span><button class="bypass-flag" title="Bypass operator">⊘</button><button class="display-flag" title="View output">●</button></div>${def.inputs.map((p, i) => `<button class="node-port input" data-input="${i}" data-id="${n.id}" title="${escapeHTML(p.name)} · ${p.type}" style="--port-color:${TYPE_COLORS[p.type]};top:${this.inputY(def, i) - 6}px"></button>`).join('')}<button class="node-port output" data-id="${n.id}" title="${def.output} output" style="--port-color:${TYPE_COLORS[def.output]}"></button>`;
                const canvas = el.querySelector('canvas');
                if (canvas) {
                    canvas.width = 178;
                    canvas.height = 87;
                    if (def.output !== 'signal' && this.engine.ready) {
                        const scope = this.graph.active;
                        this.engine.attachView(canvas, () => this.engine.resolve(n.id, scope), true);
                    }
                }
                el.querySelector('.display-flag').onclick = e => {
                    e.stopPropagation();
                    this.actions.view(n.id);
                };
                el.querySelector('.bypass-flag').onclick = e => {
                    e.stopPropagation();
                    this.graph.update(n.id, 'bypass', !this.graph.node(n.id).bypass, null);
                };
                this.elements.set(n.id, el);
                this.world.append(el);
            }
            el.style.left = n.x + 'px';
            el.style.top = n.y + 'px';
            el.querySelector('.node-name').textContent = n.name;
            el.querySelector('.node-info').textContent = def.output === 'texture' ? `${this.graph.project.settings.width} × ${this.graph.project.settings.height}` : def.output === 'signal' ? '1 channel · float32' : n.type === 'component' ? 'shared definition' : 'indexed mesh';
        }
        document.querySelector('#graph-empty').classList.toggle('visible', !nodes.length);
        this.updateTransform();
        this.updateFlags();
        this.updateWatch();
    }
    attachPreviews() {
        for (const [id, el] of this.elements) {
            const n = this.graph.node(id), c = el.querySelector('canvas');
            if (c && definition(n, this.graph.project).output !== 'signal') {
                const scope = this.graph.active;
                this.engine.attachView(c, () => this.engine.resolve(id, scope), true);
            }
        }
    }
    updateTransform() {
        const v = this.view;
        this.world.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.zoom})`;
        this.wires.setAttribute('transform', `translate(${v.x} ${v.y}) scale(${v.zoom})`);
        this.host.style.backgroundSize = `${18 * v.zoom}px ${18 * v.zoom}px`;
        this.host.style.backgroundPosition = `${v.x}px ${v.y}px`;
        document.querySelector('#zoom-label').textContent = Math.round(v.zoom * 100) + '%';
        this.drawEdges();
        this.updateWatch();
    }
    updateFlags() {
        for (const [id, el] of this.elements) {
            const n = this.graph.node(id);
            if (!n)
                continue;
            el.classList.toggle('selected', this.graph.selection.has(id));
            el.classList.toggle('bypassed', !!n.bypass);
            el.classList.toggle('viewed', this.engine.resolve(id, this.graph.active) === this.engine.viewerId);
            el.querySelector('.bypass-flag').classList.toggle('active', !!n.bypass);
        }
        this.drawEdges();
    }
    inputY(def, i) {
        return def.inputs.length < 2 ? 70 : 45 + i * 53 / (def.inputs.length - 1);
    }
    outputPosition(n) {
        return { x: n.x + 180, y: n.y + 70 };
    }
    inputPosition(n, i) {
        return { x: n.x, y: n.y + this.inputY(definition(n, this.graph.project), i) };
    }
    path(a, b) {
        const d = Math.max(55, Math.abs(b.x - a.x) * .48);
        return `M ${a.x} ${a.y} C ${a.x + d} ${a.y},${b.x - d} ${b.y},${b.x} ${b.y}`;
    }
    drawEdges() {
        const nodes = new Map(this.graph.network.nodes.map(n => [n.id, n]));
        const selected = this.graph.selection;
        this.wires.innerHTML = this.graph.network.edges.map(e => {
            const a = nodes.get(e.from), b = nodes.get(e.to);
            if (!a || !b)
                return '';
            const p = this.path(this.outputPosition(a), this.inputPosition(b, e.input)), color = TYPE_COLORS[definition(a, this.graph.project).output];
            return `<g><path class="wire-hit" data-edge="${escapeHTML(e.id)}" d="${p}"/><path class="wire ${selected.has(a.id) || selected.has(b.id) ? 'selected' : ''}" d="${p}" stroke="${color}"/></g>`;
        }).join('');
        if (this.drag?.kind === 'wire') {
            const a = this.drag.start, b = this.drag.end;
            this.wires.insertAdjacentHTML('beforeend', `<path class="wire-temp" d="${this.path(a, b)}"/>`);
        }
    }
    updateWatch() {
        if (!this.engine.compiled)
            return;
        const r = this.host.getBoundingClientRect(), v = this.view, set = new Set();
        for (const n of this.graph.network.nodes) {
            const x = n.x * v.zoom + v.x, y = n.y * v.zoom + v.y;
            if (x + 180 * v.zoom > 0 && y + 137 * v.zoom > 0 && x < r.width && y < r.height) {
                const id = this.engine.resolve(n.id, this.graph.active);
                if (id)
                    set.add(id);
            }
        }
        this.engine.watch = set;
    }
    fit() {
        const nodes = this.graph.network.nodes;
        if (!nodes.length) {
            this.view.x = 30;
            this.view.y = 30;
            this.view.zoom = 1;
            this.updateTransform();
            return;
        }
        const r = this.host.getBoundingClientRect(), minX = Math.min(...nodes.map(n => n.x)), minY = Math.min(...nodes.map(n => n.y)), maxX = Math.max(...nodes.map(n => n.x + 180)), maxY = Math.max(...nodes.map(n => n.y + 137));
        const scale = Math.min(1.1, Math.max(.15, Math.min((r.width - 60) / (maxX - minX), (r.height - 58) / (maxY - minY))));
        Object.assign(this.view, { zoom: scale, x: (r.width - (maxX - minX) * scale) / 2 - minX * scale, y: (r.height - (maxY - minY) * scale) / 2 - minY * scale - 8 });
        this.updateTransform();
    }
    zoom(factor, x = this.host.clientWidth / 2, y = this.host.clientHeight / 2) {
        const v = this.view, old = v.zoom, next = Math.min(2.6, Math.max(.15, old * factor));
        v.x = x - (x - v.x) * next / old;
        v.y = y - (y - v.y) * next / old;
        v.zoom = next;
        this.updateTransform();
    }
    down(e) {
        if (e.target.closest('.node-footer') || e.target.closest('.graph-zoom'))
            return;
        const edge = e.target.closest('.wire-hit');
        if (edge) {
            if (e.altKey || e.button === 0) {
                this.graph.disconnect(edge.dataset.edge);
                this.actions.toast('Connection removed.');
            }
            return;
        }
        const p = this.point(e);
        this.lastPoint = p;
        this.host.focus();
        const port = e.target.closest('.node-port');
        if (port) {
            e.preventDefault();
            const n = this.graph.node(port.dataset.id);
            if (port.classList.contains('output')) {
                this.drag = {
                    kind: 'wire', from: n.id, start: this.outputPosition(n), end: p
                };
            }
            else {
                const edge = this.graph.network.edges.find(x => x.to === n.id && x.input === Number(port.dataset.input));
                if (edge) {
                    if (e.altKey) {
                        this.graph.disconnect(edge.id);
                        return;
                    }
                    const a = this.graph.node(edge.from);
                    this.drag = {
                        kind: 'wire', from: a.id, start: this.outputPosition(a), end: p, oldEdge: edge
                    };
                }
                else {
                    this.actions.toast('Drag from an output on the right to this input.');
                    return;
                }
            }
        }
        else {
            const el = e.target.closest('.node');
            if (el && e.button === 0) {
                const id = el.dataset.id;
                if (e.shiftKey) {
                    const set = new Set(this.graph.selection);
                    set.has(id) ? set.delete(id) : set.add(id);
                    this.graph.select(set);
                }
                else if (!this.graph.selection.has(id))
                    this.graph.select([id]);
                this.drag = {
                    kind: 'node', start: p, before: this.graph.snapshot(), origins: new Map([...this.graph.selection].map(id => {
                        const n = this.graph.node(id);
                        return [id, { x: n.x, y: n.y }];
                    })), moved: false
                };
            }
            else if (e.shiftKey && e.button === 0) {
                this.drag = { kind: 'box', start: p, end: p };
                document.querySelector('#selection-box').style.display = 'block';
            }
            else
                this.drag = {
                    kind: 'pan', x: e.clientX, y: e.clientY, startX: this.view.x, startY: this.view.y, moved: false, button: e.button
                };
        }
        if (this.drag) {
            this.host.setPointerCapture(e.pointerId);
            e.preventDefault();
        }
    }
    move(e) {
        const p = this.point(e);
        this.lastPoint = p;
        if (!this.drag)
            return;
        const d = this.drag;
        if (d.kind === 'wire') {
            d.end = p;
            this.drawEdges();
        }
        if (d.kind === 'node') {
            const dx = p.x - d.start.x, dy = p.y - d.start.y;
            d.moved ||= Math.abs(dx) + Math.abs(dy) > 2;
            for (const [id, start] of d.origins) {
                const n = this.graph.node(id);
                n.x = Math.round(start.x + dx);
                n.y = Math.round(start.y + dy);
                const el = this.elements.get(id);
                el.style.left = n.x + 'px';
                el.style.top = n.y + 'px';
            }
            this.drawEdges();
        }
        if (d.kind === 'pan') {
            const dx = e.clientX - d.x, dy = e.clientY - d.y;
            d.moved ||= Math.abs(dx) + Math.abs(dy) > 3;
            this.view.x = d.startX + dx;
            this.view.y = d.startY + dy;
            this.updateTransform();
        }
        if (d.kind === 'box') {
            d.end = p;
            const box = document.querySelector('#selection-box'), v = this.view;
            box.style.left = (Math.min(d.start.x, p.x) * v.zoom + v.x) + 'px';
            box.style.top = (Math.min(d.start.y, p.y) * v.zoom + v.y) + 'px';
            box.style.width = Math.abs(d.start.x - p.x) * v.zoom + 'px';
            box.style.height = Math.abs(d.start.y - p.y) * v.zoom + 'px';
        }
    }
    up(e, cancel = false) {
        const d = this.drag;
        if (!d)
            return;
        this.drag = null;
        this.contextMoved = d.kind === 'pan' && d.moved;
        try {
            if (d.kind === 'wire' && !cancel) {
                const port = document.elementFromPoint(e.clientX, e.clientY)?.closest('.node-port.input');
                if (port) {
                    this.graph.connect(d.from, port.dataset.id, Number(port.dataset.input));
                    if (d.oldEdge && !(d.oldEdge.to === port.dataset.id && d.oldEdge.input === Number(port.dataset.input)))
                        this.graph.disconnect(d.oldEdge.id);
                    this.actions.toast('Operators connected.');
                }
            }
            if (d.kind === 'node') {
                if (cancel)
                    this.graph.restore(d.before);
                else if (d.moved) {
                    this.graph.history.push(d.before, this.graph.snapshot(), 'Move operators');
                    this.graph.emit('layout');
                }
            }
            if (d.kind === 'pan' && !d.moved && d.button === 0)
                this.graph.select([]);
            if (d.kind === 'box') {
                const a = d.start, b = d.end;
                this.graph.select(this.graph.network.nodes.filter(n => n.x + 180 >= Math.min(a.x, b.x) && n.x <= Math.max(a.x, b.x) && n.y + 137 >= Math.min(a.y, b.y) && n.y <= Math.max(a.y, b.y)).map(n => n.id));
            }
        }
        catch (err) {
            this.actions.toast(err.message, true);
        }
        document.querySelector('#selection-box').style.display = 'none';
        if (this.host.hasPointerCapture(e.pointerId))
            this.host.releasePointerCapture(e.pointerId);
        this.drawEdges();
        this.updateWatch();
    }
    layout() {
        this.graph.transact('Arrange network', () => {
            const net = this.graph.network, depth = new Map(net.nodes.map(n => [n.id, 0]));
            for (let k = 0; k < net.nodes.length; k++)
                for (const e of net.edges) {
                    if (OPS[this.graph.node(e.to).type]?.delay || OPS[this.graph.node(e.from).type]?.delay)
                        continue;
                    depth.set(e.to, Math.max(depth.get(e.to), Math.min(net.nodes.length, depth.get(e.from) + 1)));
                }
            const rows = new Map();
            for (const n of net.nodes) {
                const d = depth.get(n.id), row = rows.get(d) || 0;
                n.x = 40 + d * 240;
                n.y = 40 + row * 205;
                rows.set(d, row + 1);
            }
        });
        this.fit();
    }
    scopes() {
        for (const [id, el] of this.elements) {
            const n = this.graph.node(id), rid = this.engine.resolve(id, this.graph.active), state = this.engine.states.get(rid);
            el.classList.toggle('has-error', !!state?.error);
            el.title = state?.error || '';
            const canvas = el.querySelector('canvas');
            if (!canvas || definition(n, this.graph.project).output !== 'signal')
                continue;
            const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height, data = state?.data;
            ctx.clearRect(0, 0, w, h);
            ctx.fillStyle = '#121b16';
            ctx.fillRect(0, 0, w, h);
            ctx.strokeStyle = '#283b2e';
            ctx.lineWidth = 1;
            for (let y = 17; y < h; y += 17) {
                ctx.beginPath();
                ctx.moveTo(0, y + .5);
                ctx.lineTo(w, y + .5);
                ctx.stroke();
            }
            ctx.strokeStyle = '#a5de85';
            ctx.lineWidth = 1.5;
            const samples = data?.samples;
            if (samples) {
                let max = Math.max(1, ...samples.map(Math.abs));
                ctx.beginPath();
                for (let i = 0; i < samples.length; i++) {
                    const x = i / (samples.length - 1) * w, y = h / 2 - samples[i] / max * (h * .36);
                    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
                }
                ctx.stroke();
            }
            ctx.fillStyle = '#b9e79e';
            ctx.font = '9px monospace';
            ctx.fillText((data?.value || 0).toFixed(4), 8, 12);
            el.querySelector('.node-info').textContent = `chan1  ${(data?.value || 0).toFixed(3)}`;
        }
    }
}
