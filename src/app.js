import { Graph, emptyProject, createNode, uid, flattenProject } from './core/graph.js';
import { OPS, FAMILIES, definition, defaults } from './core/operators.js';
import { PRESETS } from './core/presets.js';
import { MediaManager } from './core/media.js';
import { loadLocal, saveLocal, exportProject, importProject, fileDataURL, downloadBlob } from './core/persistence.js';
import { Engine } from './gpu/engine.js';
import { GraphEditor, escapeHTML as esc, SYMBOLS } from './ui/graph-editor.js';
import { Inspector } from './ui/inspector.js';
const $ = s => document.querySelector(s);
let initial;
try {
    initial = await loadLocal();
}
catch (e) {
    console.warn('Autosave could not be restored:', e);
}
const graph = new Graph(initial || PRESETS.chroma()), media = new MediaManager(), engine = new Engine(media);
let time = 0, playing = true, editorTab = 'network', familyFilter = 'all', lastNow = performance.now(), lastEncode = 0, lastRenderTime = 0, lastStats = performance.now(), lastFrames = 0, displayFPS = 0, autoSaveTimer, toastTimer, saveChain = Promise.resolve(), mediaTarget = null, clipboard = null, recorder = null, recordStream = null;
let palettePosition = null, paletteItems = [], paletteIndex = 0, pinned = false;
function toast(message, error = false) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.toggle('error', error);
    el.classList.add('show');
    $('#status-message').textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 4200);
}
function current() {
    return graph.node([...graph.selection][0]);
}
function add(type, x, y, componentId = null) {
    try {
        if (type.startsWith('comp:')) {
            componentId = type.slice(5);
            type = 'component';
        }
        if (x === undefined) {
            const p = graphEditor.center();
            x = p.x;
            y = p.y;
        }
        const n = graph.add(type, x, y, componentId);
        if (!graph.project.output && definition(n, graph.project).output === 'texture' && !graph.active) {
            graph.project.output = n.id;
            engine.setGraph(graph.project);
            engine.viewerId = engine.resolve(n.id);
        }
        toast(`${definition(n, graph.project).label} added. Drag its ports to connect.`);
        return n;
    }
    catch (e) {
        toast(e.message, true);
    }
}
function view(id) {
    const n = graph.node(id);
    if (!n)
        return;
    graph.select([id]);
    const def = definition(n, graph.project);
    if (def.output === 'signal') {
        toast(`${n.name} is a numeric channel. Its live values appear in the channel monitor.`);
        return;
    }
    engine.viewerId = engine.resolve(id, graph.active);
    pinned = true;
    $('#viewer-node').textContent = n.name;
    graphEditor.updateFlags();
    graphEditor.updateWatch();
}
function setOutput(id) {
    const n = graph.node(id);
    if (!n)
        return;
    if (graph.active) {
        if (definition(n, graph.project).output !== graph.network.outputType) {
            toast('The replacement output must preserve this component’s declared port type.', true);
            return;
        }
        graph.transact('Set component output', () => graph.network.output = id);
        toast(`${n.name} is the component output.`);
        return;
    }
    if (definition(n, graph.project).output !== 'texture') {
        toast('Project outputs must be textures. Connect geometry to a Render operator.', true);
        return;
    }
    graph.transact('Set project output', () => {
        graph.project.output = id;
    });
    pinned = false;
    engine.viewerId = engine.resolve(id);
    $('#viewer-node').textContent = n.name;
    graphEditor.updateFlags();
    toast(`${n.name} is the project output.`);
}
function setEditor(tab) {
    editorTab = tab;
    document.querySelectorAll('[data-editor]').forEach(b => b.classList.toggle('active', b.dataset.editor === tab));
    for (const name of ['network', 'shader', 'performance'])
        $(`#${name}-editor`).classList.toggle('hidden', name !== tab);
    if (tab === 'shader')
        refreshShader();
    if (tab === 'network')
        graphEditor.updateWatch();
}
function seek(value) {
    const next = Math.min(graph.project.settings.duration, Math.max(0, value));
    if (next < time)
        engine.resetSimulation();
    time = next;
    lastRenderTime = next;
    updateTimeline();
}
const actions = {
    add, view, setOutput, toast, palette: openPalette, editor: setEditor, time: () => time, seek, media: (id, type) => {
        mediaTarget = { id, type };
        $('#media-file').accept = type === 'image' ? 'image/*' : type === 'video' ? 'video/*' : 'audio/*';
        $('#media-file').value = '';
        $('#media-file').click();
    }, nodeMenu: e => showMenu('node', e.currentTarget)
};
const graphEditor = new GraphEditor(graph, engine, actions), inspector = new Inspector(graph, engine, media, actions);
window.fluxweave = {
    graph, engine, media, presets: PRESETS, editor: graphEditor, actions, get time() {
        return time;
    }, set time(v) {
        seek(v);
    }, get playing() {
        return playing;
    }, set playing(v) {
        playing = !!v;
        updatePlay();
    }
};
function renderLibrary() {
    const query = $('#library-search').value.toLowerCase().trim();
    const list = $('#operator-list');
    list.innerHTML = '';
    for (const [family, data] of Object.entries(FAMILIES)) {
        if (familyFilter !== 'all' && familyFilter !== family)
            continue;
        const entries = Object.entries(OPS).filter(([type, op]) => type !== 'component' && op.family === family && `${op.label} ${type} ${op.description}`.toLowerCase().includes(query));
        const components = family === 'COMP' ? Object.values(graph.project.components).filter(c => c.name.toLowerCase().includes(query)) : [];
        if (!entries.length && !components.length)
            continue;
        const title = document.createElement('div');
        title.className = 'operator-group-label';
        title.innerHTML = `<span>${data.name.toUpperCase()} OPERATORS</span><span>${String(entries.length + components.length).padStart(2, '0')}</span>`;
        list.append(title);
        for (const [type, op] of entries) {
            const b = document.createElement('button');
            b.className = 'operator-row';
            b.style.setProperty('--op-color', data.color);
            b.title = op.description;
            b.draggable = true;
            b.innerHTML = `<span class="op-symbol">${SYMBOLS[type]}</span><span>${esc(op.label)}</span><span class="op-tag">${family}</span>`;
            b.onclick = () => add(type);
            b.ondragstart = e => e.dataTransfer.setData('fluxweave/operator', type);
            list.append(b);
        }
        for (const c of components) {
            const b = document.createElement('button');
            b.className = 'operator-row';
            b.style.setProperty('--op-color', data.color);
            b.innerHTML = `<span class="op-symbol">◈</span><span>${esc(c.name)}</span><span class="op-tag">COMP</span>`;
            b.onclick = () => add('component', undefined, undefined, c.id);
            list.append(b);
        }
    }
}
$('#library-search').oninput = renderLibrary;
document.querySelectorAll('[data-family]').forEach(b => b.onclick = () => {
    familyFilter = b.dataset.family;
    document.querySelectorAll('[data-family]').forEach(a => a.classList.toggle('active', a === b));
    renderLibrary();
});
renderLibrary();
function updateProjectUI() {
    $('#project-name').textContent = graph.project.name;
    document.title = `${graph.project.name} · Fluxweave`;
    $('#network-name').textContent = graph.active ? graph.project.components[graph.active]?.name : graph.project.name.toLowerCase().replace(/\W+/g, '_');
    const s = graph.project.settings;
    $('#resolution').value = `${s.width},${s.height}`;
    $('#duration').value = s.duration;
    $('#fps').value = s.fps;
    $('#timeline-scrub').max = s.duration;
    $('#timeline-scrub').step = 1 / s.fps;
    $('#loop-button').classList.toggle('active', s.loop);
    $('#node-count').textContent = `${graph.network.nodes.length} operators`;
    $('#connection-count').textContent = `${graph.network.edges.length} connections`;
    $('#ruler-labels').innerHTML = Array.from({ length: 11 }, (_, i) => `<span>${(i * s.duration / 10).toFixed(s.duration < 10 ? 1 : 0)}s</span>`).join('');
    if (!pinned || !engine.compiled?.nodes.some(n => n.id === engine.viewerId)) {
        engine.viewerId = engine.compiled?.output || null;
        pinned = false;
        $('#viewer-node').textContent = graph.project.nodes.find(n => n.id === graph.project.output)?.name || 'No output';
    }
    updateTimeline();
}
function updatePlay() {
    $('#play-button').textContent = playing ? 'Ⅱ' : '▶';
    $('#play-button').title = playing ? 'Pause · Space' : 'Play · Space';
    media.syncPlayback(playing);
}
async function restoreAssets() {
    for (const n of [...graph.project.nodes, ...Object.values(graph.project.components).flatMap(c => c.nodes)]) {
        const asset = graph.project.assets[n.params.assetId];
        if (asset && ['image', 'video'].includes(n.type)) {
            try {
                await media.asset(n.id, { ...asset, id: n.params.assetId }, n.type);
            }
            catch (e) {
                toast(`Could not restore ${n.name}: ${e.message}`, true);
            }
        }
    }
}
async function saveNow(silent = false) {
    const revision = graph.serial, payload = structuredClone(graph.project);
    saveChain = saveChain.catch(() => {
    }).then(() => saveLocal(payload));
    try {
        await saveChain;
        if (graph.serial === revision) {
            $('#saved-dot').classList.remove('unsaved');
            $('#saved-dot').title = 'Saved locally in IndexedDB';
        }
        if (!silent)
            toast('Project saved locally, including imported media.');
    }
    catch (e) {
        toast(`Local save failed: ${e.message}. Download the project to keep a copy.`, true);
    }
}
graph.addEventListener('change', e => {
    if (e.detail.kind !== 'layout') {
        const mediaIds = new Set([...graph.project.nodes, ...Object.values(graph.project.components).flatMap(c => c.nodes)].map(n => n.id));
        for (const id of [...media.sources.keys()])
            if (!mediaIds.has(id))
                media.stop(id);
        try {
            engine.setGraph(graph.project);
        }
        catch (err) {
            toast(err.message, true);
        }
        updateProjectUI();
    }
    if (['structure', 'load'].includes(e.detail.kind))
        renderLibrary();
    graphEditor.updateWatch();
    $('#saved-dot').classList.add('unsaved');
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => saveNow(true), 1200);
    if (e.detail.kind !== 'parameter')
        refreshShader();
});
graph.addEventListener('select', () => {
    graphEditor.updateWatch();
    if (editorTab === 'shader')
        refreshShader();
    drawKeys();
});
graph.addEventListener('navigate', () => {
    updateProjectUI();
    graphEditor.updateWatch();
    refreshShader();
});
$('#root-crumb').onclick = () => graph.enter(null);
$('#viewer-node').onclick = () => {
    const n = engine.compiled?.nodes.find(n => n.id === engine.viewerId);
    if (n?.componentScope !== graph.active)
        graph.enter(n?.componentScope || null);
    if (n)
        graph.select([n.originalId]);
};
async function loadProject(project) {
    if (recorder?.state === 'recording')
        recorder.stop();
    for (const id of [...media.sources.keys()])
        media.stop(id);
    pinned = false;
    engine.clear();
    graph.setProject(project);
    time = 0;
    lastRenderTime = 0;
    playing = true;
    updatePlay();
    engine.setGraph(graph.project);
    engine.viewerId = engine.compiled.output;
    const first = graph.project.nodes.find(n => n.type === 'noise' || n.type === 'particles' || n.type === 'render' || n.type === 'shader') || graph.project.nodes[0];
    if (first)
        graph.select([first.id]);
    updateProjectUI();
    requestAnimationFrame(() => graphEditor.fit());
    await restoreAssets();
    toast(`Opened ${graph.project.name}.`);
}
document.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => loadProject(PRESETS[b.dataset.preset]()));
$('#project-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file)
        return;
    try {
        await loadProject(await importProject(file));
    }
    catch (err) {
        toast(err.message, true);
    }
    e.target.value = '';
};
$('#media-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file || !mediaTarget)
        return;
    const { id, type } = mediaTarget;
    const node = graph.node(id);
    if (!node)
        return;
    try {
        if (!file.type.startsWith(type + '/'))
            throw new Error(`Choose a supported ${type} file.`);
        const data = await fileDataURL(file), assetId = uid('asset'), asset = {
            id: assetId, name: file.name, mime: file.type, data
        };
        await media.asset(id, asset, type);
        graph.project.assets[assetId] = { name: asset.name, mime: asset.mime, data: asset.data };
        graph.update(id, 'assetId', assetId);
        inspector.render();
        toast(`${file.name} loaded locally.`);
    }
    catch (err) {
        toast(err.message, true);
    }
};
$('#resolution').onchange = e => {
    const [width, height] = e.target.value.split(',').map(Number);
    graph.transact('Change output resolution', () => Object.assign(graph.project.settings, { width, height }));
    engine.resetSimulation();
};
$('#duration').onchange = e => {
    const duration = Math.max(1, Math.min(3600, Number(e.target.value) || 20));
    graph.transact('Change timeline duration', () => graph.project.settings.duration = duration);
    time = Math.min(time, duration);
};
$('#fps').onchange = e => graph.transact('Change frame rate', () => graph.project.settings.fps = Number(e.target.value));
$('#timeline-scrub').oninput = e => {
    playing = false;
    updatePlay();
    seek(Number(e.target.value));
};
function updateTimeline() {
    const s = graph.project.settings, frame = Math.floor(time * s.fps), hours = Math.floor(time / 3600), minutes = Math.floor(time / 60) % 60, seconds = Math.floor(time) % 60, sub = frame % Math.round(s.fps);
    $('#timecode').textContent = [hours, minutes, seconds, sub].map(x => String(x).padStart(2, '0')).join(':');
    $('#frame-counter').textContent = `FRAME ${frame} / ${Math.round(s.duration * s.fps)}`;
    $('#timeline-scrub').value = time;
    $('#playhead').style.left = (time / s.duration * 100) + '%';
    $('#viewer-frame').textContent = `FRAME ${String(frame).padStart(5, '0')}`;
}
function drawKeys() {
    const c = $('#keyframe-canvas'), r = c.getBoundingClientRect();
    c.width = Math.max(1, r.width * devicePixelRatio);
    c.height = Math.max(1, r.height * devicePixelRatio);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    const n = current();
    if (!n)
        return;
    ctx.fillStyle = '#b497f7';
    for (const keys of Object.values(n.keyframes || {}))
        for (const key of keys) {
            const x = key.time / graph.project.settings.duration * c.width, y = c.height * .52, size = 3 * devicePixelRatio;
            ctx.beginPath();
            ctx.moveTo(x, y - size);
            ctx.lineTo(x + size, y);
            ctx.lineTo(x, y + size);
            ctx.lineTo(x - size, y);
            ctx.closePath();
            ctx.fill();
        }
}
function openPalette(clientX, clientY) {
    if (clientX !== undefined) {
        const r = graphEditor.host.getBoundingClientRect(), v = graphEditor.view;
        palettePosition = { x: (clientX - r.left - v.x) / v.zoom, y: (clientY - r.top - v.y) / v.zoom };
    }
    else
        palettePosition = graphEditor.center();
    $('#palette-search').value = '';
    paletteIndex = 0;
    renderPalette();
    $('#palette-dialog').showModal();
    setTimeout(() => $('#palette-search').focus(), 0);
}
function renderPalette() {
    const q = $('#palette-search').value.trim().toLowerCase();
    paletteItems = Object.entries(OPS).filter(([type, op]) => type !== 'component' && `${op.label} ${type} ${op.family}`.toLowerCase().includes(q)).map(([type, op]) => ({ type, label: op.label, family: op.family }));
    for (const c of Object.values(graph.project.components))
        if (c.name.toLowerCase().includes(q))
            paletteItems.push({ type: 'comp:' + c.id, label: c.name, family: 'COMP' });
    paletteIndex = Math.min(paletteIndex, Math.max(0, paletteItems.length - 1));
    $('#palette-results').innerHTML = paletteItems.map((p, i) => `<button class="palette-item ${i === paletteIndex ? 'active' : ''}" data-index="${i}" style="--op-color:${FAMILIES[p.family].color}"><span class="op-symbol">${SYMBOLS[p.type] || '◈'}</span><span>${esc(p.label)}</span><small>${p.family} / ${FAMILIES[p.family].name}</small></button>`).join('');
    $('#palette-results').querySelectorAll('button').forEach(b => b.onclick = () => choosePalette(Number(b.dataset.index)));
}
function choosePalette(i) {
    const item = paletteItems[i];
    if (!item)
        return;
    $('#palette-dialog').close();
    add(item.type, palettePosition.x, palettePosition.y);
}
$('#palette-search').oninput = () => {
    paletteIndex = 0;
    renderPalette();
};
$('#palette-search').onkeydown = e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        paletteIndex = (paletteIndex + (e.key === 'ArrowDown' ? 1 : -1) + paletteItems.length) % Math.max(1, paletteItems.length);
        renderPalette();
        $('#palette-results .active')?.scrollIntoView({ block: 'nearest' });
    }
    if (e.key === 'Enter') {
        e.preventDefault();
        choosePalette(paletteIndex);
    }
};
for (const dialog of document.querySelectorAll('dialog'))
    dialog.addEventListener('click', e => {
        if (e.target === dialog) {
            const r = dialog.getBoundingClientRect();
            if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
                dialog.close();
        }
    });
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => $('#' + b.dataset.close).close());
const MENUS = {
    file: [['New network', 'new', '⌘ N'], ['Open project…', 'open', '⌘ O'], ['Save locally', 'save', '⌘ S'], ['Download .flux project', 'download', ''], null, ['Export PNG snapshot', 'snapshot', ''], ['Export diagnostics', 'report', '']],
    edit: [['Undo', 'undo', '⌘ Z'], ['Redo', 'redo', '⇧ ⌘ Z'], null, ['Copy selected', 'copy', '⌘ C'], ['Paste operators', 'paste', '⌘ V'], ['Duplicate', 'duplicate', '⌘ D'], ['Delete', 'delete', '⌫'], null, ['Create component', 'group', '⌘ G']],
    operator: [['Add operator…', 'palette', 'Tab'], ['Set as project output', 'set-output', ''], ['Bypass selected', 'bypass', 'B'], null, ['Frame network', 'fit', 'H'], ['Arrange operators', 'layout', ''], ['Reset simulation', 'reset', '']],
    view: [['Second live viewer', 'split', ''], ['Parameters panel', 'parameters', 'P'], ['Performance monitor', 'performance', ''], ['Shader editor', 'shader', ''], null, ['Perform mode', 'perform', 'F1'], ['Fullscreen output', 'fullscreen', '']],
    node: [['View this operator', 'view-selected', ''], ['Set as project output', 'set-output', ''], ['Duplicate operator', 'duplicate', '⌘ D'], ['Bypass operator', 'bypass', 'B'], ['Group selection', 'group', '⌘ G'], null, ['Hide parameters', 'parameters', 'P'], ['Delete operator', 'delete', '⌫']]
};
function showMenu(name, anchor) {
    const menu = $('#menu-popover');
    if (!menu.classList.contains('hidden') && menu.dataset.menu === name) {
        menu.classList.add('hidden');
        return;
    }
    menu.dataset.menu = name;
    menu.innerHTML = MENUS[name].map(item => item ? `<button data-command="${item[1]}">${item[0]}<span>${item[2]}</span></button>` : '<hr>').join('');
    menu.classList.remove('hidden');
    const r = anchor.getBoundingClientRect();
    menu.style.left = Math.min(r.left, innerWidth - 225) + 'px';
    menu.style.top = Math.min(r.bottom + 5, innerHeight - menu.offsetHeight - 10) + 'px';
    menu.querySelectorAll('[data-command]').forEach(b => b.onclick = () => {
        menu.classList.add('hidden');
        run(b.dataset.command);
    });
}
document.querySelectorAll('[data-menu]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    showMenu(b.dataset.menu, b);
});
document.addEventListener('pointerdown', e => {
    if (!e.target.closest('.popover') && !e.target.closest('[data-menu]') && !e.target.closest('#selected-menu'))
        $('#menu-popover').classList.add('hidden');
});
function copy() {
    const selected = graph.selection;
    clipboard = { nodes: structuredClone(graph.network.nodes.filter(n => selected.has(n.id))), edges: structuredClone(graph.network.edges.filter(e => selected.has(e.from) && selected.has(e.to))) };
    toast(`${clipboard.nodes.length} operators copied.`);
}
function paste() {
    if (!clipboard?.nodes.length)
        return;
    const map = new Map(), copies = [], p = graphEditor.center(), minX = Math.min(...clipboard.nodes.map(n => n.x)), minY = Math.min(...clipboard.nodes.map(n => n.y));
    graph.transact('Paste operators', () => {
        for (const n of clipboard.nodes) {
            if (n.componentId && !graph.project.components[n.componentId])
                continue;
            const c = structuredClone(n);
            c.id = uid();
            c.name += '_copy';
            c.x = p.x + n.x - minX;
            c.y = p.y + n.y - minY;
            map.set(n.id, c.id);
            copies.push(c);
        }
        for (const n of copies)
            for (const [key, b] of Object.entries(n.bindings))
                if (map.has(b.node))
                    b.node = map.get(b.node);
                else if (!graph.node(b.node))
                    delete n.bindings[key];
        graph.network.nodes.push(...copies);
        graph.network.edges.push(...clipboard.edges.filter(e => map.has(e.from) && map.has(e.to)).map(e => ({
            ...e, id: uid('e'), from: map.get(e.from), to: map.get(e.to)
        })));
        flattenProject(graph.project);
    });
    graph.select(copies.map(n => n.id));
}
async function record() {
    if (recorder) {
        if (recorder.state === 'recording')
            recorder.stop();
        return;
    }
    if (!engine.ready)
        throw new Error('The GPU output is not ready.');
    if (typeof MediaRecorder === 'undefined')
        throw new Error('This browser does not support video recording. Use PNG export instead.');
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/mp4', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
    if (!mime)
        throw new Error('No supported recording encoder found.');
    const button = $('#record-button');
    button.disabled = true;
    let initial;
    try {
        initial = await engine.readPixels(engine.viewerId || engine.compiled.output);
    }
    finally {
        button.disabled = false;
    }
    // A 2D capture surface avoids browsers that produce header-only streams from
    // WebGPU swapchains. Readback is asynchronous, serial, and recording-only.
    const canvas = document.createElement('canvas'), staging = document.createElement('canvas');
    canvas.width = initial.width;
    canvas.height = initial.height;
    const context = canvas.getContext('2d'), stagingContext = staging.getContext('2d');
    if (!canvas.captureStream)
        throw new Error('Canvas video capture is unavailable in this browser.');
    context.putImageData(initial, 0, 0);
    const stream = canvas.captureStream(30), track = stream.getVideoTracks()[0];
    recordStream = stream;
    const chunks = [], active = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8000000 });
    const fileName = graph.project.name;
    recorder = active;
    let timer, frames = 0;
    const release = () => {
        clearTimeout(timer);
        stream.getTracks().forEach(t => t.stop());
        if (recorder === active) {
            recorder = null;
            recordStream = null;
            button.classList.remove('recording');
            button.innerHTML = '<span class="record-dot"></span> Record';
        }
        canvas.width = staging.width = 0;
    };
    active.ondataavailable = event => {
        if (event.data.size)
            chunks.push(event.data);
    };
    active.onstop = () => {
        const blob = new Blob(chunks, { type: mime });
        release();
        if (frames && blob.size > 256) {
            downloadBlob(blob, `${fileName}.${mime.includes('mp4') ? 'mp4' : 'webm'}`);
            toast(`Video exported from ${frames} captured GPU frames (video only).`);
        }
        else
            toast('The encoder returned no usable frames. Try another browser or PNG export.', true);
    };
    active.onerror = event => {
        toast(`Recording failed: ${event.error?.message || 'Encoder error'}`, true);
        if (active.state !== 'inactive')
            active.stop();
        else
            release();
    };
    const capture = async () => {
        if (active.state !== 'recording')
            return;
        const started = performance.now();
        try {
            const image = await engine.readPixels(engine.viewerId || engine.compiled.output);
            if (active.state !== 'recording')
                return;
            if (image.width === canvas.width && image.height === canvas.height)
                context.putImageData(image, 0, 0);
            else {
                staging.width = image.width;
                staging.height = image.height;
                stagingContext.putImageData(image, 0, 0);
                context.drawImage(staging, 0, 0, canvas.width, canvas.height);
            }
            track.requestFrame?.();
            frames++;
        }
        catch (error) {
            toast(`Capture stopped: ${error.message}`, true);
            if (active.state === 'recording')
                active.stop();
            return;
        }
        timer = setTimeout(capture, Math.max(1, 1000 / 30 - (performance.now() - started)));
    };
    active.start(500);
    timer = setTimeout(capture, 0);
    button.classList.add('recording');
    button.innerHTML = '<span class="record-dot"></span> Stop';
    toast('Recording at up to 30 fps. Capture adds GPU-readback overhead; audio is not included.');
}
async function run(action) {
    try {
        switch (action) {
            case 'new':
                await loadProject(emptyProject());
                break;
            case 'open':
                $('#project-file').click();
                break;
            case 'save':
                await saveNow();
                break;
            case 'download':
                exportProject(graph.project);
                toast('Project exported with shaders, animation, components, and embedded media.');
                break;
            case 'undo':
                graph.undo();
                break;
            case 'redo':
                graph.redo();
                break;
            case 'copy':
                copy();
                break;
            case 'paste':
                paste();
                break;
            case 'duplicate':
                graph.duplicate();
                break;
            case 'delete':
                graph.deleteSelected();
                break;
            case 'palette':
                openPalette();
                break;
            case 'fit':
                graphEditor.fit();
                break;
            case 'layout':
                graphEditor.layout();
                break;
            case 'zoom-in':
                graphEditor.zoom(1.2);
                break;
            case 'zoom-out':
                graphEditor.zoom(1 / 1.2);
                break;
            case 'group': {
                if (!graph.selection.size) {
                    toast('Select a connected group of operators first.', true);
                    break;
                }
                const name = prompt('Reusable component name', 'My component');
                if (name?.trim()) {
                    graph.groupSelection(name.trim());
                    toast('Component created. Add more instances from the library; double-click to edit.');
                }
                break;
            }
            case 'view-selected':
                if (current())
                    view(current().id);
                break;
            case 'set-output':
                if (current())
                    setOutput(current().id);
                break;
            case 'bypass':
                if (current())
                    graph.update(current().id, 'bypass', !current().bypass, null);
                break;
            case 'parameters':
                if (innerWidth <= 530)
                    $('.inspector').classList.toggle('mobile-visible');
                else
                    document.body.classList.toggle('inspector-hidden');
                break;
            case 'performance':
                setEditor('performance');
                break;
            case 'shader':
                setEditor('shader');
                break;
            case 'help':
                $('#help-dialog').showModal();
                break;
            case 'perform':
                document.body.classList.toggle('performing');
                toast(document.body.classList.contains('performing') ? 'Perform mode · press Escape or F1 to return.' : 'Returned to workspace.');
                break;
            case 'fullscreen':
                if (document.fullscreenElement)
                    await document.exitFullscreen();
                else
                    await $('#viewer-panel').requestFullscreen();
                break;
            case 'split':
                $('#viewer-stage').classList.toggle('split');
                break;
            case 'play':
                playing = !playing;
                updatePlay();
                break;
            case 'loop':
                graph.transact('Toggle playback loop', () => graph.project.settings.loop = !graph.project.settings.loop);
                break;
            case 'rewind':
            case 'reset':
                engine.resetSimulation();
                seek(0);
                break;
            case 'next':
                playing = false;
                updatePlay();
                seek(time + 1 / graph.project.settings.fps);
                break;
            case 'previous':
                playing = false;
                updatePlay();
                seek(time - 1 / graph.project.settings.fps);
                break;
            case 'snapshot':
                downloadBlob(await engine.snapshot(engine.viewerId || engine.compiled.output), `${graph.project.name}-${Math.round(time * graph.project.settings.fps)}.png`);
                toast('Full-resolution PNG exported.');
                break;
            case 'record':
                await record();
                break;
            case 'report': {
                const report = {
                    application: 'Fluxweave 1.0', created: new Date().toISOString(), project: graph.project.name, resolution: graph.project.settings, adapter: engine.adapterInfo ? { vendor: engine.adapterInfo.vendor, architecture: engine.adapterInfo.architecture, description: engine.adapterInfo.description } : null, frame: engine.frameNumber, stats: engine.stats, textures: engine.pool?.stats(), operators: engine.compiled?.nodes.map(n => {
                        const s = engine.states.get(n.id);
                        return {
                            id: n.id, name: n.name, type: n.type, cooks: s?.cooks || 0, cpuEncodeMs: s?.cpuMs || 0, error: s?.error
                        };
                    }), logs: engine.logs
                };
                downloadBlob(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), 'fluxweave-diagnostics.json');
                break;
            }
        }
    }
    catch (e) {
        toast(e.message, true);
    }
}
document.querySelectorAll('[data-action]').forEach(b => b.addEventListener('click', () => run(b.dataset.action)));
document.querySelectorAll('[data-editor]').forEach(b => b.onclick = () => setEditor(b.dataset.editor));
let shaderNode = null, shaderDirty = false;
function refreshShader() {
    const n = current();
    if (n?.type !== 'shader') {
        if (!shaderDirty) {
            shaderNode = null;
            $('#shader-name').textContent = 'WGSL fragment shader';
            $('#shader-state').textContent = 'Select a Shader operator';
            $('#shader-compile').disabled = true;
        }
        return;
    }
    if (shaderNode !== n.id || !shaderDirty) {
        shaderNode = n.id;
        $('#shader-source').value = n.params.code;
        shaderDirty = false;
        updateLines();
    }
    $('#shader-name').textContent = `${n.name}.wgsl`;
    $('#shader-state').textContent = 'Live fragment program';
    $('#shader-compile').disabled = !engine.ready;
    const s = engine.states.get(engine.resolve(n.id, graph.active));
    if (s?.diagnostics?.some(m => m.type === 'error')) {
        showDiagnostics(s.diagnostics);
    }
}
function updateLines() {
    $('#line-numbers').textContent = Array.from({ length: $('#shader-source').value.split('\n').length }, (_, i) => i + 1).join('\n');
}
function showDiagnostics(messages) {
    const el = $('#shader-diagnostics');
    el.classList.toggle('error', messages.some(m => m.type === 'error'));
    el.textContent = messages.length ? messages.map(m => `${m.type.toUpperCase()} · line ${m.line}:${m.column}\n${m.message}`).join('\n') : '✓ Shader compiled successfully. The new pipeline is live.';
}
$('#shader-source').addEventListener('input', () => {
    shaderDirty = true;
    $('#shader-state').textContent = 'Uncompiled changes';
    updateLines();
});
$('#shader-source').addEventListener('scroll', e => $('#line-numbers').scrollTop = e.target.scrollTop);
$('#shader-source').addEventListener('keydown', e => {
    if (e.key === 'Tab') {
        e.preventDefault();
        const el = e.target;
        el.setRangeText('  ', el.selectionStart, el.selectionEnd, 'end');
        shaderDirty = true;
        updateLines();
    }
});
$('#shader-create').onclick = () => {
    const n = add('shader');
    if (n) {
        shaderDirty = false;
        refreshShader();
        $('#shader-source').focus();
    }
};
async function compileCurrent() {
    const n = graph.node(shaderNode);
    if (!n || n.type !== 'shader')
        return;
    if (!engine.ready) {
        toast('WebGPU is required to compile WGSL.', true);
        return;
    }
    const code = $('#shader-source').value;
    $('#shader-state').textContent = 'Compiling…';
    $('#shader-compile').disabled = true;
    try {
        const result = await engine.compileShader(code);
        showDiagnostics(result.messages);
        if (result.pipeline) {
            graph.update(n.id, 'code', code);
            shaderDirty = false;
            $('#shader-state').textContent = 'Compiled ✓';
            toast('WGSL pipeline replaced successfully.');
        }
        else
            $('#shader-state').textContent = 'Compilation failed';
    }
    catch (e) {
        showDiagnostics([{
                type: 'error', line: 1, column: 1, message: e.message
            }]);
    }
    finally {
        $('#shader-compile').disabled = false;
    }
}
$('#shader-compile').onclick = compileCurrent;
document.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey, isField = e.target.matches('input,textarea,select') || e.target.isContentEditable;
    if (mod && e.key === 'Enter' && editorTab === 'shader') {
        e.preventDefault();
        compileCurrent();
        return;
    }
    if (e.key === 'Escape') {
        document.body.classList.remove('performing');
        $('.inspector').classList.remove('mobile-visible');
        $('#menu-popover').classList.add('hidden');
        return;
    }
    if ($('dialog[open]'))
        return;
    if (mod && ['s', 'o', 'k'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        run({ s: e.shiftKey ? 'download' : 'save', o: 'open', k: 'palette' }[e.key.toLowerCase()]);
        return;
    }
    if (isField)
        return;
    if (mod) {
        const action = {
            z: e.shiftKey ? 'redo' : 'undo', y: 'redo', d: 'duplicate', c: 'copy', v: 'paste', g: 'group', a: 'selectall', n: 'new'
        }[e.key.toLowerCase()];
        if (action) {
            e.preventDefault();
            if (action === 'selectall')
                graph.select(graph.network.nodes.map(n => n.id));
            else
                run(action);
        }
        return;
    }
    const command = {
        Tab: 'palette', ' ': 'play', h: 'fit', H: 'fit', p: 'parameters', P: 'parameters', b: 'bypass', B: 'bypass', Delete: 'delete', Backspace: 'delete', F1: 'perform', ArrowRight: 'next', ArrowLeft: 'previous'
    }[e.key];
    if (command) {
        e.preventDefault();
        run(command);
    }
});
$('#horizontal-splitter').addEventListener('pointerdown', e => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const container = $('.center').getBoundingClientRect();
    const move = ev => {
        const ratio = Math.max(.25, Math.min(.73, (ev.clientY - container.top) / container.height));
        document.documentElement.style.setProperty('--viewer-height', ratio * 100 + '%');
    };
    const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        graphEditor.updateWatch();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
});
// Dragging a geometry output orbits the nearest active Render operator.
$('#output-canvas').addEventListener('pointerdown', e => {
    const renders = graph.project.nodes.filter(n => n.type === 'render');
    if (!renders.length)
        return;
    const n = renders[0], start = {
        x: e.clientX, y: e.clientY, yaw: n.params.yaw, pitch: n.params.pitch
    };
    const canvas = e.currentTarget;
    canvas.setPointerCapture(e.pointerId);
    const move = ev => {
        if (graph.active)
            return;
        graph.update(n.id, 'yaw', Math.max(-180, Math.min(180, start.yaw + (ev.clientX - start.x) * .35)));
        graph.update(n.id, 'pitch', Math.max(-80, Math.min(80, start.pitch + (ev.clientY - start.y) * .35)));
    };
    const up = () => {
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', up);
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
});
function updateScope() {
    const canvas = $('#scope-canvas'), r = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    if (canvas.width !== Math.round(r.width * dpr) || canvas.height !== Math.round(r.height * dpr)) {
        canvas.width = Math.round(r.width * dpr);
        canvas.height = Math.round(r.height * dpr);
    }
    const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#27323b';
    ctx.lineWidth = 1;
    for (let i = 1; i < 6; i++) {
        ctx.beginPath();
        ctx.moveTo(i * w / 6, 0);
        ctx.lineTo(i * w / 6, h);
        ctx.moveTo(0, i * h / 6);
        ctx.lineTo(w, i * h / 6);
        ctx.stroke();
    }
    let signals = graph.network.nodes.filter(n => definition(n, graph.project).output === 'signal');
    const selected = current();
    if (selected && definition(selected, graph.project).output === 'signal')
        signals = [selected, ...signals.filter(n => n !== selected)];
    signals = signals.slice(0, 3);
    const colors = ['#a7d989', '#b69be9', '#6fc5d7'];
    let legend = '';
    signals.forEach((n, i) => {
        const s = engine.states.get(engine.resolve(n.id, graph.active))?.data;
        if (!s)
            return;
        const max = Math.max(1, ...s.samples.map(Math.abs));
        ctx.strokeStyle = colors[i];
        ctx.lineWidth = 1.4 * dpr;
        ctx.beginPath();
        s.samples.forEach((v, j) => {
            const x = j / 127 * w, y = h * .55 - v / max * h * .33;
            j ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        });
        ctx.stroke();
        legend += `<span><i style="background:${colors[i]}"></i>${esc(n.name)} ${s.value.toFixed(3)}</span>`;
    });
    $('#scope-legend').innerHTML = legend || '<span>No active signal channels</span>';
}
function updatePerformance() {
    const s = engine.stats, pool = engine.pool?.stats();
    $('#perf-cpu').textContent = s.cpuMs.toFixed(2) + ' ms';
    $('#perf-memory').textContent = ((pool?.bytes || 0) / 1048576).toFixed(1) + ' MB';
    $('#perf-passes').textContent = `${s.passes} / ${s.compute}`;
    $('#perf-cached').textContent = `${s.cached} / ${s.cached + s.cooked}`;
    $('#performance-rows').innerHTML = (engine.compiled?.nodes || []).map(n => {
        const state = engine.states.get(n.id);
        return `<div class="perf-row ${state?.error ? 'error' : ''}"><span>${esc(n.name)}</span><span>${OPS[n.type].family}</span><span>${state?.cooks || 0}</span><span>${(state?.cpuMs || 0).toFixed(3)} ms</span><span>${state?.error ? 'error' : state?.data ? 'ready' : 'not demanded'}</span></div>`;
    }).join('');
    $('#engine-log').textContent = engine.logs.map(l => `[${l.time}] ${l.level.toUpperCase()} ${l.message}`).join('\n');
}
engine.addEventListener('log', e => {
    if (e.detail.level === 'error')
        $('#status-message').textContent = e.detail.message;
    if (editorTab === 'performance')
        updatePerformance();
});
engine.addEventListener('lost', () => {
    $('#engine-overlay').classList.remove('hidden');
    $('#engine-overlay').innerHTML = '<h2>GPU device disconnected.</h2><p>Your project remains in the editor. Save it, then reload to rebuild GPU resources.</p>';
});
window.addEventListener('error', e => toast(`Application error: ${e.message}`, true));
window.addEventListener('unhandledrejection', e => toast(`Operation failed: ${e.reason?.message || e.reason}`, true));
window.addEventListener('resize', () => drawKeys());
document.addEventListener('visibilitychange', () => {
    lastNow = performance.now();
    if (document.hidden)
        media.syncPlayback(false);
    else
        media.syncPlayback(playing);
});
window.addEventListener('beforeunload', () => {
    for (const id of [...media.sources.keys()])
        media.stop(id);
    recordStream?.getTracks().forEach(t => t.stop());
});
engine.setGraph(graph.project);
engine.viewerId = engine.compiled.output;
updateProjectUI();
const first = graph.project.nodes.find(n => n.type === 'noise' || n.type === 'particles' || n.type === 'render' || n.type === 'shader') || graph.project.nodes[0];
if (first)
    graph.select([first.id]);
requestAnimationFrame(() => graphEditor.fit());
updatePlay();
function animate(now) {
    requestAnimationFrame(animate);
    const delta = Math.min(.1, (now - lastNow) / 1000);
    lastNow = now;
    if (document.hidden)
        return;
    if (playing) {
        time += delta;
        const duration = graph.project.settings.duration;
        if (time >= duration) {
            if (graph.project.settings.loop) {
                time %= duration;
                engine.resetSimulation();
                lastRenderTime = time;
            }
            else {
                time = duration;
                playing = false;
                updatePlay();
            }
        }
    }
    if (engine.ready && now - lastEncode >= 1000 / graph.project.settings.fps - .5) {
        const dt = Math.max(0, Math.min(.05, time - lastRenderTime));
        if (engine.frame(time, dt, playing))
            lastRenderTime = time;
        lastEncode = now;
    }
    if (now - lastStats > 250) {
        const frames = engine.frameNumber - lastFrames, fps = frames * 1000 / (now - lastStats);
        displayFPS = displayFPS ? displayFPS * .55 + fps * .45 : fps;
        lastFrames = engine.frameNumber;
        lastStats = now;
        $('#viewer-fps').textContent = `${displayFPS.toFixed(0)} FPS`;
        $('#status-fps').textContent = `${displayFPS.toFixed(1)} fps`;
        $('#status-memory').textContent = `${((engine.pool?.bytes || 0) / 1048576).toFixed(1)} MB`;
        updateTimeline();
        graphEditor.scopes();
        inspector.refresh();
        updateScope();
        if (editorTab === 'performance')
            updatePerformance();
        drawKeys();
    }
}
requestAnimationFrame(animate);
try {
    await engine.init();
    engine.attachView($('#output-canvas'), () => engine.viewerId || engine.compiled?.output);
    engine.attachView($('#secondary-canvas'), () => {
        const n = current();
        return n ? engine.resolve(n.id, graph.active) : engine.compiled?.output;
    });
    graphEditor.attachPreviews();
    graphEditor.updateWatch();
    $('#engine-overlay').classList.add('hidden');
    $('#engine-backend').textContent = 'WebGPU';
    $('#engine-dot').classList.add('ready');
    $('#adapter-name').textContent = engine.adapterInfo?.description || engine.adapterInfo?.architecture || 'GPU accelerated';
    refreshShader();
    await restoreAssets();
}
catch (e) {
    $('#engine-overlay').innerHTML = `<h2>WebGPU is unavailable.</h2><p>${esc(e.message)}</p><p>The network editor, parameters, undo/redo, and project files remain available. GPU rendering and WGSL compilation require WebGPU.</p>`;
    $('#engine-backend').textContent = 'GPU unavailable';
    $('#adapter-name').textContent = 'graph editing available';
    toast(e.message, true);
}
