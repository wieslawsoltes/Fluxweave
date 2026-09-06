/** Permission-gated media sources. No microphone or camera is started automatically. */
export class MediaManager extends EventTarget {
    constructor() {
        super();
        this.sources = new Map();
        this.version = 0;
        this.audioContext = null;
    }
    changed() {
        this.version++;
        this.dispatchEvent(new Event('change'));
    }
    async asset(id, asset, type) {
        if (this.sources.get(id)?.assetId === asset.id)
            return;
        this.stop(id);
        if (type === 'image') {
            const image = new Image();
            image.src = asset.data;
            await image.decode();
            this.sources.set(id, {
                kind: 'image', image, assetId: asset.id, width: image.width, height: image.height
            });
        }
        else if (type === 'video') {
            const video = document.createElement('video');
            video.muted = true;
            video.loop = true;
            video.playsInline = true;
            video.src = asset.data;
            video.preload = 'auto';
            video.addEventListener('seeked', () => this.changed());
            await new Promise((resolve, reject) => {
                video.onloadeddata = resolve;
                video.onerror = () => reject(new Error('The browser cannot decode this video format.'));
            });
            await video.play().catch(() => {
            });
            this.sources.set(id, {
                kind: 'video', video, assetId: asset.id, width: video.videoWidth, height: video.videoHeight
            });
        }
        else if (type === 'audio') {
            const audio = document.createElement('audio');
            audio.src = asset.data;
            audio.loop = true;
            const ctx = await this.context(), source = ctx.createMediaElementSource(audio), analyser = ctx.createAnalyser();
            analyser.fftSize = 2048;
            source.connect(analyser);
            analyser.connect(ctx.destination);
            const rec = {
                kind: 'audio', audio, source, analyser, assetId: asset.id, bins: new Uint8Array(1024), wave: new Float32Array(2048)
            };
            this.sources.set(id, rec);
            await audio.play();
        }
        this.changed();
    }
    async context() {
        this.audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
        if (this.audioContext.state === 'suspended')
            await this.audioContext.resume();
        return this.audioContext;
    }
    async camera(id) {
        if (!navigator.mediaDevices?.getUserMedia)
            throw new Error('Camera capture requires HTTPS or localhost and a supported browser.');
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        this.stop(id);
        const video = document.createElement('video');
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        try {
            await video.play();
        }
        catch (e) {
            stream.getTracks().forEach(t => t.stop());
            throw e;
        }
        this.sources.set(id, {
            kind: 'camera', video, stream, width: video.videoWidth, height: video.videoHeight
        });
        this.changed();
    }
    async microphone(id) {
        if (!navigator.mediaDevices?.getUserMedia)
            throw new Error('Microphone capture requires HTTPS or localhost.');
        const ctx = await this.context();
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        this.stop(id);
        const source = ctx.createMediaStreamSource(stream), analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        this.sources.set(id, {
            kind: 'audio', stream, source, analyser, bins: new Uint8Array(1024), wave: new Float32Array(2048)
        });
        this.changed();
    }
    async testTone(id) {
        const ctx = await this.context();
        this.stop(id);
        const osc = ctx.createOscillator(), mod = ctx.createOscillator(), amp = ctx.createGain(), depth = ctx.createGain(), analyser = ctx.createAnalyser(), monitor = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 82;
        mod.frequency.value = .8;
        amp.gain.value = .3;
        depth.gain.value = .26;
        monitor.gain.value = .09;
        mod.connect(depth);
        depth.connect(amp.gain);
        osc.connect(amp);
        amp.connect(analyser);
        analyser.connect(monitor);
        monitor.connect(ctx.destination);
        osc.start();
        mod.start();
        this.sources.set(id, {
            kind: 'audio', osc, mod, source: amp, depth, monitor, analyser, bins: new Uint8Array(1024), wave: new Float32Array(2048)
        });
        this.changed();
    }
    analyze(id, p) {
        const r = this.sources.get(id);
        if (!r?.analyser)
            return {
                rms: 0, bass: 0, mid: 0, high: 0, bins: new Uint8Array(128)
            };
        r.analyser.smoothingTimeConstant = p.smoothing;
        r.analyser.getByteFrequencyData(r.bins);
        r.analyser.getFloatTimeDomainData(r.wave);
        const hz = this.audioContext.sampleRate / r.analyser.fftSize;
        const band = (low, high) => {
            const from = Math.max(1, Math.floor(low / hz)), to = Math.min(r.bins.length, Math.ceil(high / hz));
            let v = 0;
            for (let i = from; i < to; i++)
                v += r.bins[i];
            return v / Math.max(1, to - from) / 255 * p.gain;
        };
        let sum = 0;
        for (const v of r.wave)
            sum += v * v;
        return {
            rms: Math.sqrt(sum / r.wave.length) * p.gain, bass: band(20, 250), mid: band(250, 2500), high: band(2500, 16000), bins: r.bins
        };
    }
    syncPlayback(playing) {
        for (const r of this.sources.values()) {
            const e = r.video || r.audio;
            if (e && r.kind !== 'camera') {
                if (playing && e.paused)
                    e.play().catch(() => {
                    });
                if (!playing && !e.paused)
                    e.pause();
            }
        }
    }
    stop(id) {
        const r = this.sources.get(id);
        if (!r)
            return;
        r.stream?.getTracks().forEach(t => t.stop());
        for (const key of ['osc', 'mod'])
            try {
                r[key]?.stop();
            }
            catch {
            }
        for (const key of ['source', 'analyser', 'depth', 'monitor'])
            r[key]?.disconnect();
        const el = r.video || r.audio;
        if (el) {
            el.pause();
            el.srcObject = null;
            el.removeAttribute('src');
            el.load();
        }
        this.sources.delete(id);
        this.changed();
    }
    dispose() {
        for (const id of [...this.sources.keys()])
            this.stop(id);
        this.audioContext?.close();
    }
}
