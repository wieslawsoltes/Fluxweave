/** Operator schemas are the single source of truth for port checking and inspectors. */
const f = (label, value, min, max, step = .01) => ({
    label, value, min, max, step, type: 'number'
});
const c = (label, value) => ({ label, value, type: 'color' });
const s = (label, value, options) => ({
    label, value, options, type: 'select'
});
const tex = name => ({ name, type: 'texture' });
const sig = name => ({ name, type: 'signal' });
const geo = name => ({ name, type: 'geometry' });
const op = (label, family, output, inputs, params, description, extra = {}) => ({
    label, family, output, inputs, params, description, ...extra
});
export const FAMILIES = {
    TOP: { name: 'Texture', color: '#b497f7', description: 'GPU image processing' },
    CHOP: { name: 'Channel', color: '#9edc83', description: 'Signals, audio & motion' },
    SOP: { name: 'Geometry', color: '#6caedb', description: 'Procedural surfaces' },
    POP: { name: 'Particle', color: '#ef91c5', description: 'GPU compute simulation' },
    COMP: { name: 'Component', color: '#ebbd79', description: 'Reusable networks' }
};
export const DEFAULT_SHADER = `// Live WGSL • input A: srcA • input B: srcB
// u.frame = (width, height, time, deltaTime)
// u.p0 = (amount, speed, scale, 0); u.extra.y = signal
fn effect(uv: vec2f) -> vec4f {
  let t = u.frame.z * u.p0.y;
  var p = (uv - 0.5) * vec2f(u.frame.x / u.frame.y, 1.0);
  p *= u.p0.z;
  for (var i = 0; i < 5; i++) {
    let a = f32(i) + 1.0;
    p += 0.15 * vec2f(sin(p.y * a + t), cos(p.x * a - t));
  }
  let v = 0.5 + 0.5 * sin(length(p) * 10.0 - t * 2.0);
  let color = palette(v + p.x * 0.3);
  let source = textureSample(srcA, samp, uv).rgb;
  return vec4f(mix(color, source, u.p0.x), 1.0);
}`;
export const OPS = {
    noise: op('Noise', 'TOP', 'texture', [sig('Modulation')], {
        scale: f('Scale', 2.4, .1, 12), detail: f('Detail', 5, 1, 7, 1), speed: f('Evolution', .16, 0, 2), warp: f('Domain warp', 1.8, 0, 4), contrast: f('Contrast', 1.2, .1, 3), palette: s('Color palette', 'iridescent', ['iridescent', 'ember', 'glacier', 'mono']), seed: f('Seed', 4, 0, 100, 1)
    }, 'Fractal gradient noise with domain warping and spectral color.', { dynamic: p => p.speed !== 0 }),
    ramp: op('Ramp', 'TOP', 'texture', [], {
        angle: f('Angle', 0, -180, 180, 1), frequency: f('Repeats', 1, .1, 10), colorA: c('Color A', '#40237d'), colorB: c('Color B', '#83efd3'), mode: s('Ramp type', 'linear', ['linear', 'radial', 'angular'])
    }, 'A two-color linear, radial or angular texture ramp.'),
    constant: op('Constant', 'TOP', 'texture', [], { color: c('Color', '#9c77ee') }, 'A solid color texture.'),
    shape: op('Shape', 'TOP', 'texture', [sig('Modulation')], {
        radius: f('Radius', .32, .01, .7), softness: f('Soft edge', .015, .001, .3), sides: f('Sides', 6, 3, 32, 1), rotation: f('Rotation', 0, -180, 180, 1), color: c('Color', '#b7edb0'), mode: s('Primitive', 'circle', ['circle', 'polygon', 'ring'])
    }, 'Analytic circle, polygon or ring mask.'),
    checker: op('Checker', 'TOP', 'texture', [], { count: f('Tiles', 12, 2, 64, 1), colorA: c('Color A', '#10141b'), colorB: c('Color B', '#dcdbeb') }, 'Procedural checkerboard.'),
    transform: op('Transform', 'TOP', 'texture', [tex('Image')], {
        scale: f('Scale', 1, .1, 4), rotation: f('Rotation', 0, -180, 180, 1), x: f('Translate X', 0, -1, 1), y: f('Translate Y', 0, -1, 1)
    }, '2D texture transform with mirrored repeat sampling.'),
    displace: op('Displace', 'TOP', 'texture', [tex('Image'), tex('Displacement'), sig('Modulation')], { amount: f('Displacement', .14, 0, 1), frequency: f('Frequency', 1, .1, 8) }, 'Displace image coordinates using the red and green channels of another texture.'),
    kaleido: op('Kaleidoscope', 'TOP', 'texture', [tex('Image')], {
        segments: f('Segments', 6, 1, 24, 1), rotation: f('Rotation', 16, -180, 180, 1), zoom: f('Zoom', 1.1, .1, 3), centerX: f('Center X', 0, -.5, .5), centerY: f('Center Y', 0, -.5, .5)
    }, 'Polar reflection and rotational symmetry.'),
    blur: op('Blur', 'TOP', 'texture', [tex('Image')], { radius: f('Radius', 4, 0, 24, .1) }, 'A 13-tap weighted GPU blur.'),
    bloom: op('Bloom', 'TOP', 'texture', [tex('Image'), sig('Modulation')], { strength: f('Intensity', .45, 0, 3), radius: f('Radius', 8, 1, 32, .1), threshold: f('Threshold', .5, 0, 1) }, 'Thresholded luminance glow composed with the source.'),
    level: op('Level', 'TOP', 'texture', [tex('Image'), sig('Modulation')], {
        brightness: f('Brightness', 1, .0, 3), contrast: f('Contrast', 1.12, 0, 3), gamma: f('Gamma', 1, .1, 3), saturation: f('Saturation', 1.15, 0, 3), invert: s('Invert', 'off', ['off', 'on'])
    }, 'Color correction: gain, contrast, gamma and saturation.'),
    composite: op('Composite', 'TOP', 'texture', [tex('Image A'), tex('Image B')], { mode: s('Operation', 'screen', ['screen', 'add', 'over', 'multiply', 'difference']), opacity: f('Opacity B', .55, 0, 1) }, 'Composite two GPU textures.'),
    edge: op('Edge', 'TOP', 'texture', [tex('Image')], { strength: f('Strength', 2, 0, 10), mix: f('Source mix', .1, 0, 1) }, 'Sobel gradient edges mixed with the original texture.'),
    feedback: op('Feedback', 'TOP', 'texture', [tex('Capture next frame')], { decay: f('Decay', .94, 0, 1), zoom: f('Zoom', 1.008, .8, 1.2, .001), rotation: f('Rotation', .35, -5, 5, .01) }, 'A strict one-frame delay. Its input is captured only after every current-frame pass.', { delay: true, dynamic: () => true }),
    shader: op('WGSL Shader', 'TOP', 'texture', [tex('Image A'), tex('Image B'), sig('Modulation')], {
        amount: f('Source mix', 0, 0, 1), speed: f('Speed', .35, 0, 4), scale: f('Scale', 2, .1, 8), code: { label: 'WGSL source', value: DEFAULT_SHADER, type: 'code' }
    }, 'A live fragment shader with asynchronous compiler diagnostics.', { dynamic: () => true }),
    image: op('Image File', 'TOP', 'texture', [], { fit: s('Fit', 'contain', ['contain', 'cover', 'stretch']) }, 'Local image input. The source asset is embedded in saved projects.', { media: 'image' }),
    video: op('Movie File', 'TOP', 'texture', [], { rate: f('Playback rate', 1, .1, 4), fit: s('Fit', 'cover', ['contain', 'cover', 'stretch']) }, 'Video decoded by the browser and uploaded directly to the GPU.', { media: 'video', dynamic: () => true }),
    camera: op('Camera In', 'TOP', 'texture', [], { fit: s('Fit', 'cover', ['contain', 'cover', 'stretch']), mirror: s('Mirror', 'on', ['on', 'off']) }, 'Permission-based live camera capture. Capture starts only on request.', { media: 'camera', dynamic: () => true }),
    output: op('Output', 'TOP', 'texture', [tex('Image')], {}, 'A named live output. Double-click to make it the main viewer.'),
    lfo: op('LFO', 'CHOP', 'signal', [], {
        frequency: f('Frequency (Hz)', .18, 0, 10, .001), amplitude: f('Amplitude', .5, 0, 5), offset: f('Offset', .5, -5, 5), phase: f('Phase', 0, 0, 1), wave: s('Waveform', 'sine', ['sine', 'triangle', 'saw', 'square'])
    }, 'An analytic low-frequency oscillator, evaluated at the timeline time.', { dynamic: () => true }),
    value: op('Constant Channel', 'CHOP', 'signal', [], { value: f('Value', 1, -10, 10) }, 'A constant numeric signal.'),
    math: op('Math', 'CHOP', 'signal', [sig('Channel A'), sig('Channel B')], {
        operation: s('Operation', 'scale', ['scale', 'add', 'multiply', 'subtract', 'min', 'max']), scale: f('Multiply', 1, -10, 10), offset: f('Add', 0, -10, 10), clamp: s('Clamp 0–1', 'off', ['off', 'on'])
    }, 'Channel arithmetic and range conversion.'),
    audio: op('Audio Analyze', 'CHOP', 'signal', [], { band: s('Output band', 'bass', ['rms', 'bass', 'mid', 'high']), gain: f('Gain', 2, .1, 10), smoothing: f('Smoothing', .75, 0, .98) }, 'Web Audio FFT and RMS analysis from a microphone, audio file or test tone.', { media: 'audio', dynamic: () => true }),
    torus: op('Torus', 'SOP', 'geometry', [], {
        radius: f('Major radius', 1.4, .2, 3), tube: f('Tube radius', .38, .05, 1.2), segments: f('Ring segments', 96, 8, 192, 1), sides: f('Tube segments', 32, 4, 96, 1)
    }, 'Indexed torus mesh with smooth normals and UV coordinates.'),
    sphere: op('Sphere', 'SOP', 'geometry', [], { radius: f('Radius', 1.4, .1, 4), segments: f('Longitude', 64, 8, 128, 1), rings: f('Latitude', 32, 4, 96, 1) }, 'Indexed UV sphere with vertex normals.'),
    box: op('Box', 'SOP', 'geometry', [], { width: f('Width', 2, .1, 5), height: f('Height', 2, .1, 5), depth: f('Depth', 2, .1, 5) }, 'A six-face box with hard surface normals.'),
    grid: op('Grid', 'SOP', 'geometry', [], { size: f('Size', 4, .1, 10), segments: f('Segments', 48, 2, 128, 1), wave: f('Wave height', .3, 0, 2) }, 'A tessellated sinusoidal surface with analytic normals.'),
    geoTransform: op('Transform Geometry', 'SOP', 'geometry', [geo('Geometry'), sig('Modulation')], {
        scale: f('Uniform scale', 1, .1, 4), rx: f('Rotate X', 25, -180, 180, 1), ry: f('Rotate Y', 0, -180, 180, 1), rz: f('Rotate Z', 0, -180, 180, 1), x: f('Translate X', 0, -5, 5), y: f('Translate Y', 0, -5, 5), z: f('Translate Z', 0, -5, 5), spin: f('Spin (°/s)', 15, -120, 120, 1)
    }, 'Composable model transforms; geometry buffers remain shared.', { dynamic: p => p.spin !== 0 }),
    render: op('Render', 'TOP', 'texture', [geo('Geometry'), tex('Material'), sig('Modulation')], {
        color: c('Base color', '#aa95ec'), metallic: f('Metallic', .65, 0, 1), roughness: f('Roughness', .3, .05, 1), distance: f('Camera distance', 6, 2, 15), yaw: f('Camera yaw', 25, -180, 180, 1), pitch: f('Camera pitch', 18, -80, 80, 1), instances: f('Instances', 1, 1, 100, 1), spread: f('Instance spread', 3, .1, 8)
    }, 'Depth-tested perspective rendering with GPU mesh instancing and image-based surface color.'),
    particles: op('Particles GPU', 'POP', 'texture', [sig('Modulation')], {
        count: f('Particle count', 32768, 1024, 131072, 1024), speed: f('Speed', .65, 0, 3), turbulence: f('Flow field', 1.1, 0, 4), size: f('Point size', 1.8, .3, 8), radius: f('Orbit radius', .68, .1, 1.2), colorA: c('Color A', '#c096fc'), colorB: c('Color B', '#77f1d5')
    }, 'GPU-resident particles: compute integration, deterministic respawning and additive quad rendering.', { dynamic: () => true }),
    component: op('Component', 'COMP', 'texture', [], {}, 'An instanced, reusable typed subgraph.')
};
export function definition(node, project) {
    if (node.type !== 'component')
        return OPS[node.type];
    const comp = project?.components?.[node.componentId];
    return {
        ...OPS.component, label: comp?.name || 'Missing component', inputs: comp?.inputs || [], output: comp?.outputType || 'texture'
    };
}
export function defaults(type) {
    return Object.fromEntries(Object.entries(OPS[type].params).map(([k, v]) => [k, v.value]));
}
export function evaluateKeyframes(keys, t, base) {
    if (!keys?.length)
        return base;
    if (t <= keys[0].time)
        return keys[0].value;
    for (let i = 1; i < keys.length; i++) {
        const a = keys[i - 1], b = keys[i];
        if (t <= b.time) {
            if (t === b.time)
                return b.value;
            if (a.interpolation === 'step')
                return a.value;
            let x = (t - a.time) / Math.max(1e-8, b.time - a.time);
            if (a.interpolation === 'smooth')
                x = x * x * (3 - 2 * x);
            return a.value + (b.value - a.value) * x;
        }
    }
    return keys.at(-1).value;
}
export function parameterValues(node, time, signalLookup = () => 0) {
    const p = { ...node.params };
    for (const [k, keys] of Object.entries(node.keyframes || {}))
        p[k] = evaluateKeyframes(keys, time, p[k]);
    for (const [k, b] of Object.entries(node.bindings || {}))
        p[k] = signalLookup(b.node) * (b.scale ?? 1) + (b.offset ?? 0);
    for (const [k, v] of Object.entries(p)) {
        const schema = OPS[node.type]?.params[k];
        if (schema?.type === 'number') {
            p[k] = Number.isFinite(v) ? Math.min(schema.max, Math.max(schema.min, v)) : schema.value;
            if (schema.step === 1)
                p[k] = Math.round(p[k]);
        }
    }
    return p;
}
export function signalValue(wave, t) {
    t = ((t % 1) + 1) % 1;
    return wave === 'triangle' ? 1 - 4 * Math.abs(t - .5) : wave === 'saw' ? 2 * t - 1 : wave === 'square' ? (t < .5 ? 1 : -1) : Math.sin(t * Math.PI * 2);
}
