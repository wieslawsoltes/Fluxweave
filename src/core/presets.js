import { emptyProject, createNode } from './graph.js';
import { defaults } from './operators.js';
const presets = {};
function build(name, items, wires, output) {
    const p = emptyProject();
    p.name = name;
    const map = {};
    for (const [name, type, x, y, params = {}] of items) {
        const n = createNode(type, x, y, name);
        n.id = name;
        n.params = { ...defaults(type), ...params };
        map[name] = n;
        p.nodes.push(n);
    }
    p.edges = wires.map(([from, to, input = 0], i) => ({
        id: `e${i}`, from, to, input
    }));
    p.output = output;
    p.view = { x: 28, y: 32, zoom: .6 };
    return p;
}
presets.chroma = () => build('Chromatic currents', [
    ['noise1', 'noise', 30, 40, {
            scale: 2.1, warp: 2.1, contrast: 1.15, speed: .16
        }],
    ['ramp1', 'ramp', 30, 260, {
            angle: 30, mode: 'radial', colorA: '#253065', colorB: '#bea0de'
        }],
    ['lfo1', 'lfo', 270, 280, { frequency: .12, amplitude: .35, offset: .45 }],
    ['displace1', 'displace', 270, 40, { amount: .2 }],
    ['kaleido1', 'kaleido', 510, 40, { segments: 3, zoom: 1.5, rotation: 28 }],
    ['level1', 'level', 750, 40, { brightness: 1.08, contrast: 1.08, saturation: 1.1 }],
    ['feedback1', 'feedback', 750, 260, { decay: .9, zoom: 1.006, rotation: .25 }],
    ['composite1', 'composite', 990, 40, { mode: 'screen', opacity: .14 }],
    ['bloom1', 'bloom', 1230, 40, { strength: .65, radius: 12, threshold: .5 }],
    ['out1', 'output', 1470, 40, {}]
], [['noise1', 'displace1', 0], ['ramp1', 'displace1', 1], ['lfo1', 'displace1', 2], ['displace1', 'kaleido1'], ['kaleido1', 'level1'], ['level1', 'composite1', 0], ['feedback1', 'composite1', 1], ['composite1', 'feedback1'], ['composite1', 'bloom1'], ['bloom1', 'out1']], 'out1');
presets.particles = () => build('Orbital matter', [
    ['lfo1', 'lfo', 30, 220, { frequency: .13, amplitude: .5, offset: .5 }], ['particles1', 'particles', 270, 40, {
            count: 32768, speed: .8, turbulence: 1.5, size: 2
        }], ['feedback1', 'feedback', 510, 250, { decay: .91, zoom: 1.002, rotation: .1 }], ['composite1', 'composite', 510, 40, { mode: 'add', opacity: .6 }], ['bloom1', 'bloom', 750, 40, { strength: 1.2, radius: 9, threshold: .18 }], ['out1', 'output', 990, 40, {}]
], [['lfo1', 'particles1'], ['particles1', 'composite1', 0], ['feedback1', 'composite1', 1], ['composite1', 'feedback1'], ['composite1', 'bloom1'], ['bloom1', 'out1']], 'out1');
presets.geometry = () => build('Sculpted light', [
    ['torus1', 'torus', 30, 40, { radius: 1.3, tube: .45 }], ['transform1', 'geoTransform', 270, 40, { rx: 36, spin: 17 }], ['noise1', 'noise', 270, 270, { scale: 3.5, speed: 0, palette: 'glacier' }], ['render1', 'render', 510, 40, {
            color: '#baa6ed', distance: 5.6, metallic: .8, roughness: .2
        }], ['bloom1', 'bloom', 750, 40, { strength: .55, radius: 13, threshold: .7 }], ['out1', 'output', 990, 40, {}]
], [['torus1', 'transform1'], ['transform1', 'render1'], ['noise1', 'render1', 1], ['render1', 'bloom1'], ['bloom1', 'out1']], 'out1');
presets.audio = () => build('Resonant field', [
    ['audio1', 'audio', 30, 220, { gain: 2.5, band: 'bass' }], ['noise1', 'noise', 30, 40, { scale: 2.4, warp: 2.8, speed: .22 }], ['kaleido1', 'kaleido', 270, 40, { segments: 8, zoom: 1.2 }], ['level1', 'level', 510, 40, { brightness: .9, contrast: 1.3 }], ['bloom1', 'bloom', 750, 40, { strength: 1.3, threshold: .25, radius: 16 }], ['out1', 'output', 990, 40, {}]
], [['audio1', 'noise1'], ['noise1', 'kaleido1'], ['kaleido1', 'level1'], ['audio1', 'level1', 1], ['level1', 'bloom1'], ['audio1', 'bloom1', 1], ['bloom1', 'out1']], 'out1');
presets.shader = () => build('Interference study', [
    ['lfo1', 'lfo', 30, 220, { frequency: .08 }], ['shader1', 'shader', 270, 40, {}], ['bloom1', 'bloom', 510, 40, { strength: .65, threshold: .5 }], ['out1', 'output', 750, 40, {}]
], [['lfo1', 'shader1', 2], ['shader1', 'bloom1'], ['bloom1', 'out1']], 'out1');
export const PRESETS = presets;
