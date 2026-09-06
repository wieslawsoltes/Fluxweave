import { flattenProject } from '../core/graph.js';
import { OPS, parameterValues, signalValue, defaults } from '../core/operators.js';
import { createGeometry, hexColor, identity, lookAt, multiply, perspective, transformMatrix } from '../core/math.js';
import { TexturePool } from './pool.js';
import { COMMON, FRAGMENT_ENTRY, EFFECTS, PRESENT, MESH, PARTICLE_COMPUTE, PARTICLE_RENDER } from './shaders.js';
const CLEAR = {
    r: .012, g: .015, b: .023, a: 1
};
export class Engine extends EventTarget {
    constructor(media) {
        super();
        this.media = media;
        this.ready = false;
        this.states = new Map();
        this.views = new Map();
        this.watch = new Set();
        this.shaderCache = new Map();
        this.pendingShaders = new Map();
        this.shaderQueue = Promise.resolve();
        this.meshBuffers = new Map();
        this.frameNumber = 0;
        this.inFlight = 0;
        this.revision = 0;
        this.lastTime = NaN;
        this.stats = {
            passes: 0, compute: 0, cooked: 0, cached: 0, cpuMs: 0, particles: 0
        };
        this.logs = [];
        this.viewerId = null;
    }
    log(message, level = 'info') {
        this.logs.unshift({ time: new Date().toLocaleTimeString(), message, level });
        this.logs.length = Math.min(100, this.logs.length);
        this.dispatchEvent(new CustomEvent('log', { detail: { message, level } }));
    }
    async init() {
        if (!navigator.gpu)
            throw new Error('WebGPU is not available. Use a WebGPU-enabled browser over HTTPS or localhost. The graph editor is still usable.');
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (!adapter)
            throw new Error('No WebGPU adapter is available. Enable hardware acceleration or use another WebGPU-capable browser.');
        this.device = await adapter.requestDevice();
        const d = this.device;
        this.adapterInfo = adapter.info;
        this.format = navigator.gpu.getPreferredCanvasFormat();
        d.addEventListener('uncapturederror', e => this.log(e.error.message, 'error'));
        d.lost.then(info => {
            this.ready = false;
            this.log(`GPU device lost: ${info.message || info.reason}. Reload to rebuild GPU resources.`, 'error');
            this.dispatchEvent(new Event('lost'));
        });
        this.pool = new TexturePool(d);
        this.sampler = d.createSampler({
            magFilter: 'linear', minFilter: 'linear', addressModeU: 'mirror-repeat', addressModeV: 'mirror-repeat'
        });
        this.clampSampler = d.createSampler({ magFilter: 'linear', minFilter: 'linear' });
        this.effectLayout = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }, { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }, { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }, { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }] });
        this.effectPipelineLayout = d.createPipelineLayout({ bindGroupLayouts: [this.effectLayout] });
        this.pipelines = {};
        for (const [name, code] of Object.entries(EFFECTS)) {
            const module = await this.checkedModule(COMMON + code + FRAGMENT_ENTRY, name);
            this.pipelines[name] = await d.createRenderPipelineAsync({
                label: `TOP ${name}`, layout: this.effectPipelineLayout, vertex: { module, entryPoint: 'fullscreen' }, fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: 'rgba8unorm' }] }, primitive: { topology: 'triangle-list' }
            });
        }
        const present = await this.checkedModule(PRESENT, 'present');
        this.presentPipeline = await d.createRenderPipelineAsync({
            layout: 'auto', vertex: { module: present, entryPoint: 'vs' }, fragment: { module: present, entryPoint: 'fs', targets: [{ format: this.format }] }, primitive: { topology: 'triangle-list' }
        });
        const mesh = await this.checkedModule(MESH, 'mesh');
        this.meshPipeline = await d.createRenderPipelineAsync({
            layout: 'auto', vertex: { module: mesh, entryPoint: 'vs', buffers: [{ arrayStride: 32, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }, { shaderLocation: 2, offset: 24, format: 'float32x2' }] }] }, fragment: { module: mesh, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] }, primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' }
        });
        const compute = await this.checkedModule(PARTICLE_COMPUTE, 'particle compute');
        this.computePipeline = await d.createComputePipelineAsync({ layout: 'auto', compute: { module: compute, entryPoint: 'update' } });
        const particle = await this.checkedModule(PARTICLE_RENDER, 'particle render');
        this.particlePipeline = await d.createRenderPipelineAsync({
            layout: 'auto', vertex: { module: particle, entryPoint: 'vs' }, fragment: { module: particle, entryPoint: 'fs', targets: [{ format: 'rgba8unorm', blend: { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }] }, primitive: { topology: 'triangle-list' }
        });
        this.black = this.pool.acquire(1, 1);
        d.queue.writeTexture({ texture: this.black.texture }, new Uint8Array([0, 0, 0, 255]), { bytesPerRow: 4 }, [1, 1]);
        this.ready = true;
        this.log('WebGPU render and compute pipelines initialized.');
        return this;
    }
    async checkedModule(code, label) {
        this.device.pushErrorScope('validation');
        let module;
        let messages = [];
        let scope;
        try {
            module = this.device.createShaderModule({ label, code });
            messages = (await module.getCompilationInfo()).messages;
        }
        finally {
            scope = await this.device.popErrorScope();
        }
        const errors = messages.filter(m => m.type === 'error');
        if (errors.length || scope)
            throw new Error(`${label}: ${errors.map(m => `line ${m.lineNum}: ${m.message}`).join('\n') || scope.message}`);
        return module;
    }
    async compileShader(code) {
        if (this.shaderCache.has(code))
            return { pipeline: this.shaderCache.get(code), messages: [] };
        if (this.pendingShaders.has(code))
            return this.pendingShaders.get(code);
        const task = this.shaderQueue.then(async () => {
            const source = COMMON + code + FRAGMENT_ENTRY, offset = COMMON.split('\n').length - 1;
            this.device.pushErrorScope('validation');
            let module, info, scope;
            try {
                module = this.device.createShaderModule({ label: 'User WGSL', code: source });
                info = await module.getCompilationInfo();
            }
            finally {
                scope = await this.device.popErrorScope();
            }
            const messages = info.messages.map(m => ({
                type: m.type, line: Math.max(1, m.lineNum - offset), column: m.linePos, message: m.message
            }));
            if (messages.some(m => m.type === 'error') || scope)
                return { pipeline: null, messages: messages.length ? messages : [{
                            type: 'error', line: 1, column: 1, message: scope.message
                        }] };
            try {
                const pipeline = await this.device.createRenderPipelineAsync({
                    label: 'User WGSL', layout: this.effectPipelineLayout, vertex: { module, entryPoint: 'fullscreen' }, fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: 'rgba8unorm' }] }, primitive: { topology: 'triangle-list' }
                });
                this.shaderCache.set(code, pipeline);
                if (this.shaderCache.size > 32)
                    this.shaderCache.delete(this.shaderCache.keys().next().value);
                return { pipeline, messages };
            }
            catch (e) {
                return { pipeline: null, messages: [{
                            type: 'error', line: 1, column: 1, message: e.message
                        }] };
            }
        });
        this.pendingShaders.set(code, task);
        this.shaderQueue = task.catch(() => {
        });
        task.finally(() => this.pendingShaders.delete(code));
        return task;
    }
    setGraph(project) {
        this.project = project;
        this.compiled = flattenProject(project);
        this.inputEdges = new Map();
        for (const e of this.compiled.edges) {
            const a = this.inputEdges.get(e.to) || [];
            a[e.input] = e.from;
            this.inputEdges.set(e.to, a);
        }
        const ids = new Set(this.compiled.nodes.map(n => n.id));
        for (const [id, s] of this.states)
            if (!ids.has(id)) {
                this.releaseState(s);
                this.states.delete(id);
            }
        this.lastTime = NaN;
    }
    resolve(id, scope = null) {
        if (!this.compiled)
            return null;
        if (!scope)
            return this.compiled.rootOutputs.get(id) || id;
        return this.compiled.nodes.find(n => n.originalId === id && n.componentScope === scope)?.id || null;
    }
    state(id) {
        let s = this.states.get(id);
        if (!s) {
            s = {
                id, revision: 0, signature: null, historyIndex: 0, cooks: 0, cpuMs: 0, error: null
            };
            this.states.set(id, s);
        }
        return s;
    }
    releaseState(s) {
        for (const key of ['target', 'depth', 'preview', 'mediaTexture'])
            if (s[key])
                this.pool?.release(s[key]);
        for (const h of s.history || [])
            this.pool?.release(h);
        for (const key of ['uniform', 'meshUniform', 'particleBuffer'])
            s[key]?.destroy();
    }
    clear() {
        for (const s of this.states.values())
            this.releaseState(s);
        this.states.clear();
        for (const b of this.meshBuffers.values()) {
            b.vertex.destroy();
            b.index.destroy();
        }
        this.meshBuffers.clear();
        this.lastTime = NaN;
    }
    resetSimulation() {
        for (const s of this.states.values()) {
            s.signature = null;
            s.particleReset = true;
            for (const h of s.history || [])
                this.pool.release(h);
            s.history = null;
            s.historyIndex = 0;
        }
        this.lastTime = NaN;
    }
    target(s, key = 'target', width = this.project.settings.width, height = this.project.settings.height, format = 'rgba8unorm') {
        let r = s[key];
        if (r && (r.width !== width || r.height !== height || r.format !== format)) {
            this.pool.release(r);
            delete s[key];
            r = null;
        }
        if (!r)
            s[key] = r = this.pool.acquire(width, height, format, format === 'depth32float' ? GPUTextureUsage.RENDER_ATTACHMENT : null);
        return r;
    }
    uniform(s, values) {
        s.uniform ||= this.device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.device.queue.writeBuffer(s.uniform, 0, values);
        return s.uniform;
    }
    uniforms(n, p, time, dt, signal = 0) {
        const a = new Float32Array(28), rad = Math.PI / 180;
        const set = (offset, list) => a.set(list, offset);
        set(0, [this.project.settings.width, this.project.settings.height, time, dt]);
        set(16, [1, 1, 1, 1]);
        set(20, [1, 1, 1, 1]);
        set(24, [this.frameNumber, signal, 0, 0]);
        const color = (offset, key) => {
            if (p[key])
                set(offset, hexColor(p[key]));
        };
        color(16, 'color');
        color(16, 'colorA');
        color(20, 'colorB');
        switch (n.type) {
            case 'noise':
                set(4, [p.scale, p.detail, p.speed, p.warp]);
                set(8, [p.contrast, ['iridescent', 'ember', 'glacier', 'mono'].indexOf(p.palette), p.seed, 0]);
                a[4] *= 1 + signal * .2;
                break;
            case 'ramp':
                set(4, [p.angle * rad, p.frequency, ['linear', 'radial', 'angular'].indexOf(p.mode), 0]);
                break;
            case 'shape':
                set(4, [p.radius * (1 + signal * .25), p.softness, p.sides, p.rotation * rad]);
                a[8] = ['circle', 'polygon', 'ring'].indexOf(p.mode);
                break;
            case 'checker':
                a[4] = p.count;
                break;
            case 'transform':
                set(4, [p.scale, p.rotation * rad, p.x, p.y]);
                break;
            case 'displace':
                set(4, [p.amount, p.frequency, 0, 0]);
                break;
            case 'kaleido':
                set(4, [p.segments, p.rotation * rad, p.zoom, p.centerX]);
                a[8] = p.centerY;
                break;
            case 'blur':
                a[4] = p.radius;
                break;
            case 'bloom':
                set(4, [p.strength, p.radius, p.threshold, 0]);
                break;
            case 'level':
                set(4, [p.brightness, p.contrast, p.gamma, p.saturation]);
                a[8] = p.invert === 'on' ? 1 : 0;
                break;
            case 'composite':
                set(4, [['screen', 'add', 'over', 'multiply', 'difference'].indexOf(p.mode), p.opacity, 0, 0]);
                break;
            case 'edge':
                set(4, [p.strength, p.mix, 0, 0]);
                break;
            case 'feedback':
                set(4, [p.decay, p.zoom, p.rotation * rad, 0]);
                break;
            case 'shader':
                set(4, [p.amount, p.speed, p.scale, 0]);
                break;
            case 'particles':
                set(4, [Math.round(p.count), p.speed, p.turbulence, p.size]);
                a[8] = p.radius;
                break;
        }
        return a;
    }
    effect(encoder, s, pipeline, uniforms, a = this.black, b = this.black, target = null) {
        target ||= this.target(s);
        const uniform = this.uniform(s, uniforms);
        const signature = [pipeline, uniform, a.view, b.view];
        if (!s.bindSignature || signature.some((v, i) => s.bindSignature[i] !== v)) {
            s.bindSignature = signature;
            s.bind = this.device.createBindGroup({ layout: this.effectLayout, entries: [{ binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: this.sampler }, { binding: 2, resource: a.view }, { binding: 3, resource: b.view }] });
        }
        const pass = encoder.beginRenderPass({ label: s.id, colorAttachments: [{
                    view: target.view, clearValue: CLEAR, loadOp: 'clear', storeOp: 'store'
                }] });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, s.bind);
        pass.draw(3);
        pass.end();
        this.stats.passes++;
        return target;
    }
    renderMesh(encoder, s, geometry, p, material = null, targetKey = 'target') {
        const target = this.target(s, targetKey);
        if (!geometry?.vertices?.length)
            return this.effect(encoder, s, this.pipelines.missing, this.uniforms({ type: 'output' }, {}, 0, 0), this.black, this.black, target);
        const depth = this.target(s, 'depth', target.width, target.height, 'depth32float');
        let buffers = this.meshBuffers.get(geometry.vertices);
        if (!buffers) {
            const vertex = this.device.createBuffer({ size: geometry.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
            const index = this.device.createBuffer({ size: geometry.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
            this.device.queue.writeBuffer(vertex, 0, geometry.vertices);
            this.device.queue.writeBuffer(index, 0, geometry.indices);
            buffers = { vertex, index, count: geometry.indices.length };
            this.meshBuffers.set(geometry.vertices, buffers);
        }
        buffers.lastFrame = this.frameNumber;
        const yaw = p.yaw * Math.PI / 180, pitch = p.pitch * Math.PI / 180, eye = [Math.sin(yaw) * Math.cos(pitch) * p.distance, Math.sin(pitch) * p.distance, Math.cos(yaw) * Math.cos(pitch) * p.distance];
        const model = geometry.matrix || identity(), vp = multiply(perspective(Math.PI / 4, target.width / target.height, .05, 100), lookAt(eye)), mvp = multiply(vp, model);
        const values = new Float32Array(48);
        values.set(mvp, 0);
        values.set(model, 16);
        values.set(hexColor(p.color), 32);
        values.set([...eye, 1], 36);
        values.set([p.metallic, p.roughness, 0, 0], 40);
        values.set([Math.round(p.instances), p.spread, material ? 1 : 0, 0], 44);
        s.meshUniform ||= this.device.createBuffer({ size: 192, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.device.queue.writeBuffer(s.meshUniform, 0, values);
        const mat = material || this.black;
        if (s.meshMat !== mat || !s.meshBind) {
            s.meshMat = mat;
            s.meshBind = this.device.createBindGroup({ layout: this.meshPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: s.meshUniform } }, { binding: 1, resource: mat.view }, { binding: 2, resource: this.sampler }] });
        }
        const pass = encoder.beginRenderPass({ colorAttachments: [{
                    view: target.view, loadOp: 'clear', storeOp: 'store', clearValue: CLEAR
                }], depthStencilAttachment: {
                view: depth.view, depthLoadOp: 'clear', depthClearValue: 1, depthStoreOp: 'discard'
            } });
        pass.setPipeline(this.meshPipeline);
        pass.setBindGroup(0, s.meshBind);
        pass.setVertexBuffer(0, buffers.vertex);
        pass.setIndexBuffer(buffers.index, 'uint32');
        pass.drawIndexed(buffers.count, Math.round(p.instances));
        pass.end();
        this.stats.passes++;
        return target;
    }
    particles(encoder, s, p, u) {
        const count = Math.min(131072, Math.max(1024, Math.round(p.count))), bytes = count * 32;
        if (s.particleBytes !== bytes) {
            s.particleBuffer?.destroy();
            s.particleBuffer = this.device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
            s.particleBytes = bytes;
            s.particleReset = true;
            s.computeBind = null;
            s.particleBind = null;
        }
        u[4] = count;
        u[27] = s.particleReset ? 1 : 0;
        s.particleReset = false;
        const uniform = this.uniform(s, u);
        if (!s.computeBind) {
            s.computeBind = this.device.createBindGroup({ layout: this.computePipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: { buffer: s.particleBuffer } }] });
            s.particleBind = this.device.createBindGroup({ layout: this.particlePipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: { buffer: s.particleBuffer } }] });
        }
        const compute = encoder.beginComputePass({ label: 'Particle integration' });
        compute.setPipeline(this.computePipeline);
        compute.setBindGroup(0, s.computeBind);
        compute.dispatchWorkgroups(Math.ceil(count / 256));
        compute.end();
        this.stats.compute++;
        const target = this.target(s);
        const pass = encoder.beginRenderPass({ colorAttachments: [{
                    view: target.view, clearValue: CLEAR, loadOp: 'clear', storeOp: 'store'
                }] });
        pass.setPipeline(this.particlePipeline);
        pass.setBindGroup(0, s.particleBind);
        pass.draw(6, count);
        pass.end();
        this.stats.passes++;
        this.stats.particles += count;
        return target;
    }
    signal(n, p, inputs, time, s) {
        let value = 0, channels;
        if (n.type === 'value')
            value = p.value;
        if (n.type === 'lfo')
            value = signalValue(p.wave, time * p.frequency + p.phase) * p.amplitude + p.offset;
        if (n.type === 'math') {
            const a = inputs[0]?.value || 0, b = inputs[1]?.value || 0;
            const v = {
                scale: () => a, add: () => a + b, multiply: () => a * b, subtract: () => a - b, min: () => Math.min(a, b), max: () => Math.max(a, b)
            }[p.operation]();
            value = v * p.scale + p.offset;
            if (p.clamp === 'on')
                value = Math.min(1, Math.max(0, value));
        }
        if (n.type === 'audio') {
            channels = this.media.analyze(n.originalId, p);
            value = channels[p.band];
        }
        s.samples ||= new Float32Array(128);
        s.samples.copyWithin(0, 1);
        s.samples[127] = value;
        return {
            kind: 'signal', value, channels: channels || { chan1: value }, samples: s.samples
        };
    }
    cook(encoder, n, s, p, inputs, time, dt, advance) {
        const def = OPS[n.type];
        const textures = def.inputs.flatMap((port, i) => port.type === 'texture' ? [inputs[i]?.texture] : []);
        const mod = inputs.find(x => x?.kind === 'signal')?.value || 0;
        if (n.bypass && inputs[0]?.kind === def.output)
            return inputs[0];
        if (def.output === 'signal')
            return this.signal(n, p, inputs, time, s);
        if (def.output === 'geometry') {
            if (n.type === 'geoTransform') {
                const base = inputs[0];
                if (!base?.geometry)
                    return { kind: 'geometry', geometry: null };
                const q = { ...p, scale: p.scale * (1 + mod * .2) };
                return { kind: 'geometry', geometry: { ...base.geometry, matrix: multiply(transformMatrix(q, time), base.geometry.matrix) } };
            }
            return { kind: 'geometry', geometry: createGeometry(n.type, p) };
        }
        if (n.type === 'output')
            return { kind: 'texture', texture: textures[0] || this.black };
        let u = this.uniforms(n, p, time, dt, mod), texture;
        if (n.type === 'render') {
            texture = this.renderMesh(encoder, s, inputs[0]?.geometry, p, inputs[1]?.texture);
        }
        else if (n.type === 'particles') {
            texture = this.particles(encoder, s, p, u);
        }
        else if (n.type === 'feedback') {
            const { width, height } = this.project.settings;
            if (s.history && (s.history[0].width !== width || s.history[0].height !== height)) {
                for (const h of s.history)
                    this.pool.release(h);
                s.history = null;
            }
            if (!s.history) {
                s.history = [this.pool.acquire(width, height), this.pool.acquire(width, height)];
                s.historyIndex = 0;
                for (const h of s.history) {
                    const pass = encoder.beginRenderPass({ colorAttachments: [{
                                view: h.view, clearValue: {
                                    r: 0, g: 0, b: 0, a: 1
                                }, loadOp: 'clear', storeOp: 'store'
                            }] });
                    pass.end();
                }
            }
            texture = this.effect(encoder, s, this.pipelines.feedback, u, s.history[s.historyIndex]);
            s.capture = advance;
        }
        else if (['image', 'video', 'camera'].includes(n.type)) {
            const rec = this.media.sources.get(n.originalId), source = rec?.image || rec?.video;
            if (source && (rec.image || rec.video.readyState >= 2)) {
                const w = rec.image ? rec.image.naturalWidth : rec.video.videoWidth, h = rec.image ? rec.image.naturalHeight : rec.video.videoHeight;
                if (w > this.device.limits.maxTextureDimension2D || h > this.device.limits.maxTextureDimension2D)
                    throw new Error('Media exceeds the GPU maximum texture dimensions.');
                const r = this.target(s, 'mediaTexture', w, h);
                if (rec.video)
                    rec.video.playbackRate = p.rate || 1;
                this.device.queue.copyExternalImageToTexture({ source }, { texture: r.texture }, [w, h]);
                u.set([w, h, ['contain', 'cover', 'stretch'].indexOf(p.fit), p.mirror === 'on' ? 1 : 0], 4);
                texture = this.effect(encoder, s, this.pipelines.media, u, r);
            }
            else if (source && s.data?.texture === s.target) {
                texture = s.target;
            }
            else
                texture = this.effect(encoder, s, this.pipelines.missing, u);
        }
        else if (n.type === 'shader') {
            let pipeline = this.shaderCache.get(p.code) || s.lastGoodPipeline;
            if (s.shaderCode !== p.code) {
                s.shaderCode = p.code;
                this.compileShader(p.code).then(result => {
                    if (s.shaderCode !== p.code)
                        return;
                    s.diagnostics = result.messages;
                    if (result.pipeline) {
                        s.lastGoodPipeline = result.pipeline;
                        s.error = null;
                    }
                    else {
                        s.error = result.messages.map(m => `L${m.line}: ${m.message}`).join('\n');
                        this.log(`${n.name}: shader rejected; keeping last valid pipeline.`, 'error');
                    }
                    s.signature = null;
                    this.dispatchEvent(new Event('diagnostics'));
                }).catch(e => {
                    s.error = e.message;
                    this.log(e.message, 'error');
                });
            }
            texture = this.effect(encoder, s, pipeline || this.pipelines.missing, u, textures[0], textures[1]);
        }
        else
            texture = this.effect(encoder, s, this.pipelines[n.type] || this.pipelines.copy, u, textures[0], textures[1]);
        return { kind: 'texture', texture };
    }
    frame(time, dt, playing = true) {
        if (!this.ready || !this.compiled || this.inFlight >= 2)
            return false;
        const start = performance.now();
        this.frameNumber++;
        this.stats = {
            passes: 0, compute: 0, cooked: 0, cached: 0, cpuMs: 0, particles: 0
        };
        const advance = time !== this.lastTime, stepDt = advance ? dt : 0;
        const encoder = this.device.createCommandEncoder({ label: `frame ${this.frameNumber}` });
        const roots = new Set([this.compiled.output, this.viewerId, ...this.watch].filter(Boolean)), demand = new Set();
        const byId = new Map(this.compiled.nodes.map(n => [n.id, n]));
        const visit = id => {
            if (demand.has(id) || !byId.has(id))
                return;
            demand.add(id);
            for (const dep of this.inputEdges.get(id) || [])
                if (dep)
                    visit(dep);
            for (const b of Object.values(byId.get(id).bindings || {}))
                visit(b.node);
        };
        for (const root of roots)
            visit(root);
        for (const n of this.compiled.order) {
            if (!demand.has(n.id))
                continue;
            const s = this.state(n.id), deps = this.inputEdges.get(n.id) || [];
            const values = parameterValues(n, time, id => this.states.get(id)?.data?.value || 0), inputs = deps.map(id => this.states.get(id)?.data), def = OPS[n.type];
            const timeDependent = !!def.dynamic?.(values) || Object.values(n.keyframes || {}).some(k => k.length > 0);
            const revisions = def.delay ? [] : deps.map(id => this.states.get(id)?.revision || 0);
            const bindings = Object.values(n.bindings || {}).map(b => this.states.get(b.node)?.revision || 0);
            const source = this.media.sources.get(n.originalId);
            const mediaToken = def.media ? [this.media.version, source?.video?.currentTime || 0, source?.video?.readyState || 0, source?.kind === 'audio' && playing ? this.frameNumber : 0] : [];
            const signature = JSON.stringify([n.type, n.bypass, values, revisions, bindings, timeDependent ? time : 0, mediaToken, this.project.settings.width, this.project.settings.height]);
            if (signature === s.signature && s.data) {
                this.stats.cached++;
                continue;
            }
            const cookStart = performance.now();
            try {
                s.data = this.cook(encoder, n, s, values, inputs, time, stepDt, advance);
                if (n.type !== 'shader')
                    s.error = null;
                s.revision = ++this.revision;
                s.signature = signature;
                s.cooks++;
                this.stats.cooked++;
            }
            catch (e) {
                s.error = e.message;
                s.signature = signature;
                s.data = {
                    kind: def.output, texture: this.black, value: 0, samples: new Float32Array(128)
                };
                this.log(`${n.name}: ${e.message}`, 'error');
            }
            s.cpuMs = performance.now() - cookStart;
        }
        // Capture is deliberately after every ordinary pass: no read/write texture aliasing.
        for (const n of this.compiled.order) {
            if (n.type !== 'feedback' || !demand.has(n.id))
                continue;
            const s = this.state(n.id);
            if (!s.capture || !s.history)
                continue;
            s.capture = false;
            const inputId = this.inputEdges.get(n.id)?.[0], src = this.states.get(inputId)?.data?.texture;
            if (src && src.width === this.project.settings.width && src.height === this.project.settings.height) {
                const next = 1 - s.historyIndex;
                encoder.copyTextureToTexture({ texture: src.texture }, { texture: s.history[next].texture }, [src.width, src.height]);
                s.historyIndex = next;
            }
        }
        // Geometry viewers share indexed mesh buffers with Render TOPs.
        for (const id of roots) {
            const s = this.states.get(id);
            if (s?.data?.kind === 'geometry' && s.previewRevision !== s.revision) {
                s.preview = this.renderMesh(encoder, s, s.data.geometry, { ...defaults('render'), yaw: 25, pitch: 20 }, null, 'preview');
                s.previewRevision = s.revision;
            }
        }
        this.present(encoder);
        this.device.queue.submit([encoder.finish()]);
        this.inFlight++;
        this.device.queue.onSubmittedWorkDone().then(() => {
            this.inFlight = Math.max(0, this.inFlight - 1);
        }).catch(() => {
            this.inFlight = Math.max(0, this.inFlight - 1);
        });
        this.lastTime = time;
        this.stats.cpuMs = performance.now() - start;
        if (this.frameNumber % 120 === 0)
            for (const [key, b] of this.meshBuffers)
                if (this.frameNumber - b.lastFrame > 120) {
                    b.vertex.destroy();
                    b.index.destroy();
                    this.meshBuffers.delete(key);
                }
        return true;
    }
    attachView(canvas, getId, thumbnail = false) {
        if (this.views.has(canvas))
            return;
        const context = canvas.getContext('webgpu');
        if (!context)
            throw new Error('Cannot acquire a WebGPU canvas context.');
        context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });
        this.views.set(canvas, {
            context, getId, thumbnail, bind: null, texture: null
        });
    }
    detachView(canvas) {
        const v = this.views.get(canvas);
        v?.context.unconfigure();
        this.views.delete(canvas);
    }
    present(encoder) {
        for (const [canvas, v] of this.views) {
            if (!canvas.isConnected) {
                this.detachView(canvas);
                continue;
            }
            if (v.thumbnail && this.frameNumber % 4 !== 1)
                continue;
            const id = v.getId(), s = this.states.get(id);
            const texture = s?.data?.texture || s?.preview || this.black;
            const rect = canvas.getBoundingClientRect();
            if (rect.width < 1 || rect.height < 1)
                continue;
            const ratio = v.thumbnail ? 1 : Math.min(2, devicePixelRatio || 1), w = Math.max(1, Math.round(rect.width * ratio)), h = Math.max(1, Math.round(rect.height * ratio));
            if (canvas.width !== w || canvas.height !== h) {
                canvas.width = w;
                canvas.height = h;
            }
            if (v.texture !== texture) {
                v.texture = texture;
                v.bind = this.device.createBindGroup({ layout: this.presentPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: texture.view }, { binding: 1, resource: this.clampSampler }] });
            }
            const pass = encoder.beginRenderPass({ colorAttachments: [{
                        view: v.context.getCurrentTexture().createView(), clearValue: CLEAR, loadOp: 'clear', storeOp: 'store'
                    }] });
            pass.setPipeline(this.presentPipeline);
            pass.setBindGroup(0, v.bind);
            pass.draw(3);
            pass.end();
        }
    }
    async readPixels(id) {
        const s = this.states.get(id), texture = s?.data?.texture || s?.preview;
        if (!texture)
            throw new Error('The selected output has not been rendered.');
        const { width, height } = texture, bytesPerRow = Math.ceil(width * 4 / 256) * 256, buffer = this.device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        try {
            const e = this.device.createCommandEncoder();
            e.copyTextureToBuffer({ texture: texture.texture }, { buffer, bytesPerRow }, [width, height]);
            this.device.queue.submit([e.finish()]);
            await buffer.mapAsync(GPUMapMode.READ);
            const raw = new Uint8Array(buffer.getMappedRange()), pixels = new Uint8ClampedArray(width * height * 4);
            for (let y = 0; y < height; y++)
                pixels.set(raw.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4);
            buffer.unmap();
            return new ImageData(pixels, width, height);
        }
        finally {
            buffer.destroy();
        }
    }
    async snapshot(id) {
        const image = await this.readPixels(id);
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        canvas.getContext('2d').putImageData(image, 0, 0);
        return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG encoding failed.')), 'image/png'));
    }
    dispose() {
        this.ready = false;
        for (const c of [...this.views.keys()])
            this.detachView(c);
        this.clear();
        this.pool?.dispose();
        this.device?.destroy();
    }
}
