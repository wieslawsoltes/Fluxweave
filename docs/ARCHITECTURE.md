# Fluxweave engine architecture

## Source map

```text
index.html                  Workstation shell and semantic controls
style.css                   Dark workspace, panels, node graph, responsive layout
serve.mjs                   Optional dependency-free local HTTP server
src/app.js                  Application orchestration, transport, commands, persistence
src/core/operators.js       Typed operator registry, schemas, animation evaluation
src/core/graph.js           Transactions, history, validation, components, compilation
src/core/math.js            Matrix math and indexed geometry generation
src/core/media.js           Decoded assets, camera capture and audio analysis
src/core/persistence.js     IndexedDB and versioned project import/export
src/core/presets.js         Five executable starter networks
src/gpu/shaders.js          WGSL effect, mesh, presentation and particle programs
src/gpu/pool.js             Texture ownership, reuse, accounting and budget enforcement
src/gpu/engine.js           Demand scheduling, render/compute passes and GPU resources
src/ui/graph-editor.js      Pointer editing, typed wires, viewport and live thumbnails
src/ui/inspector.js         Schema-generated parameters, bindings, animation and media UI
examples/*.flux             Importable example projects
tests/core.test.mjs        Dependency-free correctness suite
tests/browser_smoke.py     Real GPU/browser integration suite
```

## Document and runtime separation

The serializable document contains only data: node IDs/types, parameters, keyframes, numeric bindings, typed edges, component definitions, assets, viewport and project settings. A schema version identifies the `.flux` format. Browser media objects, audio nodes, GPU devices, textures, pipelines and buffers are never placed in the document.

Graph changes occur inside a transaction. The previous structural snapshot is retained, the mutation is applied, and structural edits are expanded and validated before change notifications. Failure restores the previous document. Undo/redo retains up to 80 operations and merges continuous parameter changes within a 500 ms window. Embedded asset data is excluded from each history snapshot and retained in the project asset table, avoiding repeated copies of large media strings. Unreferenced embedded assets remain until a new project is loaded; this favors safe undo over aggressive asset garbage collection.

Import validates schema version, safe identifiers, known operators, finite coordinates/numbers, parameter options, animation tracks, bindings, connections, asset data URLs, resolution and expansion limits. It rejects multiple sources for one input, missing references and unbroken cycles. Root documents are limited to 2,000 nodes, stored definitions and root nodes together to 4,000, and expanded runtime nodes to 8,000. These are safety caps, not measured interactive-performance guarantees.

## Typed graph compilation

Each operator declares a family, output type, ordered input ports, parameter schema and optional temporal/media behavior. Three runtime payload types exist:

- **Texture:** a pooled GPU texture record and view.
- **Geometry:** indexed vertex data plus a model transform; uploaded buffers are shared by matching geometry data.
- **Signal:** a numeric value and scope samples, with audio-band data when applicable.

Connections carry the source output to a numbered destination input. Disconnected inputs keep their positions, including the second texture slot of a composite or custom shader. Numeric parameter bindings are additional dependency edges; they do not bypass cycle detection.

Components are expanded recursively. Every instance prefixes its internal runtime IDs with its instance path. The compiler remaps input boundary targets, output aliases, internal edges and bindings, detects recursion and creates a topological order. Shared definitions therefore remain compact in the document while stateful operators receive independent runtime identities and GPU resources.

Component interfaces are currently single-output. A grouped selection must have only one externally visible source output, and cross-boundary explicit parameter bindings are rejected with an actionable message. Imported component boundary endpoints are checked during expansion. The raw graph's conservative cycle check may reject a cycle whose only delay is hidden inside a different component; putting the delay at the connecting graph level makes the boundary explicit.

## Demand-driven evaluation

The current project output, pinned viewer and visible graph thumbnails are demand roots. Their input and parameter-binding dependencies form the demanded subgraph. The engine walks the precomputed topological order and ignores nodes not demanded.

