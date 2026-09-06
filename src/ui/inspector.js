import { OPS, definition, FAMILIES, parameterValues } from '../core/operators.js';
import { escapeHTML as esc, SYMBOLS } from './graph-editor.js';
export class Inspector {
    constructor(graph, engine, media, actions) {
        this.graph = graph;
        this.engine = engine;
        this.media = media;
        this.actions = actions;
        this.tab = 'parameters';
        this.body = document.querySelector('#inspector-body');
        this.inputs = new Map();
        document.querySelectorAll('[data-inspector]').forEach(b => b.onclick = () => {
            this.tab = b.dataset.inspector;
            this.render();
        });
        document.querySelector('#selected-name').onchange = e => {
            const n = this.selected;
            if (n)
                this.graph.update(n.id, 'name', e.target.value.trim().slice(0, 120) || n.type, null);
        };
        document.querySelector('#selected-menu').onclick = e => actions.nodeMenu(e);
        graph.addEventListener('select', () => this.render());
        graph.addEventListener('navigate', () => this.render());
        graph.addEventListener('change', e => {
            if (e.detail.kind !== 'parameter')
                this.render();
        });
        media.addEventListener('change', () => this.render());
        this.render();
    }
    get selected() {
        return this.graph.node([...this.graph.selection][0]);
    }
    values(n) {
        return parameterValues(n, this.actions.time(), id => this.engine.states.get(this.engine.resolve(id, this.graph.active))?.data?.value || 0);
    }
    setValue(n, key, value) {
        if (n.keyframes[key]?.length) {
            const time = this.actions.time();
            this.graph.transact('Edit animated parameter', () => {
                const node = this.graph.node(n.id), keys = node.keyframes[key];
                const existing = keys.find(k => Math.abs(k.time - time) < .0001);
                if (existing)
                    existing.value = value;
                else
                    keys.push({ time, value, interpolation: 'smooth' });
                keys.sort((a, b) => a.time - b.time);
                node.params[key] = value;
            }, `key:${n.id}:${key}`, 'parameter');
        }
        else
            this.graph.update(n.id, key, value);
    }
    render() {
        const n = this.selected;
        this.inputs.clear();
        document.querySelectorAll('[data-inspector]').forEach(b => b.classList.toggle('active', b.dataset.inspector === this.tab));
        if (!n) {
            document.querySelector('#selected-name').value = 'No selection';
            document.querySelector('#selected-name').disabled = true;
            document.querySelector('#selected-type').textContent = 'Select an operator in the network';
            this.body.innerHTML = '<div class="inspector-empty">Select an operator to inspect its parameters.<br><br>Double-click to view its output.<br>Press <kbd>Tab</kbd> to create something new.</div>';
            return;
        }
        document.querySelector('#selected-name').disabled = false;
        document.querySelector('#selected-name').value = n.name;
        const def = definition(n, this.graph.project), family = FAMILIES[def.family];
        document.querySelector('#selected-type').textContent = `${def.label} · ${family.name} operator`;
        const icon = document.querySelector('#selected-icon');
        icon.textContent = SYMBOLS[n.type];
        icon.style.color = family.color;
        icon.style.borderColor = family.color + '55';
        const count = Object.values(n.keyframes || {}).reduce((a, b) => a + b.length, 0);
        document.querySelector('#key-count').textContent = count;
        if (this.tab === 'info') {
            this.info(n, def);
            return;
        }
        if (this.tab === 'animation') {
            this.animation(n);
            return;
        }
        this.body.innerHTML = '';
        if (n.type === 'component') {
            const comp = this.graph.project.components[n.componentId];
            const button = document.createElement('button');
            button.className = 'full-width-button';
            button.textContent = '↳ Enter shared component';
            button.onclick = () => this.graph.enter(n.componentId);
            this.body.append(button);
            const info = document.createElement('p');
            info.className = 'description-note';
            info.textContent = `${comp.nodes.length} internal operators · ${comp.inputs.length} typed inputs. Each instance has independent textures, feedback history, and particle state. Edits to the definition update every instance.`;
            this.body.append(info);
            return;
        }
        if (OPS[n.type].media)
            this.mediaControls(n);
        if (n.type === 'shader') {
            const b = document.createElement('button');
            b.className = 'full-width-button';
            b.textContent = '〈/〉 Open live WGSL editor';
            b.onclick = () => this.actions.editor('shader');
            this.body.append(b);
        }
        const heading = document.createElement('div');
        heading.className = 'param-section-title';
        heading.innerHTML = `<b>${def.family === 'CHOP' ? 'Signal' : def.family === 'SOP' ? 'Geometry' : 'Operator'} settings</b><span>${def.family}</span>`;
        this.body.append(heading);
        const values = this.values(n), signals = this.graph.network.nodes.filter(m => m.id !== n.id && definition(m, this.graph.project).output === 'signal');
        for (const [key, schema] of Object.entries(def.params)) {
            if (schema.type === 'code')
                continue;
            const row = document.createElement('div');
            row.className = 'parameter';
            row.classList.toggle('bound', !!n.bindings[key]);
            const animated = !!n.keyframes[key]?.length, bound = !!n.bindings[key];
            const top = document.createElement('div');
            top.className = 'param-top';
            const label = document.createElement('label');
            label.textContent = schema.label;
            top.append(label);
            if (schema.type === 'number') {
                const bind = document.createElement('button');
                bind.className = 'bind-button' + (bound ? ' bound' : '');
                bind.textContent = '⌁';
                bind.title = 'Bind a numeric channel';
                top.append(bind);
                const keybutton = document.createElement('button');
                keybutton.className = 'key-button' + (animated ? ' animated' : '');
                keybutton.textContent = animated ? '◆' : '◇';
                keybutton.title = 'Add/remove keyframe at the playhead';
                keybutton.onclick = () => {
                    this.graph.keyframe(n.id, key, this.actions.time(), this.values(n)[key]);
                    this.render();
                };
                top.append(keybutton);
                bind.onclick = () => row.querySelector('.binding-panel').classList.toggle('open');
            }
            row.append(top);
            const control = document.createElement('div');
            control.className = 'param-control';
            if (schema.type === 'number') {
                const range = document.createElement('input');
                range.type = 'range';
                range.min = schema.min;
                range.max = schema.max;
                range.step = schema.step;
                range.value = values[key];
                range.setAttribute('aria-label', schema.label);
                const number = document.createElement('input');
                number.type = 'number';
                number.min = schema.min;
                number.max = schema.max;
                number.step = schema.step;
                number.value = Number(values[key].toFixed(4));
                number.setAttribute('aria-label', schema.label + ' value');
                range.disabled = number.disabled = bound;
                range.oninput = () => {
                    const value = Number(range.value);
                    number.value = value;
                    this.setValue(n, key, value);
                };
                number.onchange = () => {
                    let v = Number(number.value);
                    if (!Number.isFinite(v))
                        v = schema.value;
                    v = Math.min(schema.max, Math.max(schema.min, v));
                    if (schema.step === 1)
                        v = Math.round(v);
                    number.value = v;
                    range.value = v;
                    this.setValue(n, key, v);
                };
                control.append(range, number);
                this.inputs.set(key, { range, number });
            }
            else if (schema.type === 'select') {
                const select = document.createElement('select');
                select.setAttribute('aria-label', schema.label);
                for (const option of schema.options) {
                    const el = document.createElement('option');
                    el.value = option;
                    el.textContent = option[0].toUpperCase() + option.slice(1);
                    select.append(el);
                }
                select.value = n.params[key];
                select.onchange = () => this.graph.update(n.id, key, select.value);
                control.append(select);
            }
            else if (schema.type === 'color') {
                const color = document.createElement('input');
                color.type = 'color';
                color.value = n.params[key];
                color.setAttribute('aria-label', schema.label);
                const text = document.createElement('span');
                text.className = 'color-value';
                text.textContent = n.params[key].toUpperCase();
                color.oninput = () => {
                    this.graph.update(n.id, key, color.value);
                    text.textContent = color.value.toUpperCase();
                };
                control.append(color, text);
            }
            row.append(control);
            if (schema.type === 'number') {
                const binding = document.createElement('div');
                binding.className = 'binding-panel';
                const select = document.createElement('select');
                select.innerHTML = '<option value="">No channel binding</option>' + signals.map(m => `<option value="${esc(m.id)}">${esc(m.name)} → chan1</option>`).join('');
                select.value = n.bindings[key]?.node || '';
                const scale = document.createElement('input'), offset = document.createElement('input');
                for (const i of [scale, offset]) {
                    i.type = 'number';
                    i.step = '.01';
                }
                scale.value = n.bindings[key]?.scale ?? 1;
                offset.value = n.bindings[key]?.offset ?? 0;
                const commit = () => {
                    try {
                        this.graph.bind(n.id, key, select.value, Number(scale.value) || 0, Number(offset.value) || 0);
                    }
                    catch (e) {
                        this.actions.toast(e.message, true);
                        this.render();
                    }
                };
                select.onchange = commit;
                scale.onchange = commit;
                offset.onchange = commit;
                const sl = document.createElement('label');
                sl.textContent = 'Multiply';
                sl.append(scale);
                const ol = document.createElement('label');
                ol.textContent = 'Add';
                ol.append(offset);
                binding.append(select, sl, ol);
                row.append(binding);
            }
            this.body.append(row);
        }
        const description = document.createElement('p');
        description.className = 'description-note';
        description.textContent = def.description;
        this.body.append(description);
        if (n.type === 'feedback') {
            const button = document.createElement('button');
            button.className = 'full-width-button';
            button.textContent = '↻ Reset feedback buffers';
            button.onclick = () => {
                this.engine.resetSimulation();
                this.actions.toast('Feedback and particle state reset.');
            };
            this.body.append(button);
        }
        if (n.type === 'output') {
            const button = document.createElement('button');
            button.className = 'full-width-button';
            button.textContent = '↗ Set as project output';
            button.onclick = () => this.actions.setOutput(n.id);
            this.body.append(button);
        }
    }
    mediaControls(n) {
        const type = OPS[n.type].media, rec = this.media.sources.get(n.id), div = document.createElement('div');
        div.className = 'media-controls';
        const title = document.createElement('h4');
        title.textContent = rec ? '● Source active' : 'Connect a source';
        div.append(title);
        const button = (text, handler) => {
            const b = document.createElement('button');
            b.textContent = text;
            b.onclick = async () => {
                try {
                    await handler();
                    this.render();
                }
                catch (e) {
                    this.actions.toast(e.message, true);
                }
            };
            div.append(b);
        };
        if (type === 'camera')
            button('Enable camera', () => this.media.camera(n.id));
        else if (type === 'audio') {
            button('Microphone', () => this.media.microphone(n.id));
            button('Audio file', () => this.actions.media(n.id, 'audio'));
            button('Test tone', () => this.media.testTone(n.id));
        }
        else
            button(type === 'image' ? 'Choose image' : 'Choose video', () => this.actions.media(n.id, type));
        if (!rec && type === 'audio' && n.params.assetId) {
            const saved = this.graph.project.assets[n.params.assetId];
            if (saved)
                button('Play saved audio', () => this.media.asset(n.id, { ...saved, id: n.params.assetId }, 'audio'));
        }
        if (rec)
            button('Stop source', () => this.media.stop(n.id));
        const info = document.createElement('small');
        info.textContent = n.params.assetId ? this.graph.project.assets[n.params.assetId]?.name || 'Embedded source' : type === 'camera' || type === 'audio' ? 'Access begins only after you grant permission. Nothing is uploaded.' : 'Local files are embedded in project exports (up to 64 MB per asset).';
        div.append(info);
        this.body.append(div);
    }
    info(n, def) {
        const id = this.engine.resolve(n.id, this.graph.active), s = this.engine.states.get(id);
        this.body.innerHTML = '<div class="param-section-title">Operator information</div>';
        const rows = [['Type', `${def.label} / ${def.family}`], ['Output', def.output], ['Inputs', def.inputs.length], ['Total cooks', s?.cooks || 0], ['Last CPU encode', `${(s?.cpuMs || 0).toFixed(3)} ms`], ['Revision', s?.revision || 0], ['Runtime ID', id || 'Not instantiated'], ['Dependencies', this.graph.network.edges.filter(e => e.to === n.id).length], ['State', s?.error ? 'Error' : s?.data ? 'Cooked' : 'Not demanded']];
        for (const [a, b] of rows) {
            const el = document.createElement('div');
            el.className = 'info-row';
            el.innerHTML = `<span>${esc(a)}</span><strong>${esc(b)}</strong>`;
            this.body.append(el);
        }
        if (s?.error) {
            const e = document.createElement('p');
            e.className = 'error-text';
            e.textContent = s.error;
            this.body.append(e);
        }
        const p = document.createElement('p');
        p.className = 'description-note';
        p.textContent = def.description;
        this.body.append(p);
    }
    animation(n) {
        this.body.innerHTML = '<div class="param-section-title">Parameter tracks<span>seconds</span></div>';
        const entries = Object.entries(n.keyframes || {}).filter(([, keys]) => keys.length);
        if (!entries.length) {
            this.body.innerHTML += '<div class="inspector-empty">No keyframes yet.<br>Click ◇ beside a numeric parameter, move the playhead, change its value to automatically insert the next keyframe.</div>';
            return;
        }
        for (const [key, keys] of entries) {
            const track = document.createElement('div');
            track.className = 'animation-track';
            const title = document.createElement('h4');
            title.textContent = OPS[n.type].params[key]?.label || key;
            track.append(title);
            keys.forEach((k, index) => {
                const row = document.createElement('div');
                row.className = 'key-row';
                const jump = document.createElement('button');
                jump.textContent = `◆ ${k.time.toFixed(2)}s`;
                jump.onclick = () => this.actions.seek(k.time);
                const value = document.createElement('span');
                value.textContent = k.value.toFixed(3);
                const interpolation = document.createElement('select');
                interpolation.innerHTML = '<option value="linear">Linear</option><option value="smooth">Smooth</option><option value="step">Step</option>';
                interpolation.value = k.interpolation || 'linear';
                interpolation.onchange = () => this.graph.transact('Change interpolation', () => {
                    n.keyframes[key][index].interpolation = interpolation.value;
                });
                const remove = document.createElement('button');
                remove.textContent = '×';
                remove.title = 'Delete keyframe';
                remove.onclick = () => this.graph.transact('Delete keyframe', () => {
                    n.keyframes[key].splice(index, 1);
                });
                row.append(jump, value, interpolation, remove);
                track.append(row);
            });
            this.body.append(track);
        }
    }
    refresh() {
        const n = this.selected;
        if (!n || this.tab !== 'parameters')
            return;
        const values = this.values(n);
        for (const [key, e] of this.inputs)
            if ((n.keyframes[key]?.length || n.bindings[key]) && document.activeElement !== e.number && document.activeElement !== e.range) {
                e.range.value = values[key];
                e.number.value = Number(Number(values[key]).toFixed(4));
            }
    }
}
