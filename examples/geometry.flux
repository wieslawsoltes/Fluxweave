{
  "format": "fluxweave",
  "version": 1,
  "name": "Sculpted light",
  "nodes": [
    {
      "id": "torus1",
      "type": "torus",
      "name": "torus1",
      "x": 30,
      "y": 40,
      "params": {
        "radius": 1.3,
        "tube": 0.45,
        "segments": 96,
        "sides": 32
      },
      "bindings": {},
      "keyframes": {},
      "bypass": false
    },
    {
      "id": "transform1",
      "type": "geoTransform",
      "name": "transform1",
      "x": 270,
      "y": 40,
      "params": {
        "scale": 1,
        "rx": 36,
        "ry": 0,
        "rz": 0,
        "x": 0,
        "y": 0,
        "z": 0,
        "spin": 17
      },
      "bindings": {},
      "keyframes": {},
      "bypass": false
    },
    {
      "id": "noise1",
      "type": "noise",
      "name": "noise1",
      "x": 270,
      "y": 270,
      "params": {
        "scale": 3.5,
        "detail": 5,
        "speed": 0,
        "warp": 1.8,
        "contrast": 1.2,
        "palette": "glacier",
        "seed": 4
      },
      "bindings": {},
      "keyframes": {},
      "bypass": false
    },
    {
      "id": "render1",
      "type": "render",
      "name": "render1",
      "x": 510,
      "y": 40,
      "params": {
        "color": "#baa6ed",
        "metallic": 0.8,
        "roughness": 0.2,
        "distance": 5.6,
        "yaw": 25,
        "pitch": 18,
        "instances": 1,
        "spread": 3
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
        "strength": 0.55,
        "radius": 13,
        "threshold": 0.7
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
      "from": "torus1",
      "to": "transform1",
      "input": 0
    },
    {
      "id": "e1",
      "from": "transform1",
      "to": "render1",
      "input": 0
    },
    {
      "id": "e2",
      "from": "noise1",
      "to": "render1",
      "input": 1
    },
    {
      "id": "e3",
      "from": "render1",
      "to": "bloom1",
      "input": 0
    },
    {
      "id": "e4",
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
