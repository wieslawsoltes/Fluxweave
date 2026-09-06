{
  "format": "fluxweave",
  "version": 1,
  "name": "Interference study",
  "nodes": [
    {
      "id": "lfo1",
      "type": "lfo",
      "name": "lfo1",
      "x": 30,
      "y": 220,
      "params": {
        "frequency": 0.08,
        "amplitude": 0.5,
        "offset": 0.5,
        "phase": 0,
        "wave": "sine"
      },
      "bindings": {},
      "keyframes": {},
      "bypass": false
    },
    {
      "id": "shader1",
      "type": "shader",
      "name": "shader1",
      "x": 270,
      "y": 40,
      "params": {
        "amount": 0,
        "speed": 0.35,
        "scale": 2,
        "code": "// Live WGSL • input A: srcA • input B: srcB\n// u.frame = (width, height, time, deltaTime)\n// u.p0 = (amount, speed, scale, 0); u.extra.y = signal\nfn effect(uv: vec2f) -> vec4f {\n  let t = u.frame.z * u.p0.y;\n  var p = (uv - 0.5) * vec2f(u.frame.x / u.frame.y, 1.0);\n  p *= u.p0.z;\n  for (var i = 0; i < 5; i++) {\n    let a = f32(i) + 1.0;\n    p += 0.15 * vec2f(sin(p.y * a + t), cos(p.x * a - t));\n  }\n  let v = 0.5 + 0.5 * sin(length(p) * 10.0 - t * 2.0);\n  let color = palette(v + p.x * 0.3);\n  let source = textureSample(srcA, samp, uv).rgb;\n  return vec4f(mix(color, source, u.p0.x), 1.0);\n}"
      },
      "bindings": {},
      "keyframes": {},
      "bypass": false
    },
    {
      "id": "bloom1",
      "type": "bloom",
      "name": "bloom1",
      "x": 510,
      "y": 40,
      "params": {
        "strength": 0.65,
        "radius": 8,
        "threshold": 0.5
      },
      "bindings": {},
      "keyframes": {},
      "bypass": false
    },
    {
      "id": "out1",
      "type": "output",
      "name": "out1",
      "x": 750,
      "y": 40,
      "params": {},
      "bindings": {},
      "keyframes": {},
      "bypass": false
    }
  ],
  "edges": [
    {
      "id": "e0",
      "from": "lfo1",
      "to": "shader1",
      "input": 2
    },
    {
      "id": "e1",
      "from": "shader1",
      "to": "bloom1",
      "input": 0
    },
    {
      "id": "e2",
      "from": "bloom1",
      "to": "out1",
      "input": 0
    }
  ],
  "components": {},
  "assets": {},
  "settings": {
    "width": 960,
    "height": 540,
    "fps": 60,
    "duration": 20,
    "loop": true
  },
  "view": {
    "x": 28,
    "y": 32,
    "zoom": 0.6
  },
  "output": "out1"
}
