/** Cached outputs own their textures; only released textures are available for reuse. */
export class TexturePool {
    constructor(device, budget = 256 * 1024 * 1024) {
        this.device = device;
        this.budget = budget;
        this.free = new Map();
        this.live = new Set();
        this.all = new Set();
        this.hits = 0;
        this.misses = 0;
        this.bytes = 0;
    }
    acquire(width, height, format = 'rgba8unorm', usage = null) {
        usage ??= GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;
        const key = `${width}/${height}/${format}/${usage}`;
        const list = this.free.get(key);
        let r = list?.pop();
        if (r)
            this.hits++;
        else {
            const required = width * height * 4;
            if (this.bytes + required > this.budget) {
                for (const available of this.free.values())
                    while (available.length && this.bytes + required > this.budget) {
                        const old = available.shift();
                        old.texture.destroy();
                        this.all.delete(old);
                        this.bytes -= old.bytes;
                    }
            }
            if (this.bytes + required > this.budget)
                throw new Error('Texture memory budget exceeded (256 MB). Lower resolution or reduce live previews.');
            const texture = this.device.createTexture({
                label: `pool ${key}`, size: [width, height], format, usage
            });
            r = {
                texture, view: texture.createView(), width, height, format, key, bytes: width * height * 4
            };
            this.all.add(r);
            this.bytes += r.bytes;
            this.misses++;
        }
        this.live.add(r);
        return r;
    }
    release(r) {
        if (!r || !this.live.delete(r))
            return;
        (this.free.get(r.key) || this.free.set(r.key, []).get(r.key)).push(r);
        this.trim();
    }
    trim() {
        if (this.bytes <= this.budget)
            return;
        for (const list of this.free.values())
            while (list.length && this.bytes > this.budget) {
                const r = list.shift();
                r.texture.destroy();
                this.all.delete(r);
                this.bytes -= r.bytes;
            }
    }
    stats() {
        let activeBytes = 0;
        for (const r of this.live)
            activeBytes += r.bytes;
        return {
            bytes: this.bytes, activeBytes, active: this.live.size, cached: this.all.size - this.live.size, hits: this.hits, misses: this.misses
        };
    }
    dispose() {
        for (const r of this.all)
            r.texture.destroy();
        this.all.clear();
        this.live.clear();
        this.free.clear();
        this.bytes = 0;
    }
}
