# Verification

## Recorded automated run

Tested on 6 September 2026 with Node.js 22.16.0 and Chromium 144.0.7559.96. The graphics integration run used Chromium's SwiftShader Vulkan adapter under Xvfb. This verifies execution and behavior; it is **not a hardware-GPU performance benchmark**.

**41 core tests passed.** Coverage includes all starter graph schemas, operator defaults and port types, transaction rollback, cycle rejection, feedback ordering, input replacement, binding dependencies, undo/redo and history merging, deletion cleanup, duplication, typed component boundaries, independent instance IDs, shared-definition propagation, interpolation boundaries, numeric limits, geometry indices/normals, matrix projection, project round-trip, safe identifiers, viewport validation and texture-pool ownership/budget behavior.

**33 browser integration checks passed.** The suite initializes actual WebGPU render, mesh and compute pipelines and reads back actual rendered textures. It covers all five starter networks; 32,768-particle compute dispatch and movement; indexed geometry; WGSL diagnostics and live valid/invalid edits; cached static outputs and downstream invalidation; real pointer-drag wiring; inspector edits and undo/redo; keyboard operator creation; parameter auto-keying; component expansion; additional texture operators; sparse texture input positions; preview recreation after node type changes; embedded images; feedback timing; decoded video frames; WebAudio analysis and media cleanup; a decodable video exported by the actual Record button; and IndexedDB save/reload.

The feedback test reads a black initial history, then red from the previous frame, retains red for the frame where the upstream source changes to blue, and receives blue on the following frame. The image test verifies the exact RGBA center pixel after decode, GPU upload and PNG readback. Video tests decode and seek an included synthetic WebM clip, require non-placeholder frame variance, and verify changed GPU pixel hashes. Browser checks reject uncaught JavaScript exceptions and unexpected engine/GPU error logs before and after reload. Intentional bad WGSL is expected to produce compiler diagnostics.

The Record-button test intercepts only the browser download action, obtains the resulting Blob, and requires that the browser video decoder successfully reads a 320 × 180 video rather than accepting a nonempty container header. A separate workspace check also exercised Perform mode and Escape restoration at 960 × 540 output resolution.

The machine-readable run is included as `tests/browser-results.json`. Individual hashes describe the captured software-adapter run, not universal cross-device bitwise rendering guarantees. Timing/race-sensitive tests wait for accepted GPU submissions rather than assuming an empty queue.

The documented Node static server was also checked: the application and JavaScript module paths return HTTP 200, and an unknown file returns 404.

## Reproduce core tests

```sh
npm test
```

There are no installed Node dependencies. The tests use `node:test` and assertions against the actual core modules. Texture-pool tests use a minimal fake allocation device; actual texture allocation, presentation and copying are separately exercised by browser tests.

## Reproduce browser tests

Run the application server in one terminal:

```sh
npm start
```

Install the optional test-only tooling and run the integration script in another:

```sh
python -m pip install playwright
python -m playwright install chromium
python tests/browser_smoke.py --url http://localhost:8080 \
  --results browser-results.json
```

Use `--chromium /path/to/chromium` to select an installed browser. A working GPU adapter is required; a default headless browser on an arbitrary CI image may not have one.

For the specifically tested Linux Chromium / SwiftShader environment, run Xvfb and use the script's software mode:

```sh
Xvfb :99 -screen 0 1600x1000x24 -ac &
DISPLAY=:99 python tests/browser_smoke.py \
  --url http://localhost:8080 \
  --chromium /usr/bin/chromium --software \
  --results browser-results.json
```

Software mode assumes Chromium's Vulkan ICD exists at `/usr/lib/chromium/vk_swiftshader_icd.json`. Its extra browser flags are **test-environment configuration**, not something the application requires users to enable. The application itself never launches a browser or changes browser security settings.

## Manual acceptance still required

Physical camera and microphone devices were not available for verification. Test granting/denying permission, device removal and reconnect, source stop/delete, project reopen and tab visibility with the intended devices. The automated audio test uses a real Web Audio oscillator and analyser, not a physical microphone.

Fullscreen requests, operating-system dialogs, download permissions, long recording sessions, cross-browser media codecs and mobile multi-touch workflows need acceptance on target browsers. The delivered implementation uses permission-gated browser APIs and exposes failures instead of reporting success without access.

For deployment qualification, also exercise the desired project resolution and node count on target hardware, long-running feedback/particle networks, storage quota exhaustion, device loss, repeated project import, and multi-instance components. A successful software-adapter correctness run is not a claim of 60 FPS, HDR correctness, hard real-time audio timing or production certification.

## Application screenshots

The original downloadable source package includes captured workspace, geometry, and particle screenshots. This repository keeps the executable source, examples, tests, and reports; [open the live application](https://wieslawsoltes.github.io/Fluxweave/) to inspect the rendered networks.
