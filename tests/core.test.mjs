import test from 'node:test';
import assert from 'node:assert/strict';
import { Graph, History, createNode, emptyProject, flattenProject, validateProject, topological } from '../src/core/graph.js';
import { OPS, defaults, evaluateKeyframes, parameterValues, signalValue, definition } from '../src/core/operators.js';
import { PRESETS } from '../src/core/presets.js';
import { createGeometry, identity, multiply, perspective, transformMatrix } from '../src/core/math.js';
for (const [name, build] of Object.entries(PRESETS))
    test(`preset ${name}: validates and schedules`, () => {
        const p = validateProject(build()), flat = flattenProject(p);
        assert.equal(flat.nodes.length, p.nodes.length);
        assert.equal(flat.order.length, p.nodes.length);
        assert.ok(flat.output);
        const positions = new Map(flat.order.map((n, i) => [n.id, i]));
        for (const e of flat.edges)
            if (!OPS[flat.nodes.find(n => n.id === e.to).type].delay)
                assert.ok(positions.get(e.from) < positions.get(e.to));
    });
test('operator schemas have complete defaults and well-typed ports', () => {
    for (const [type, op] of Object.entries(OPS)) {
        assert.ok(['texture', 'signal', 'geometry'].includes(op.output));
        for (const p of op.inputs)
            assert.ok(['texture', 'signal', 'geometry'].includes(p.type));
        for (const [key, schema] of Object.entries(op.params))
            assert.deepEqual(defaults(type)[key], schema.value);
    }
});
test('typed ports reject mismatched signals and textures atomically', () => {
    const g = new Graph();
    const a = g.add('value', 0, 0), b = g.add('blur', 250, 0);
    assert.throws(() => g.connect(a.id, b.id, 0), /mismatch/);
    assert.equal(g.project.edges.length, 0);
});
test('a same-frame cycle is rejected without changing the graph', () => {
    const g = new Graph();
    const a = g.add('blur', 0, 0), b = g.add('level', 250, 0);
    g.connect(a.id, b.id, 0);
    assert.throws(() => g.connect(b.id, a.id, 0), /cycle/);
    assert.equal(g.project.edges.length, 1);
});
test('feedback permits cyclic graphs with a frame boundary', () => {
    const g = new Graph();
    const a = g.add('composite', 0, 0), b = g.add('feedback', 250, 0);
    g.connect(a.id, b.id, 0);
    g.connect(b.id, a.id, 1);
    assert.equal(g.project.edges.length, 2);
    assert.equal(flattenProject(g.project).order[0].type, 'feedback');
});
test('rewiring one input replaces its prior connection', () => {
    const g = new Graph();
    const a = g.add('noise', 0, 0), b = g.add('constant', 0, 200), c = g.add('blur', 300, 0);
    g.connect(a.id, c.id, 0);
    g.connect(b.id, c.id, 0);
    assert.equal(g.project.edges.length, 1);
    assert.equal(g.project.edges[0].from, b.id);
});
test('parameter changes undo and redo', () => {
    const g = new Graph();
    const a = g.add('noise', 0, 0);
    g.update(a.id, 'scale', 7);
    assert.equal(g.node(a.id).params.scale, 7);
    g.undo();
    assert.equal(g.node(a.id).params.scale, defaults('noise').scale);
    g.redo();
    assert.equal(g.node(a.id).params.scale, 7);
});
test('deleting removes dependent wires and bindings', () => {
    const g = new Graph();
    const a = g.add('lfo', 0, 0), b = g.add('noise', 250, 0);
    g.connect(a.id, b.id, 0);
    g.bind(b.id, 'scale', a.id, 2, 3);
    g.select([a.id]);
    g.deleteSelected();
    assert.equal(g.project.edges.length, 0);
    assert.equal(Object.keys(g.node(b.id).bindings).length, 0);
    g.undo();
    assert.equal(g.project.edges.length, 1);
});
test('bindings participate in cycle detection', () => {
    const g = new Graph();
    const a = g.add('math', 0, 0), b = g.add('math', 300, 0);
    g.bind(a.id, 'scale', b.id);
    assert.throws(() => g.bind(b.id, 'scale', a.id), /cycle/);
    assert.equal(Object.keys(g.node(b.id).bindings).length, 0);
});
test('keyframe interpolation is linear, stepped, and smooth', () => {
    assert.equal(evaluateKeyframes([{ time: 0, value: 0 }, { time: 2, value: 10 }], 1, 3), 5);
    assert.equal(evaluateKeyframes([{ time: 0, value: 0, interpolation: 'step' }, { time: 2, value: 10 }], 1, 3), 0);
    assert.equal(evaluateKeyframes([{ time: 0, value: 0, interpolation: 'smooth' }, { time: 2, value: 10 }], .5, 3), 1.5625);
    assert.equal(evaluateKeyframes([], 1, 3), 3);
});
test('keyframes clamp to endpoint values', () => {
    const keys = [{ time: 2, value: 4 }, { time: 8, value: 9 }];
    assert.equal(evaluateKeyframes(keys, 0, 0), 4);
    assert.equal(evaluateKeyframes(keys, 10, 0), 9);
});
test('bindings override keyframes with gain and offset', () => {
    const n = createNode('noise');
    n.keyframes.scale = [{ time: 0, value: 1 }, { time: 1, value: 5 }];
    n.bindings.scale = { node: 'x', scale: 2, offset: 1 };
    assert.equal(parameterValues(n, .5, () => 3).scale, 7);
});
test('LFO waveforms are bounded and periodic', () => {
    for (const wave of ['sine', 'triangle', 'saw', 'square'])
        for (let i = -100; i < 100; i++) {
            const t = i / 17;
            assert.ok(Math.abs(signalValue(wave, t)) <= 1.000001);
            assert.ok(Math.abs(signalValue(wave, t) - signalValue(wave, t + 2)) < 1e-10);
        }
});
test('duplicate selection remaps internal wires and channel bindings', () => {
    const g = new Graph();
    const a = g.add('lfo', 0, 0), b = g.add('noise', 250, 0);
    g.connect(a.id, b.id, 0);
    g.bind(b.id, 'scale', a.id);
    g.select([a.id, b.id]);
    g.duplicate();
    assert.equal(g.project.nodes.length, 4);
    const copies = [...g.selection].map(id => g.node(id));
    const l = copies.find(n => n.type === 'lfo'), n = copies.find(n => n.type === 'noise');
    assert.equal(n.bindings.scale.node, l.id);
    assert.ok(g.project.edges.some(e => e.from === l.id && e.to === n.id));
});
test('grouping creates a typed reusable component', () => {
    const g = new Graph();
    const a = g.add('noise', 0, 0), b = g.add('blur', 250, 0), c = g.add('level', 500, 0), out = g.add('output', 750, 0);
    g.connect(a.id, b.id, 0);
    g.connect(b.id, c.id, 0);
    g.connect(c.id, out.id, 0);
    g.project.output = out.id;
    g.select([b.id, c.id]);
    const instance = g.groupSelection('Post');
    const comp = g.project.components[instance.componentId];
    assert.equal(comp.nodes.length, 2);
    assert.equal(comp.inputs.length, 1);
    assert.equal(definition(instance, g.project).inputs[0].type, 'texture');
    assert.equal(flattenProject(g.project).nodes.length, 4);
    assert.equal(g.project.nodes.length, 3);
});
test('component instances have independent runtime node IDs', () => {
    const g = new Graph();
    const a = g.add('noise', 0, 0), b = g.add('blur', 250, 0);
    g.connect(a.id, b.id, 0);
    g.project.output = b.id;
    g.select([a.id, b.id]);
    const instance = g.groupSelection('Generator');
    g.add('component', 400, 0, instance.componentId);
    const flat = flattenProject(g.project);
    assert.equal(flat.nodes.length, 4);
    assert.equal(new Set(flat.nodes.map(n => n.id)).size, 4);
    assert.equal(flat.nodes.filter(n => n.originalId === a.id).length, 2);
});
test('shared definitions propagate to all instances', () => {
    const g = new Graph();
    const a = g.add('constant', 0, 0);
    g.project.output = a.id;
    g.select([a.id]);
    const instance = g.groupSelection('Color');
    g.add('component', 250, 0, instance.componentId);
    g.enter(instance.componentId);
    g.update(a.id, 'color', '#abcdef');
    assert.ok(flattenProject(g.project).nodes.every(n => n.params.color === '#abcdef'));
});
test('components reject multiple externally visible outputs', () => {
    const g = new Graph();
    const a = g.add('noise', 0, 0), b = g.add('ramp', 0, 200), c = g.add('composite', 300, 0);
    g.connect(a.id, c.id, 0);
    g.connect(b.id, c.id, 1);
    g.select([a.id, b.id]);
    assert.throws(() => g.groupSelection('Bad'), /one output/);
    assert.equal(g.project.nodes.length, 3);
});
test('schema rejects invalid versions, duplicate IDs and dangling edges', () => {
    const p = PRESETS.geometry();
    assert.throws(() => validateProject({ ...p, version: 99 }), /supported/);
    const duplicate = structuredClone(p);
    duplicate.nodes.push(duplicate.nodes[0]);
    assert.throws(() => validateProject(duplicate), /duplicate/);
    const dangling = structuredClone(p);
    dangling.edges[0].from = 'missing';
    assert.throws(() => validateProject(dangling), /Dangling/);
});
test('schema validates and limits dangerous resolutions and numbers', () => {
    const p = PRESETS.chroma();
    p.settings.width = 100000;
    assert.throws(() => validateProject(p), /Resolution/);
    const q = PRESETS.chroma();
    q.nodes[0].params.scale = NaN;
    assert.throws(() => validateProject(q), /numeric/);
});
test('history retains embedded assets without cloning them into each edit', () => {
    const g = new Graph();
    g.project.assets.test = { name: 'test', data: 'data:image/png;base64,AAAA' };
    const n = g.add('constant', 0, 0);
    g.update(n.id, 'color', '#ff0000');
    assert.equal(g.history.undoStack.at(-1).before.assets, undefined);
    g.undo();
    assert.ok(g.project.assets.test);
});
test('history merges continuous parameter edits and clears redo on branching', () => {
    const h = new History();
    h.push({ x: 0 }, { x: 1 }, 'x', 'x');
    h.push({ x: 1 }, { x: 2 }, 'x', 'x');
    assert.equal(h.undoStack.length, 1);
    assert.deepEqual(h.undo(), { x: 0 });
    assert.deepEqual(h.redo(), { x: 2 });
    h.undo();
    h.push({ x: 0 }, { x: 9 }, 'new');
    assert.equal(h.redoStack.length, 0);
});
for (const type of ['torus', 'sphere', 'box', 'grid'])
    test(`${type}: finite indexed geometry with normalized normals`, () => {
        const g = createGeometry(type, defaults(type));
        assert.ok(g.vertices.length > 0);
        assert.equal(g.vertices.length % 8, 0);
        assert.equal(g.indices.length % 3, 0);
        for (const index of g.indices)
            assert.ok(index < g.vertices.length / 8);
        for (let i = 0; i < g.vertices.length; i += 8) {
            for (let j = 0; j < 8; j++)
                assert.ok(Number.isFinite(g.vertices[i + j]));
            assert.ok(Math.abs(Math.hypot(g.vertices[i + 3], g.vertices[i + 4], g.vertices[i + 5]) - 1) < 1e-5);
        }
    });
