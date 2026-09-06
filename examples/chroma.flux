{
  "format": "fluxweave",
  "version": 1,
  "name": "Chromatic currents",
  "nodes": [
    {
      "id": "noise1",
      "type": "noise",
      "name": "noise1",
      "x": 30,
      "y": 40,
      "params": {
        "scale": 2.1,
        "detail": 5,
        "speed": 0.16,
        "warp": 2.1,
        "contrast": 1.15,
        "palette": "iridescent",
        "seed": 4
      },
      "bindings": {},
      "keyframes": {},
      "bypass": false
    },
    {
      "id": "ramp1",
      "type": "ramp",
      "name": "ramp1",
      "x": 30,
      "y": 260,
      "params": {
        "angle": 30,
        "frequency": 1,
        "colorA": "#253065",
        "colorB": "#bea0de",
        "mode": "radial"
      },
      "bindings": {},
      "keyframes": {},
      "bypass": false
    },
    {
      "id": "lfo1",
      "type": "lfo",
      "name": "lfo1",
      "x": 270,
      "y": 280,
      "params": {
        "frequency": 0.12,
        "amplitude": 0.35,
        "offset": 0.45,
        "phase": 0,
        "wave": "sine"
      },
      "bindings": {},
      "keyframes": {},
      "bypass": false
    },
    {
      "id": "displace1",
      "type": "displace",
      "name": "displace1",
      "x": 270,
      "y": 40,
      "params": {
        "amount": 0.2,
        "frequency": 1
      },
      "bindings": {},
      "keyframes": {},
      "bypass": false
    },
    {
      "id": "kaleido1",
      "type": "kaleido",
      "name": "kaleido1",
      "x": 510,
      "y": 40,
      "params": {
        "segments": 3,
        "rotation": 28,
        "zoom": 1.5,
        "centerX": 0,
        "centerY": 0
      },
      "bindings": {},
      "keyframes": {},
      "bypass": false
    },
    {
      "id": "level1",
      "type": "level",
      "name": "level1",
      "x": 750,
      "y": 40,
      "params": {
        "brightness": 1.08,
        "contrast": 1.08,
        "gamma": 1,
        "saturation": 1.1,
        "invert": "off"
      },
      "bindings": {},
      "keyframes": {},
      "bypass": false
    },
    {
      "id": "feedback1",
      "type": "feedback",
      "name": "feedback1",
      "x": 750,
      "y": 260,
      "params": {
        "decay": 0.9,
        "zoom": 1.006,
        "rotation": 0.25
      },
      "bindings": {},
      "keyframes": {},
      "bypass": false
    },
    {
      "id": "composite1",
      "type": "composite",
      "name": "composite1",
      "x": 990,
      "y": 40,
      "params": {
        "mode": "screen",
        "opacity": 0.14
      },
      "bindings": {},
      "keyframes": {},
      "bypass": false
    },
    {
      "id": "bloom1",
      "type": "bloom",
      "name": "bloom1",
      "x": 1230,
      "y": 40,
      "params": {
        "strength": 0.65,
        "radius": 12,
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
      "x": 1470,
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
      "from": "noise1",
      "to": "displace1",
      "input": 0
    },
    {
      "id": "e1",
      "from": "ramp1",
      "to": "displace1",
      "input": 1
    },
    {
      "id": "e2",
      "from": "lfo1",
      "to": "displace1",
      "input": 2
    },
    {
      "id": "e3",
      "from": "displace1",
      "to": "kaleido1",
      "input": 0
    },
    {
      "id": "e4",
      "from": "kaleido1",
      "to": "level1",
      "input": 0
    },
    {
      "id": "e5",
      "from": "level1",
      "to": "composite1",
      "input": 0
    },
    {
      "id": "e6",
      "from": "feedback1",
      "to": "composite1",
      "input": 1
    },
    {
      "id": "e7",
      "from": "composite1",
      "to": "feedback1",
      "input": 0
    },
    {
      "id": "e8",
      "from": "composite1",
      "to": "bloom1",
      "input": 0
    },
    {
      "id": "e9",
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