Each runtime state stores a revision, prior evaluation signature, payload, allocation ownership, cook count, error and last CPU encoding duration. The signature includes evaluated parameter values, ordered input revisions, binding revisions, temporal dependency, media revision/frame identity, bypass state and render dimensions. Unchanged signatures retain the prior payload without encoding another effect pass. An upstream cook increments its revision, naturally invalidating downstream signatures.

Keyframes are evaluated at the timeline's current time. Linear, smoothstep and held/stepped interpolation are available, with endpoint clamping. Numeric signal bindings then override keyed values using gain and offset. Schema clamping happens last. Integer parameters are rounded before operators use them.

The implementation uses serialized signatures for clarity and correctness. For substantially larger networks, replacing JSON signature materialization with schema-specific packed comparisons is a straightforward optimization; the present code does not claim a zero-allocation scheduler. Structural compilation is synchronous on the main thread, not worker-based.

## Frame execution and backpressure

A submitted frame uses one command encoder. The sequence is:

1. Evaluate demanded signal and geometry operators and encode changed texture/render/compute operators.
2. Capture feedback inputs into next-frame history textures after all ordinary evaluation passes.
3. Render demanded geometry previews not already cached at their current revision.
4. Encode presentations into the primary, secondary and eligible thumbnail swapchains.
5. Submit the command buffer to the WebGPU queue.

Particles are updated by a compute pass before their draw pass in the same command stream. Each invocation owns one particle record, eliminating cross-invocation read/write races for the current independent-particle model. Submission order and render-pass resource usage establish the required GPU dependencies; no CPU texture readback is used for normal presentation.

At most two submitted frames are outstanding according to `queue.onSubmittedWorkDone()`. When the queue is backed up, the application skips another submission rather than building an unbounded queue. Delta time advances from the previous accepted submission and is clamped to protect stateful simulations. Timeline-driven analytic effects still use absolute timeline seconds.

Visible thumbnail presentations are amortized across frames; their demanded operators can still cook each animated frame. The primary viewer is presented at the configured target rate. The performance UI's FPS is actual accepted frame submissions per wall-clock interval, not a GPU-timing query. Render-pass counts cover operator/geometry passes, not presentation blits.

## GPU memory and texture lifetime

All standard effects render into `rgba8unorm`. Texture records track dimensions, format, usage, view and estimated allocation bytes. The pool indexes compatible released textures by those attributes. A live cached output is never borrowed as another operator's writable target. Output/bypass aliases do not acquire texture ownership, and releasing a node only releases allocations it owns.

The default 256 MB pool budget covers live and cached textures. Released allocations are evicted when necessary to admit a new allocation. If live allocations alone exceed the budget, evaluation reports a clear resource error instead of destroying a still-referenced output. Depth textures use `depth32float`; both supported formats are accounted at four bytes per pixel. This is texture allocation accounting, not total driver VRAM usage: buffers, swapchains, pipeline memory and browser internals are additional.

Persistent per-node uniform buffers avoid a single overwritten uniform range shared between passes. Standard texture uniforms occupy 112 bytes, seven aligned `vec4f` fields. Bind groups are cached against pipeline/layout, uniform allocation and source views. Mesh vertex/index buffers are cached by geometry-array identity and retired after an idle frame threshold. Geometry transforms reuse the underlying mesh data.

Resolution changes release incompatible allocations and create or reuse correctly sized targets. Buffer/texture destruction uses WebGPU's resource lifetime rules; it does not require a CPU blocking wait before every graph edit. GPU state is rebuilt rather than serialized.

## Strict feedback semantics

A Feedback node's input edge is excluded only from **same-frame topological ordering**; it is retained for demand reachability and end-of-frame capture. The node owns its transformed output and two alternating history textures.