test('matrix multiplication preserves identity and WebGPU zero-to-one projection', () => {
    const m = transformMatrix({ ...defaults('geoTransform'), spin: 0 }, 0);
    assert.deepEqual(multiply(identity(), m), m);
    const near = .1, far = 100, p = perspective(Math.PI / 3, 16 / 9, near, far);
    const project = z => (p[10] * z + p[14]) / (-z);
    assert.ok(Math.abs(project(-near)) < 1e-6);
    assert.ok(Math.abs(project(-far) - 1) < 1e-6);
});
test('project JSON round-trip preserves complete graph semantics', () => {
    const p = PRESETS.chroma();
    p.nodes[0].keyframes.scale = [{ time: 0, value: 1 }, { time: 3, value: 4, interpolation: 'smooth' }];
    const q = validateProject(JSON.parse(JSON.stringify(p)));
    assert.deepEqual(q, p);
});
test('a stepped track switches at the exact next keyframe', () => {
    assert.equal(evaluateKeyframes([{ time: 0, value: 1, interpolation: 'step' }, { time: 2, value: 7 }], 2, 0), 7);
});
test('evaluated numeric parameters are bounded for GPU safety', () => {
    const n = createNode('particles');
    n.bindings.count = { node: 'x', scale: 1, offset: 0 };
    assert.equal(parameterValues(n, 0, () => -100).count, 1024);
});
test('invalid structural edits roll back before notifying renderers', () => {
    const g = new Graph();
    const a = g.add('constant', 0, 0);
    g.project.output = a.id;
    g.select([a.id]);
    const instance = g.groupSelection('A');
    g.enter(instance.componentId);
    g.select([a.id]);
    assert.throws(() => g.deleteSelected(), /output/);
    assert.equal(g.network.nodes.length, 1);
});
test('import rejects unsafe DOM identifiers and inherited operator names', () => {
    const p = PRESETS.chroma();
    p.nodes[0].id = '\" onclick=\"alert(1)';
    assert.throws(() => validateProject(p), /Invalid/);
    assert.throws(() => createNode('constructor'), /Unknown/);
});
import { TexturePool } from '../src/gpu/pool.js';
const fakeGPU = { createTexture() {
        return { destroyed: false, createView() {
                return {};
            }, destroy() {
                this.destroyed = true;
            } };
    } };
