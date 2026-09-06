{
  "format": "fluxweave",
  "version": 1,
  "name": "Resonant field",
  "nodes": [
    {
      "id": "audio1",
      "type": "audio",
      "name": "audio1",
      "x": 30,
      "y": 220,
      "params": {
        "band": "bass",
        "gain": 2.5,
        "smoothing": 0.75
      },
      "bindings": {},
      "keyframes": {},
      "bypass": false
    },
    {
      "id": "noise1",
      "type": "noise",
      "name": "noise1",
      "x": 30,
      "y": 40,
      "params": {
        "scale": 2.4,
        "detail": 5,
        "speed": 0.22,
        "warp": 2.8,
        "contrast": 1.2,
        "palette": "iridescent",
        "seed": 4
      },
      "bindings": {},
      "keyframes": {},
      "bypass": false
    },
    {
      "id": "kaleido1",
      "type": "kaleido",
      "name": "kaleido1",
      "x": 270,
      "y": 40,
      "params": {
        "segments": 8,
        "rotation": 16,
        "zoom": 1.2,
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
      "x": 510,
      "y": 40,
      "params": {
        "brightness": 0.9,
        "contrast": 1.3,
        "gamma": 1,
        "saturation": 1.15,
        "invert": "off"
      },
      "bindings": {},
      "keyframes": {},
      "bypass": false
    },
    {
      "id": "bloom1",
      "type": "bloom",
      "name": "bloom1",
      "x": 750,
      "y": 40,
      "params": {
        "strength": 1.3,
        "radius": 16,
        "threshold": 0.25
      },
      "bindings": {},
      "keyframes": {},
      "bypass": false
    },
    {
      "id": "out1",
      "type": "output",
      "name": "out1",
      "x": 990,
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
      "from": "audio1",
      "to": "noise1",
      "input": 0
    },
    {
      "id": "e1",
      "from": "noise1",
      "to": "kaleido1",
      "input": 0
    },
    {
      "id": "e2",
      "from": "kaleido1",
      "to": "level1",
      "input": 0
    },
    {
      "id": "e3",
      "from": "audio1",
      "to": "level1",
      "input": 1
    },
    {
      "id": "e4",
      "from": "level1",
      "to": "bloom1",
      "input": 0
    },
    {
      "id": "e5",
      "from": "audio1",
      "to": "bloom1",
      "input": 1
    },
    {
      "id": "e6",
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
