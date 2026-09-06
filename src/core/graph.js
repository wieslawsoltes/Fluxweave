import { OPS, definition, defaults } from './operators.js';
export const SCHEMA_VERSION = 1;
let counter = 0;
export const uid = (prefix = 'n') => `${prefix}_${Date.now().toString(36)}_${(++counter).toString(36)}`;
const clone = v => structuredClone(v);
export function createNode(type, x = 0, y = 0, name = null) {
    if (!Object.hasOwn(OPS, type))
        throw new Error(`Unknown operator: ${type}`);
    return {
        id: uid(), type, name: name || `${type}1`, x, y, params: defaults(type), bindings: {}, keyframes: {}, bypass: false
    };
}
export function emptyProject() {
    return {
        format: 'fluxweave', version: SCHEMA_VERSION, name: 'Untitled network', nodes: [], edges: [], components: {}, assets: {}, settings: {
            width: 960, height: 540, fps: 60, duration: 20, loop: true
        }, view: { x: 50, y: 40, zoom: .8 }, output: null
    };
}
export class History {
    constructor(limit = 80) {
        this.limit = limit;
        this.undoStack = [];
        this.redoStack = [];
        this.last = null;
    }
    push(before, after, label, mergeKey = null) {
        if (JSON.stringify(before) === JSON.stringify(after))
            return;
        const now = Date.now();
        const prev = this.undoStack.at(-1);
        if (mergeKey && prev?.mergeKey === mergeKey && now - prev.time < 500) {
            prev.after = after;
            prev.time = now;
        }
        else {
            this.undoStack.push({
                before, after, label, mergeKey, time: now
            });
            if (this.undoStack.length > this.limit)
                this.undoStack.shift();
        }
        this.redoStack.length = 0;
    }
    undo() {
        const c = this.undoStack.pop();
        if (!c)
            return null;
        this.redoStack.push(c);
        return c.before;
    }
    redo() {
        const c = this.redoStack.pop();
        if (!c)
            return null;
        this.undoStack.push(c);
        return c.after;
    }
    clear() {
        this.undoStack.length = this.redoStack.length = 0;
    }
}
/** Dependency edges into a delay are excluded only from same-frame ordering. */
export function topological(nodes, edges, project) {
    const map = new Map(nodes.map(n => [n.id, n]));
    const adj = new Map(nodes.map(n => [n.id, []]));
    const degree = new Map(nodes.map(n => [n.id, 0]));
    const add = (from, to) => {
        if (!map.has(from) || !map.has(to))
            throw new Error('Connection references a missing operator');
        if (OPS[map.get(to).type]?.delay)
            return;
        adj.get(from).push(to);
        degree.set(to, degree.get(to) + 1);
    };
    for (const e of edges)
        add(e.from, e.to);
    for (const n of nodes)
        for (const b of Object.values(n.bindings || {}))
            add(b.node, n.id);
    const ready = nodes.filter(n => degree.get(n.id) === 0).map(n => n.id), result = [];
    for (let k = 0; k < ready.length; k++) {
        const id = ready[k];
        result.push(map.get(id));
        for (const next of adj.get(id)) {
            degree.set(next, degree.get(next) - 1);
            if (degree.get(next) === 0)
                ready.push(next);
        }
    }
    if (result.length !== nodes.length)
        throw new Error('This creates a same-frame cycle. Insert a Feedback operator to cross a frame boundary.');
    return result;
}
export function validateProject(data) {
    if (!data || data.format !== 'fluxweave' || data.version !== SCHEMA_VERSION)
        throw new Error('Not a supported Fluxweave project (schema 1).');
    if (!Array.isArray(data.nodes) || !Array.isArray(data.edges))
        throw new Error('Invalid network arrays.');
    if (data.nodes.length > 2000)
        throw new Error('Project exceeds the 2,000-operator safety limit.');
    const p = clone(data);
    p.name = String(p.name || 'Untitled network').slice(0, 120);
    p.components ||= {};
    p.assets ||= {};
    if (typeof p.components !== 'object' || Array.isArray(p.components) || typeof p.assets !== 'object' || Array.isArray(p.assets))
        throw new Error('Invalid component or asset table.');
    p.settings = { ...emptyProject().settings, ...p.settings };
    p.view ||= { x: 30, y: 30, zoom: 1 };
    for (const key of ['width', 'height']) {
        if (!Number.isInteger(p.settings[key]) || p.settings[key] < 64 || p.settings[key] > 4096)
            throw new Error('Resolution must be an integer from 64 to 4096.');
    }
    if (!Number.isFinite(p.settings.duration) || p.settings.duration < 1 || p.settings.duration > 3600)
        throw new Error('Duration must be between 1 and 3,600 seconds.');
    if (!Number.isFinite(p.settings.fps) || p.settings.fps < 1 || p.settings.fps > 240)
        throw new Error('Frame rate must be between 1 and 240.');
    p.settings.loop = !!p.settings.loop;
    const validateView = net => {
        const v = net.view ||= { x: 20, y: 20, zoom: .8 };
        if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.zoom) || v.zoom < .15 || v.zoom > 2.6)
            throw new Error('Invalid network viewport.');
    };
    validateView(p);
    let total = p.nodes.length;
    for (const [id, comp] of Object.entries(p.components)) {
        if (!comp || !Array.isArray(comp.nodes) || !Array.isArray(comp.edges) || !Array.isArray(comp.inputs))
            throw new Error('Invalid component definition.');
        if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(id) || comp.id !== id)
            throw new Error('Invalid component identifier.');
        comp.name = String(comp.name || 'Component').slice(0, 120);
        if (!['texture', 'geometry', 'signal'].includes(comp.outputType))
            throw new Error('Invalid component output type.');
        validateView(comp);
        total += comp.nodes.length;
    }
    if (total > 4000)
        throw new Error('Project exceeds the combined operator safety limit.');
    for (const net of [p, ...Object.values(p.components)]) {
        const ids = new Set();
        for (const n of net.nodes) {
            if (!n || typeof n.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(n.id) || !Object.hasOwn(OPS, n.type) || ids.has(n.id))
                throw new Error('Invalid or duplicate operator.');
            ids.add(n.id);
            if (n.type === 'component' && !p.components[n.componentId])
                throw new Error('Missing component definition.');
            if (!Number.isFinite(n.x) || !Number.isFinite(n.y))
                throw new Error('Invalid node position.');
            n.params = { ...defaults(n.type), ...n.params };
            n.bindings ||= {};
            n.keyframes ||= {};
            n.name = String(n.name || n.type).slice(0, 120);
            for (const [key, schema] of Object.entries(OPS[n.type].params)) {
                const v = n.params[key];
                if (schema.type === 'number') {
                    if (typeof v !== 'number' || !Number.isFinite(v))
                        throw new Error(`Invalid numeric parameter: ${n.name}.${key}`);
                    n.params[key] = Math.min(schema.max, Math.max(schema.min, v));
                }
                if (schema.type === 'color' && !/^#[\da-f]{6}$/i.test(v))
                    throw new Error('Invalid color parameter.');
                if (schema.type === 'select' && !schema.options.includes(v))
                    throw new Error(`Invalid option: ${key}`);
                if (schema.type === 'code' && (typeof v !== 'string' || v.length > 100000))
                    throw new Error('Invalid shader source.');
            }
            for (const [key, keys] of Object.entries(n.keyframes)) {
                if (OPS[n.type].params[key]?.type !== 'number')
                    throw new Error('Only numeric parameters can have animation tracks.');
                if (!Array.isArray(keys) || keys.length > 10000)
                    throw new Error('Invalid keyframe track.');
                for (const k of keys)
                    if (!Number.isFinite(k.time) || !Number.isFinite(k.value))
                        throw new Error('Invalid keyframe.');
                keys.sort((a, b) => a.time - b.time);
            }
        }
        const targets = new Set(), edgeIds = new Set();
        for (const e of net.edges) {
            if (typeof e.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(e.id) || !Number.isInteger(e.input))
                throw new Error('Invalid connection identifier or input index.');
            if (edgeIds.has(e.id))
                throw new Error('Duplicate connection identifier.');
            edgeIds.add(e.id);
            const a = net.nodes.find(n => n.id === e.from), b = net.nodes.find(n => n.id === e.to);
            if (!a || !b)
                throw new Error('Dangling connection.');
            const input = definition(b, p).inputs[e.input];
            if (!input || input.type !== definition(a, p).output)
                throw new Error('Port type mismatch.');
            const target = `${e.to}:${e.input}`;
            if (targets.has(target))
                throw new Error('Multiple sources connected to one input.');
            targets.add(target);
        }
        for (const n of net.nodes)
            for (const [key, binding] of Object.entries(n.bindings)) {
                if (OPS[n.type].params[key]?.type !== 'number')
                    throw new Error('Only numeric parameters can be channel-bound.');
                if (!net.nodes.some(m => m.id === binding.node && definition(m, p).output === 'signal'))
                    throw new Error('Missing signal binding.');
                for (const key of ['scale', 'offset'])
                    if (binding[key] !== undefined && !Number.isFinite(binding[key]))
                        throw new Error('Invalid binding scale or offset.');
            }
        topological(net.nodes, net.edges, p);
    }
    for (const [id, a] of Object.entries(p.assets)) {
        if (typeof a?.data !== 'string' || !/^data:(image|video|audio)\/[\w.+-]+;base64,/.test(a.data) || a.data.length > 90000000)
            throw new Error(`Invalid media asset ${id}.`);
    }
    if (p.output && !p.nodes.some(n => n.id === p.output))
        p.output = null;
    for (const comp of Object.values(p.components)) {
        const output = comp.nodes.find(n => n.id === comp.output);
        if (!output || definition(output, p).output !== comp.outputType)
            throw new Error('Component output type does not match its endpoint.');
        for (const port of comp.inputs) {
            const target = comp.nodes.find(n => n.id === port.target);
            if (!target || definition(target, p).inputs[port.input]?.type !== port.type)
                throw new Error('Component input type does not match its endpoint.');
            port.name = String(port.name || 'Input').slice(0, 80);
        }
    }
    if (p.output && definition(p.nodes.find(n => n.id === p.output), p).output !== 'texture')
        throw new Error('The project output must be a texture.');
    flattenProject(p); // validates recursive component references and expanded cycles
    return p;
}
export class Graph extends EventTarget {
    constructor(project = emptyProject()) {
        super();
        this.project = validateProject(project);
        this.history = new History();
        this.active = null;
        this.selection = new Set();
        this.serial = 0;
    }
    get network() {
        return this.active ? this.project.components[this.active] || this.project : this.project;
    }
    snapshot() {
        const { assets, ...p } = this.project;
        return clone(p);
    }
    restore(s) {
        const assets = this.project.assets;
        this.project = { ...clone(s), assets };
        if (this.active && !this.project.components[this.active])
            this.active = null;
        this.selection.clear();
        this.emit('structure');
    }
    emit(kind = 'structure', detail = {}) {
        this.serial++;
        this.dispatchEvent(new CustomEvent('change', { detail: { kind, ...detail } }));
    }
    transact(label, action, mergeKey = null, kind = 'structure') {
        const before = this.snapshot();
        try {
            action();
            if (kind === 'structure')
                flattenProject(this.project);
            this.history.push(before, this.snapshot(), label, mergeKey);
            this.emit(kind);
        }
        catch (e) {
            this.project = { ...before, assets: this.project.assets };
            throw e;
        }
    }
    setProject(p) {
        this.project = validateProject(p);
        this.active = null;
        this.selection.clear();
        this.history.clear();
        this.emit('load');
    }
    select(ids) {
        this.selection = new Set(ids);
        this.dispatchEvent(new CustomEvent('select'));
    }
    node(id) {
        return this.network.nodes.find(n => n.id === id);
    }
    add(type, x, y, componentId = null) {
        let node;
        this.transact(`Add ${type}`, () => {
            node = createNode(type, x, y);
            if (componentId)
                node.componentId = componentId;
            const base = componentId ? this.project.components[componentId].name.toLowerCase().replace(/\W+/g, '_') : type;
            let i = 1;
            while (this.network.nodes.some(n => n.name === `${base}${i}`))
                i++;
            node.name = `${base}${i}`;
            this.network.nodes.push(node);
        });
        this.select([node.id]);
        return node;
    }
    connect(from, to, input) {
        const a = this.node(from), b = this.node(to);
        if (!a || !b)
            throw new Error('Missing operator.');
        const d = definition(b, this.project);
        if (d.inputs[input]?.type !== definition(a, this.project).output)
            throw new Error(`Port mismatch: ${definition(a, this.project).output} cannot connect to ${d.inputs[input]?.type || 'this input'}.`);
        this.transact('Connect operators', () => {
            const net = this.network;
            net.edges = net.edges.filter(e => !(e.to === to && e.input === input));
            net.edges.push({
                id: uid('e'), from, to, input
            });
            topological(net.nodes, net.edges, this.project);
            flattenProject(this.project);
        });
    }
    disconnect(edgeId) {
        this.transact('Disconnect', () => {
            this.network.edges = this.network.edges.filter(e => e.id !== edgeId);
        });
    }
    update(id, key, value, group = 'params') {
        this.transact(`Change ${key}`, () => {
            const n = this.node(id);
            if (!n)
                return;
            if (group)
                n[group][key] = value;
            else
                n[key] = value;
        }, `${this.active}:${id}:${group}:${key}`, group === 'params' ? 'parameter' : 'structure');
    }
    bind(id, param, node, scale = 1, offset = 0) {
        this.transact('Bind signal', () => {
            const n = this.node(id);
            if (node)
                n.bindings[param] = { node, scale, offset };
            else
                delete n.bindings[param];
            topological(this.network.nodes, this.network.edges, this.project);
        });
    }
    keyframe(id, param, time, value, interpolation = 'smooth') {
        this.transact('Keyframe parameter', () => {
            const n = this.node(id);
            const keys = n.keyframes[param] ||= [];
            const i = keys.findIndex(k => Math.abs(k.time - time) < .0001);
            if (i >= 0)
                keys.splice(i, 1);
            else
                keys.push({ time, value, interpolation });
            keys.sort((a, b) => a.time - b.time);
        });
    }
    deleteSelected() {
        const ids = new Set(this.selection);
        if (!ids.size)
            return;
        this.transact('Delete operators', () => {
            const net = this.network;
            net.nodes = net.nodes.filter(n => !ids.has(n.id));
            net.edges = net.edges.filter(e => !ids.has(e.from) && !ids.has(e.to));
            for (const n of net.nodes)
                for (const [k, b] of Object.entries(n.bindings))
                    if (ids.has(b.node))
                        delete n.bindings[k];
            if (ids.has(net.output))
                net.output = net.nodes.filter(n => definition(n, this.project).output === 'texture').at(-1)?.id || null;
        });
        this.select([]);
    }
    duplicate() {
        const ids = new Set(this.selection), created = [];
        this.transact('Duplicate operators', () => {
            const map = new Map();
            for (const n of [...this.network.nodes])
                if (ids.has(n.id)) {
                    const copy = clone(n);
                    copy.id = uid();
                    copy.name += '_copy';
                    copy.x += 36;
                    copy.y += 36;
                    map.set(n.id, copy.id);
                    created.push(copy);
                }
            for (const n of created)
                for (const b of Object.values(n.bindings))
                    if (map.has(b.node))
                        b.node = map.get(b.node);
            const edges = this.network.edges.filter(e => ids.has(e.from) && ids.has(e.to)).map(e => ({
                ...e, id: uid('e'), from: map.get(e.from), to: map.get(e.to)
            }));
            this.network.nodes.push(...created);
            this.network.edges.push(...edges);
        });
        this.select(created.map(n => n.id));
    }
    groupSelection(name = 'Component') {
        const ids = new Set(this.selection);
        if (!ids.size)
            throw new Error('Select operators to group.');
        let instance;
        this.transact('Create reusable component', () => {
            const net = this.network, inside = net.nodes.filter(n => ids.has(n.id));
            if (inside.some(n => n.type === 'component' && n.componentId === this.active))
                throw new Error('Recursive component.');
            const incoming = net.edges.filter(e => !ids.has(e.from) && ids.has(e.to));
            const outgoing = net.edges.filter(e => ids.has(e.from) && !ids.has(e.to));
            const outIds = new Set(outgoing.map(e => e.from));
            if (net.output && ids.has(net.output))
                outIds.add(net.output);
            if (outIds.size > 1)
                throw new Error('A component currently exposes one output. Select a network with one outgoing operator.');
            for (const n of net.nodes)
                for (const b of Object.values(n.bindings))
                    if (ids.has(n.id) !== ids.has(b.node))
                        throw new Error('Move external channel bindings inside the selection or use typed signal input wires before grouping.');
            const output = outIds.values().next().value || topological(inside, net.edges.filter(e => ids.has(e.from) && ids.has(e.to)), this.project).at(-1).id;
            const compId = uid('comp'), x = Math.min(...inside.map(n => n.x)), y = Math.min(...inside.map(n => n.y));
            const inputs = incoming.map((e, i) => ({
                name: `${this.node(e.to).name} / ${definition(this.node(e.to), this.project).inputs[e.input].name}`, type: definition(this.node(e.from), this.project).output, target: e.to, input: e.input
            }));
            const comp = {
                id: compId, name: String(name).slice(0, 60), nodes: clone(inside).map(n => ({ ...n, x: n.x - x + 60, y: n.y - y + 60 })), edges: clone(net.edges.filter(e => ids.has(e.from) && ids.has(e.to))), inputs, output, outputType: definition(this.node(output), this.project).output, view: { x: 20, y: 20, zoom: .8 }
            };
            this.project.components[compId] = comp;
            instance = createNode('component', x, y, name);
            instance.componentId = compId;
            net.nodes = net.nodes.filter(n => !ids.has(n.id));
            net.nodes.push(instance);
            net.edges = net.edges.filter(e => !ids.has(e.from) && !ids.has(e.to));
            incoming.forEach((e, i) => net.edges.push({ ...e, to: instance.id, input: i }));
            outgoing.forEach(e => net.edges.push({ ...e, from: instance.id }));
            if (ids.has(net.output))
                net.output = instance.id;
            flattenProject(this.project);
        });
        this.select([instance.id]);
        return instance;
    }
    undo() {
        const s = this.history.undo();
        if (s)
            this.restore(s);
    }
    redo() {
        const s = this.history.redo();
        if (s)
            this.restore(s);
    }
    enter(componentId) {
        this.active = componentId;
        this.select([]);
        this.dispatchEvent(new CustomEvent('navigate'));
    }
}
/** Expand component instances into independent runtime IDs; shared definitions, isolated GPU state. */
export function flattenProject(project) {
    const nodes = [], edges = [], metadata = new Map();
    let expansions = 0;
    function expand(net, prefix = '', stack = []) {
        const endpoints = new Map();
        const inputTargets = new Map();
        for (const n of net.nodes) {
            if (++expansions > 8000)
                throw new Error('Expanded project exceeds 8,000 operators.');
            if (n.type === 'component') {
                if (stack.includes(n.componentId))
                    throw new Error('Recursive components are not allowed.');
                const comp = project.components[n.componentId];
                if (!comp)
                    throw new Error('Missing component definition.');
                const sub = expand(comp, `${prefix}${n.id}::`, [...stack, n.componentId]);
                const output = sub.endpoints.get(comp.output);
                if (!output)
                    throw new Error('Component has no valid output.');
                endpoints.set(n.id, output);
                const targets = comp.inputs.map(port => {
                    const ts = sub.inputTargets.get(port.target);
                    const target = ts?.[port.input];
                    if (!target)
                        throw new Error('A component input endpoint was removed.');
                    return target;
                });
                inputTargets.set(n.id, targets);
            }
            else {
                const runtime = {
                    ...n, id: prefix + n.id, originalId: n.id, componentScope: stack.at(-1) || null, bindings: clone(n.bindings || {})
                };
                nodes.push(runtime);
                metadata.set(runtime.id, { originalId: n.id, scope: stack.at(-1) || null, prefix });
                endpoints.set(n.id, runtime.id);
                inputTargets.set(n.id, definition(n, project).inputs.map((_, input) => ({ to: runtime.id, input })));
            }
        }
        for (const e of net.edges) {
            const target = inputTargets.get(e.to)?.[e.input];
            if (!target)
                throw new Error('Invalid component input.');
            edges.push({
                ...e, id: prefix + e.id, from: endpoints.get(e.from), ...target
            });
        }
        for (const n of net.nodes)
            if (n.type !== 'component') {
                const runtime = nodes.find(r => r.id === prefix + n.id);
                for (const b of Object.values(runtime.bindings))
                    b.node = endpoints.get(b.node);
            }
        return { endpoints, inputTargets };
    }
    const root = expand(project);
    const runtimeById = new Map(nodes.map(n => [n.id, n]));
    for (const e of edges) {
        const a = runtimeById.get(e.from), b = runtimeById.get(e.to);
        if (!a || !b || OPS[a.type].output !== OPS[b.type].inputs[e.input]?.type)
            throw new Error('Expanded connection has a port type mismatch.');
    }
    const order = topological(nodes, edges, project);
    return {
        nodes, edges, order, metadata, rootOutputs: root.endpoints, output: root.endpoints.get(project.output) || null
    };
}