globalThis.GPUTextureUsage ||= {
    TEXTURE_BINDING: 4, RENDER_ATTACHMENT: 16, COPY_SRC: 1, COPY_DST: 2
};
test('texture pool reuses only released resources', () => {
    const p = new TexturePool(fakeGPU);
    const a = p.acquire(64, 64), b = p.acquire(64, 64);
    assert.notEqual(a, b);
    p.release(a);
    assert.equal(p.acquire(64, 64), a);
    assert.equal(p.stats().hits, 1);
    p.dispose();
    assert.equal(p.bytes, 0);
});
test('texture pool evicts cached allocations before rejecting live budget exhaustion', () => {
    const p = new TexturePool(fakeGPU, 64 * 64 * 4);
    const a = p.acquire(64, 64);
    assert.throws(() => p.acquire(64, 64), /budget/);
    p.release(a);
    const b = p.acquire(32, 32);
    assert.ok(a.texture.destroyed);
    assert.equal(p.bytes, b.bytes);
    p.dispose();
});
test('import normalizes project names and rejects invalid viewport transforms', () => {
    const p = emptyProject();
    delete p.name;
    assert.equal(validateProject(p).name, 'Untitled network');
    p.view.zoom = NaN;
    assert.throws(() => validateProject(p), /viewport/);
});
test('import rejects component interfaces that lie about endpoint types', () => {
    const g = new Graph();
    const a = g.add('blur', 0, 0), b = g.add('level', 200, 0);
    g.connect(a.id, b.id, 0);
    g.project.output = b.id;
    g.select([b.id]);
    const c = g.groupSelection('Group');
    const p = structuredClone(g.project);
    p.components[c.componentId].inputs[0].type = 'signal';
    assert.throws(() => validateProject(p), /mismatch|endpoint/);
});
test('import rejects duplicate edge identifiers', () => {
    const p = PRESETS.chroma();
    p.edges[1].id = p.edges[0].id;
    assert.throws(() => validateProject(p), /Duplicate connection/);
});