At frame N, it samples history from N−1, applies decay and the feedback transform, and exposes that output to ordinary downstream effects. After all demanded ordinary nodes have finished encoding, the engine copies its connected source into the alternate history texture for frame N+1. This separation avoids binding the same texture for reading and attachment writing in one pass and supports intentional root-level graph cycles.

First history contents are zero-initialized by WebGPU. Reset releases and recreates histories. A paused, unchanged frame reuses the result rather than repeatedly accumulating feedback. Backward seeks and loop wrap reset live simulation; the engine does not maintain a historical simulation cache or replay from time zero automatically.

## Geometry and particles

Torus, sphere, box and grid generate finite indexed triangle meshes with position, normal and UV attributes (32-byte interleaved stride) and 32-bit indices. The geometry transform carries a model matrix rather than baking every transformed vertex. The renderer uses a zero-to-one perspective depth range, a depth attachment, material texture/color, analytic lighting, roughness/metallic controls and GPU instancing. It is a compact visual renderer, not a full CAD or physically based scene engine.

Particles are a GPU storage array of 32-byte position/lifetime and velocity/state records. Workgroups contain 256 invocations. A hash-seeded initialization, analytic flow field, integration and respawn happen in WGSL. Rendering expands each particle into a six-vertex camera-facing quad using the storage buffer directly. The supported count is 1,024 through 131,072; the starter uses 32,768. No per-frame particle positions are read back to JavaScript.

## Shader compiler and diagnostics

The fragment contract supplies a fullscreen vertex stage, uniform block, sampler, two input textures and utility functions. The edited `effect(uv)` function is appended between the shared prelude and a fixed fragment entry point.

`GPUShaderModule.getCompilationInfo()` yields source diagnostics; the engine adjusts line numbers to the user-editable segment. Creation of a render pipeline is asynchronous and protected by a validation error scope. Valid pipelines are cached with a bounded cache and a serialized compile queue. The UI applies valid edits atomically; invalid source retains the prior active pipeline. Source imported from a file may also fail compilation without destroying the last valid output.

The shader interface exposes GPU shading, not JavaScript execution. User code cannot directly access DOM objects or operating-system resources through WGSL. Resource and loop cost still depend on the submitted shader; there is no application-specific static execution-time proof or GPU workload quota.

## Media and persistence

Decoded images and videos use `copyExternalImageToTexture`; video frame identity participates in invalidation. Web Audio remains on the audio subsystem, and only numeric analysis results enter the operator graph. Camera/microphone startup is explicit and tracks are stopped on user stop or operator deletion. Local media is embedded as validated data URLs for portable project exports. Audio resumption after reload requires user activation.

IndexedDB stores the current project; debounced saves are serialized to avoid stale writes completing after newer saves. Exported `.flux` files carry the same schema. Browser storage errors are surfaced instead of reporting a successful save. PNG export and video capture are the exceptional GPU readback paths: rows are padded to WebGPU's copy alignment, mapped asynchronously and compacted into ImageData. PNG export encodes that data as an image. Video capture serializes these asynchronous readbacks into a dedicated 2D capture canvas before MediaRecorder encoding, avoiding browsers that yield header-only streams from a WebGPU swapchain. The capture surface is fixed at its initial resolution, targets at most 30 frames per second and includes no audio track. GPU-to-CPU copies are limited to explicit export/recording operations, not normal presentation.

## Extending the engine

To add an operator, define its ports and parameter schema in `operators.js`, provide a WGSL effect or a typed CPU evaluator, wire its uniform packing/evaluation in `engine.js`, and add its icon in `graph-editor.js`. The registry drives the library, palette and inspector. Add scheduling/type/import tests and a browser pixel or state test before extending a starter network.

For higher-throughput production work, natural next extensions include packed parameter/revision comparisons, worker-based document compilation and geometry generation, dynamic-resolution thumbnails, multi-resolution bloom, explicit HDR/color-space handling, a general custom compute-node contract and deterministic simulation replay. Those are extension points, not features claimed by this release.
