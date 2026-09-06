# Fluxweave

**Connect ideas. Make them move.**

**[Launch Fluxweave](https://wieslawsoltes.github.io/Fluxweave/)** · [Source repository](https://github.com/wieslawsoltes/Fluxweave)

A runnable, independent procedural visual-programming workstation built with plain HTML, CSS, JavaScript modules, WebGPU and Web Audio. The interface follows the familiar operator-library / network-editor / parameter-pane / live-viewer workflow, with original branding and assets.

This is executable source, not a UI prototype: operator connections compile into a typed dependency graph, texture effects run as WebGPU render passes, particles run in a GPU compute shader, and editing changes the actual output.

## Run

From this directory:

```sh
npm start
```

Open **http://localhost:8080**. Node.js 20 or later is sufficient. There are **no npm dependencies and no build step**; `npm install` is not required.

Alternatively, serve these same files with Python:

```sh
python3 -m http.server 8080
```

Use a browser with an available WebGPU adapter and hardware acceleration. HTTPS or localhost is required for GPU/media APIs. Opening `index.html` directly through `file://` is not supported. The editor remains accessible when WebGPU initialization fails, but there is deliberately no fallback that pretends to render the GPU network.

For static hosting, publish this directory to any HTTPS static host. All application imports are relative, including when hosted under a repository subdirectory. No API keys, server-side rendering, CDN scripts or application accounts are required.

## GitHub Pages

Every push to `main` runs the core tests, verifies the source manifest, packages only the static application into `_site/`, and deploys it to GitHub Pages. The workflow can also be started manually from the Actions tab. There is no runtime build toolchain or dependency installation.

The deployed `version.json` identifies the exact published commit. Application modules and example paths are relative so the editor works under `/Fluxweave/`. GitHub Pages provides the HTTPS context required by WebGPU and permission-gated media capture.

## Included networks

The application starts with **Chromatic currents**, a ten-operator procedural texture network with signal modulation and delayed feedback. Other starter networks are available in the left panel and as editable `.flux` files in `examples/`.

| Starter | Demonstrates |
| --- | --- |
| Chromatic currents | Warped noise, displacement, kaleidoscope, color correction, feedback and bloom |
| Orbital matter | 32,768 GPU-computed particles, trails and bloom |
| Sculpted light | Indexed torus geometry, transforms, texture material and depth-tested rendering |
| Resonant field | Audio analysis driving texture and glow parameters; microphone, local audio or a test tone |
| Interference study | Editable WGSL fragment shader with compiler diagnostics |

## Operator library

There are **31 operator types**, including reusable component instances:

| Family | Operators |
| --- | --- |
| Texture / TOP, 20 | Noise, Ramp, Constant, Shape, Checker, Transform, Displace, Kaleidoscope, Blur, Bloom, Level, Composite, Edge, Feedback, WGSL Shader, Image File, Movie File, Camera In, Render, Output |
| Channels / CHOP, 4 | LFO, Constant Value, Math, Audio In |
| Geometry / SOP, 5 | Torus, Sphere, Box, Grid, Geometry Transform |
| Particles / POP, 1 | GPU Particles |
| Components / COMP, 1 | Shared reusable subgraph instance |

Purple ports carry textures, green ports carry numeric channels, and blue ports carry geometry. Connections and numeric-parameter bindings are type checked. Ordinary same-frame cycles are rejected atomically; a Feedback operator explicitly crosses the frame boundary.

## Working in the editor

Press **Tab** to open the searchable operator palette. Drag from a right-side output port to a compatible left-side input. An existing input can be rewired by dragging its connector. Click a wire, or Alt-click a connected input, to disconnect it. Select a node to edit its parameters; double-click it to pin its result in the viewer. A geometry output is previewed using the mesh renderer; numeric outputs appear as live channel scopes.

Drag the background to pan and scroll to zoom around the pointer. Shift-drag the background to select a rectangle. Drag a selected node to move the selection. **H** frames the graph. The top-center output panel can be split into a pinned output and a selected-node viewer. **Perform** hides the editor; the fullscreen control requests browser fullscreen.

The performance tab reports actual CPU command-encoding time, render and compute passes, cache retention, texture-pool allocations, node cook counts and engine errors. CPU timing is explicitly **not GPU execution timing**. PNG snapshots read back the selected GPU texture at its native resolution. Video recording asynchronously reads the selected GPU output into a dedicated 2D capture surface and encodes it using the browser's supported MediaRecorder format. It targets up to 30 frames per second, adds recording-only GPU-readback overhead, and records video without audio. Normal live rendering does not use this readback path.

### Animation and channel binding

Pause playback, select an operator and click the diamond beside a numeric parameter to create a keyframe. Move the playhead and edit that parameter: an existing track automatically gains a key at the current time. The Animation tab lets you jump to keys, remove them and choose linear, smooth or stepped interpolation. The timeline displays keys for the selected operator.

The link control beside a numeric parameter binds a channel with a multiplier and offset. A binding takes precedence over its keyframe track. Numeric values are clamped to the receiving parameter's schema before GPU use. Binding dependencies participate in cycle checking and cache invalidation.

### Reusable components

Select operators with one externally visible output and choose **Create component**, or press **Ctrl/Cmd+G**. Incoming wires become typed component inputs; the outgoing endpoint becomes its output. The component appears in the operator library and can be instantiated repeatedly.

Double-click an instance to edit its shared definition. All instances see those edits, but each expansion has its own runtime IDs, output textures, feedback history and particle buffers. The breadcrumb returns to the root network. Use **Set as project output** from inside a component to designate a replacement component output of the same declared type.

Components currently expose one output and inferred typed inputs, rather than a full custom parameter-interface designer. Boundary endpoint deletion is protected. Explicit numeric bindings crossing a proposed grouping boundary must first be moved inside the selection or replaced with typed signal wires. Cross-component feedback boundaries are validated conservatively; explicit root-level Feedback nodes and feedback contained inside a component are supported.

### Media and audio

Select Image File or Movie File and choose a local file. Assets are embedded in project exports and restored from local saves. Decoded image/video frames are uploaded directly to GPU textures. Supported codecs depend on the browser. Camera In and Audio In request permission only after their corresponding enable controls are pressed. **Stop source** releases capture tracks and audio nodes. Deleting the source operator also releases them.

Audio In supports microphone, a local audio file and a built-in modulated test tone. Its Web Audio analyser computes RMS and bass/mid/high bands. Use the audio starter and press **Test tone** for an immediately testable audio-reactive network. Embedded audio requires a new user gesture after project restoration. Camera and microphone permissions are never serialized into a project.

### Saving

**Ctrl/Cmd+S** saves the project locally in IndexedDB. Edits also trigger a debounced autosave. **Ctrl/Cmd+Shift+S** exports a `.flux` project, and **Ctrl/Cmd+O** imports one. The project includes nodes, wires, settings, components, shader sources, keyframes, bindings and imported media. Live GPU buffers and camera/microphone sessions are reconstructed rather than persisted.

Projects and media stay in the browser or the files you explicitly export. The application has no telemetry or remote upload endpoint. Local browser storage is not a backup: export important projects. Individual imported assets are limited to 64 MB, total project-file import to 100 MB, and encoded embedded assets to the validated schema limits.

### Keyboard reference

| Action | Shortcut |
| --- | --- |
| Play/pause | Space |
| Add operator | Tab or Ctrl/Cmd+K |
| Frame all / parameters pane / bypass selection | H / P / B |
| Save locally / export project / open project | Ctrl/Cmd+S / Ctrl/Cmd+Shift+S / Ctrl/Cmd+O |
| Undo / redo | Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z |
| Copy / paste / duplicate | Ctrl/Cmd+C / Ctrl/Cmd+V / Ctrl/Cmd+D |
| Group selection / select all | Ctrl/Cmd+G / Ctrl/Cmd+A |
| Delete selection | Delete or Backspace |
| Previous / next frame | Left / Right arrow |
| Compile WGSL | Ctrl/Cmd+Enter in the shader editor |
| Perform / leave perform | F1 / Escape |

## Shader programming

A Shader operator accepts two texture inputs and one numeric modulation input. Edit a complete WGSL function named `effect`, then choose **Compile & apply**:

```wgsl
fn effect(uv: vec2f) -> vec4f {
    let aspect = u.frame.x / u.frame.y;
    let p = (uv - 0.5) * vec2f(aspect, 1.0);
    let t = u.frame.z * u.p0.y;
    let wave = 0.5 + 0.5 * sin(length(p) * 18.0 - t * 3.0);
    let modulation = u.extra.y;
    let generated = palette(wave + 0.2 * modulation);
    let source = textureSample(srcA, samp, uv).rgb;
    return vec4f(mix(generated, source, u.p0.x), 1.0);
}
```

The engine supplies `srcA`, `srcB`, `samp`, `palette(t)`, `fbm(p, octaves)` and the `u` uniform block. `u.frame` is `(width, height, timelineSeconds, deltaSeconds)`; `u.p0` is `(sourceMix, speed, scale, 0)`; `u.extra.y` is the modulation input. Sampling a disconnected texture input returns the engine's black texture. Do not redeclare the supplied bindings or entry points.

Pipeline compilation is asynchronous. Diagnostics report positions relative to your edited source. A rejected edit does not replace the active pipeline. This editor is for fragment operators; the built-in particle compute program is ordinary editable source in `src/gpu/shaders.js`, not a general runtime compute-node editor.

## Engineering documentation and tests

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for scheduling, resource lifetime, feedback, caching and extension points. [TESTING.md](docs/TESTING.md) describes automated coverage, actual test results and the remaining device-dependent checks.

```sh
npm test
```

The unit suite uses Node's built-in test runner. Browser integration tests additionally require Python Playwright and a WebGPU-capable browser; they are not runtime dependencies.

```sh
python -m pip install playwright
python -m playwright install chromium
# Keep npm start running in another terminal.
python tests/browser_smoke.py --url http://localhost:8080
```

A browser installed by Playwright still needs an available GPU adapter. The test script also documents a Linux software-GPU / Xvfb mode.

## Scope and limits

This release implements the workflows above, but is **not full TouchDesigner feature parity**, does not load `.toe` files, and is not affiliated with Derivative. It uses its own versioned `.flux` format and original artwork.

The texture pipeline is RGBA8/LDR with one project-wide resolution. It does not implement HDR color management, multipass PBR, a full modeling kernel, arbitrary Python scripting, MIDI/OSC/NDI/Spout/Syphon interoperability or external multi-machine output. The editable shader interface is WGSL fragment shading, not GLSL compatibility.

GPU state is live: backward seeking and timeline loops reset feedback and particles rather than replaying all historical simulation frames. Texture allocations have a 256 MB default budget; previews are also demand roots and consume resources. Device loss is surfaced with a save/reload recovery message. Performance depends on GPU, resolution, node count, effect cost and active previews; no unmeasured frame-rate claim is made.

Automated tests validate real WebGPU execution using a software adapter, not desktop-GPU throughput. Physical camera/microphone capture, OS permission dialogs, fullscreen behavior, cross-browser codec variation and long recording sessions remain hardware/browser acceptance tests.

## License

MIT. See [LICENSE](LICENSE). No third-party runtime code, fonts, trademarks or product assets are bundled.
