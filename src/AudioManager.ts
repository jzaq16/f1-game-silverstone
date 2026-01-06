export class AudioManager {
    private ctx: AudioContext | null = null;

    // Engine Nodes
    private osc1: OscillatorNode | null = null;
    private osc2: OscillatorNode | null = null;
    private noiseSource: AudioBufferSourceNode | null = null;
    private engineGain: GainNode | null = null;
    private engineFilter: BiquadFilterNode | null = null;
    private distortion: WaveShaperNode | null = null;

    constructor() { }

    public async init(): Promise<void> {
        if (this.ctx) return;

        this.ctx = new AudioContext();
        await this.ctx.resume();

        // 1. Create Oscillators (Multi-cylinder harmonics)
        this.osc1 = this.ctx.createOscillator();
        this.osc1.type = 'sawtooth';

        this.osc2 = this.ctx.createOscillator();
        this.osc2.type = 'sawtooth';
        this.osc2.detune.setValueAtTime(700, this.ctx.currentTime); // A fifth above for complex harmonics

        // 2. Distortion (The Growl)
        this.distortion = this.ctx.createWaveShaper();
        this.distortion.curve = this.makeDistortionCurve(400) as any;

        // 3. Noise Layer (Mechanical Grit)
        this.noiseSource = this.createNoiseBuffer();

        // 4. Filtering & Volume
        this.engineFilter = this.ctx.createBiquadFilter();
        this.engineFilter.type = 'lowpass';
        this.engineFilter.frequency.setValueAtTime(600, this.ctx.currentTime);
        this.engineFilter.Q.setValueAtTime(2, this.ctx.currentTime);

        this.engineGain = this.ctx.createGain();
        this.engineGain.gain.setValueAtTime(0, this.ctx.currentTime);

        // Routing: [Osc1/2 + Noise] -> Distortion -> Filter -> Gain -> Destination
        const noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(0.01, this.ctx.currentTime); // Subtle noise

        this.osc1.connect(this.distortion);
        this.osc2.connect(this.distortion);
        this.noiseSource.connect(noiseGain);
        noiseGain.connect(this.distortion);

        this.distortion.connect(this.engineFilter);
        this.engineFilter.connect(this.engineGain);
        this.engineGain.connect(this.ctx.destination);

        this.osc1.start();
        this.osc2.start();
        this.noiseSource.start();
    }

    private makeDistortionCurve(amount: number): Float32Array {
        const n_samples = 44100;
        const curve = new Float32Array(n_samples);
        const deg = Math.PI / 180;
        for (let i = 0; i < n_samples; ++i) {
            const x = (i * 2) / n_samples - 1;
            curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
        }
        return curve;
    }

    private createNoiseBuffer(): AudioBufferSourceNode {
        if (!this.ctx) throw new Error("AudioContext not initialized");
        const bufferSize = 2 * this.ctx.sampleRate;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        return source;
    }

    public setEngineRPM(speedPercent: number): void {
        if (!this.ctx || !this.osc1 || !this.osc2 || !this.engineGain || !this.engineFilter) return;

        // Base RPM (Harmonic Scream)
        const baseFreq = 40 + (speedPercent * 250);
        this.osc1.frequency.setTargetAtTime(baseFreq, this.ctx.currentTime, 0.05);
        this.osc2.frequency.setTargetAtTime(baseFreq * 1.5, this.ctx.currentTime, 0.05);

        // Filter: Open up the scream as speed increases
        const filterFreq = 600 + (speedPercent * 4000);
        this.engineFilter.frequency.setTargetAtTime(filterFreq, this.ctx.currentTime, 0.05);

        // Volume logic
        const volume = 0.05 + (speedPercent * 0.2);
        this.engineGain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.05);
    }

    public stopEngine(): void {
        if (this.engineGain && this.ctx) {
            this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
        }
    }

    public playCollision(): void {
        if (!this.ctx) return;

        const bufferSize = this.ctx.sampleRate * 0.15;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(800, this.ctx.currentTime);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.8, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.15);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);
        noise.start();
    }
}
