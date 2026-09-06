{
  "format": "fluxweave",
  "version": 1,
  "name": "Orbital matter",
  "nodes": [
    {
      "id": "lfo1",
      "type": "lfo",
      "name": "lfo1",
      "x": 30,
      "y": 220,
      "params": {
        "frequency": 0.13,
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
      "id": "particles1",
      "type": "particles",
      "name": "particles1",
      "x": 270,
      "y": 40,
      "params": {
        "count": 32768,
        "speed": 0.8,
        "turbulence": 1.5,
        "size": 2,
        "radius": 0.68,
        "colorA": "#c096fc",
        "colorB": "#77f1d5"
      },
      "bindings": {},
      "keyframes": {},
      "bypass": false
    },
    {
      "id": "feedback1",
      "type": "feedback",
      "name": "feedback1",
      "x": 510,
      "y": 250,
      "params": {
        "decay": 0.91,
        "zoom": 1.002,
        "rotation": 0.1
      },
      "bindings": {},
      "keyframes": {},
      "bypass": false
    },
    {
      "id": "composite1",
      "type": "composite",
      "name": "composite1",
      "x": 510,
      "y": 40,
      "params": {
        "mode": "add",
        "opacity": 0.6
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
        "strength": 1.2,
        "radius": 9,
        "threshold": 0.18
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
      "from": "lfo1",
      "to": "particles1",
      "input": 0
    },
    {
      "id": "e1",
      "from": "particles1",
      "to": "composite1",
      "input": 0
    },
    {
      "id": "e2",
      "from": "feedback1",
      "to": "composite1",
      "input": 1
    },
    {
      "id": "e3",
      "from": "composite1",
      "to": "feedback1",
      "input": 0
    },
    {
      "id": "e4",
      "from": "composite1",
      "to": "bloom1",
      "input": 0
    },
    {
      "id": "e5",
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
