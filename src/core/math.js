/** Column-major matrices; WebGPU NDC depth is [0, 1]. */
export const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
export function multiply(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++)
        for (let r = 0; r < 4; r++)
            for (let k = 0; k < 4; k++)
                o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
}
export function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), m = new Float32Array(16);
    m[0] = f / aspect;
    m[5] = f;
    m[10] = far / (near - far);
    m[11] = -1;
    m[14] = far * near / (near - far);
    return m;
}
export function normalize(v) {
    const l = Math.hypot(...v) || 1;
    return v.map(x => x / l);
}
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
export function lookAt(eye, target = [0, 0, 0], up = [0, 1, 0]) {
    const z = normalize(eye.map((v, i) => v - target[i])), x = normalize(cross(up, z)), y = cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
}
export function transformMatrix(p, time = 0) {
    const d = Math.PI / 180, x = p.rx * d, y = (p.ry + time * (p.spin || 0)) * d, z = p.rz * d, s = p.scale;
    const a = identity();
    a[0] = a[5] = a[10] = s;
    a[12] = p.x;
    a[13] = p.y;
    a[14] = p.z;
    const rx = new Float32Array([1, 0, 0, 0, 0, Math.cos(x), Math.sin(x), 0, 0, -Math.sin(x), Math.cos(x), 0, 0, 0, 0, 1]);
    const ry = new Float32Array([Math.cos(y), 0, -Math.sin(y), 0, 0, 1, 0, 0, Math.sin(y), 0, Math.cos(y), 0, 0, 0, 0, 1]);
    const rz = new Float32Array([Math.cos(z), Math.sin(z), 0, 0, -Math.sin(z), Math.cos(z), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    return multiply(a, multiply(rz, multiply(ry, rx)));
}
export function hexColor(h) {
    const s = h.replace('#', '');
    return [parseInt(s.slice(0, 2), 16) / 255, parseInt(s.slice(2, 4), 16) / 255, parseInt(s.slice(4, 6), 16) / 255, 1];
}
export function createGeometry(type, p) {
    const vertices = [], indices = [];
    const v = (pos, n, uv) => vertices.push(...pos, ...n, ...uv);
    const quad = (a, b, c, d) => indices.push(a, b, c, a, c, d);
    if (type === 'torus') {
        const ns = Math.round(p.segments), nt = Math.round(p.sides);
        for (let i = 0; i <= ns; i++) {
            const a = i / ns * Math.PI * 2;
            for (let j = 0; j <= nt; j++) {
                const b = j / nt * Math.PI * 2, cb = Math.cos(b), sb = Math.sin(b), ca = Math.cos(a), sa = Math.sin(a);
                v([(p.radius + p.tube * cb) * ca, p.tube * sb, (p.radius + p.tube * cb) * sa], [cb * ca, sb, cb * sa], [i / ns, j / nt]);
            }
        }
        for (let i = 0; i < ns; i++)
            for (let j = 0; j < nt; j++) {
                const a = i * (nt + 1) + j;
                quad(a, a + 1, a + nt + 2, a + nt + 1);
            }
    }
    else if (type === 'sphere') {
        const ns = Math.round(p.segments), nr = Math.round(p.rings);
        for (let j = 0; j <= nr; j++) {
            const b = j / nr * Math.PI;
            for (let i = 0; i <= ns; i++) {
                const a = i / ns * Math.PI * 2, n = [Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a)];
                v(n.map(x => x * p.radius), n, [i / ns, j / nr]);
            }
        }
        for (let j = 0; j < nr; j++)
            for (let i = 0; i < ns; i++) {
                const a = j * (ns + 1) + i;
                quad(a, a + ns + 1, a + ns + 2, a + 1);
            }
    }
    else if (type === 'box') {
        const x = p.width / 2, y = p.height / 2, z = p.depth / 2;
        const faces = [[[0, 0, 1], [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]]], [[0, 0, -1], [[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]]], [[1, 0, 0], [[x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z]]], [[-1, 0, 0], [[-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z]]], [[0, 1, 0], [[-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z]]], [[0, -1, 0], [[-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]]]];
        for (const [n, points] of faces) {
            const k = vertices.length / 8;
            points.forEach((pos, i) => v(pos, n, [[0, 0], [1, 0], [1, 1], [0, 1]][i]));
            quad(k, k + 1, k + 2, k + 3);
        }
    }
    else if (type === 'grid') {
        const n = Math.round(p.segments);
        for (let j = 0; j <= n; j++)
            for (let i = 0; i <= n; i++) {
                const x = (i / n - .5) * p.size, z = (j / n - .5) * p.size, h = p.wave * Math.sin(x * 2) * Math.cos(z * 2);
                const normal = normalize([-p.wave * 2 * Math.cos(x * 2) * Math.cos(z * 2), 1, p.wave * 2 * Math.sin(x * 2) * Math.sin(z * 2)]);
                v([x, h, z], normal, [i / n, j / n]);
            }
        for (let j = 0; j < n; j++)
            for (let i = 0; i < n; i++) {
                const a = j * (n + 1) + i;
                quad(a, a + n + 1, a + n + 2, a + 1);
            }
    }
    return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices), matrix: identity() };
}
