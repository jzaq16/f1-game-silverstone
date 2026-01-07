import { InputHandler } from './InputHandler';
import { AudioManager } from './AudioManager';
import { Track } from './Track';
import type { Segment } from './Track';
import { COLORS } from './Colors';
import { ROAD_HALFWIDTH, CAR_WORLD_WIDTH, SPRITE_WIDTHS, RUMBLE_WIDTH_RATIO, OFF_ROAD_MAX_SPEED, COLLISION_THRESHOLD, MAX_REVERSE_SPEED, PLAYER_Z_OFFSET, TOTAL_LAPS } from './Constants';

class Player {
    public position: number = 0;
    public speed: number = 0;
    public playerX: number = 0;
    public currentLap: number = 1;
    public lapStartTime: number = 0;
    public lastLapTime: number = 0;
    public bestLapTime: number = 0;
    public screenShake: number = 0;
    public id: number;
    public color: string;

    constructor(id: number, startX: number, color: string) {
        this.id = id;
        this.playerX = startX;
        this.color = color;
    }

    public reset(startX: number) {
        this.position = 0;
        this.speed = 0;
        this.playerX = startX;
        this.currentLap = 1;
        this.lapStartTime = 0;
        this.lastLapTime = 0;
        this.bestLapTime = 0;
        this.screenShake = 0;
    }
}

interface Confetti {
    x: number;
    y: number;
    vx: number;
    vy: number;
    color: string;
    size: number;
    rotation: number;
    vr: number;
}

export class Game {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private running: boolean = false;
    private lastTime: number = 0;
    private input: InputHandler;

    // Track
    private track: Track;
    private audio: AudioManager;
    private cameraHeight: number = 800;
    private cameraDepth: number; // calculated from FOV
    private drawDistance: number = 300;
    private roadWidth: number = ROAD_HALFWIDTH; // Half-width in world units

    // Game State
    private gameState: 'COUNTDOWN' | 'RACING' | 'FINISHED' = 'COUNTDOWN';
    private countdownTimer: number = 3.5;
    private raceStartTime: number = 0;
    private winnerId: number | null = null;
    private playerFinishTimes: Map<number, number> = new Map();
    private confetti: Confetti[] = [];

    // Car Sprite
    private sprites: Map<string, HTMLCanvasElement> = new Map();
    private carSprites: Map<string, HTMLCanvasElement> = new Map(); // Recolored car sprites

    // Players
    private players: Player[] = [];
    private maxSpeed: number = 24000;

    // Minimap
    private minimapPath: { x: number; y: number }[] = [];
    private accel: number = 100;
    private breaking: number = 300;
    private decel: number = 50;
    private offRoadDecel: number = 200;

    // Physics Properties
    private steeringSpeed: number = 2.5; // Lateral speed
    private turnLimitSpeed: number = 10000; // Speed above which turning is harder

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        const context = this.canvas.getContext('2d');
        if (!context) throw new Error("Could not get 2D context");
        this.ctx = context;
        this.ctx.imageSmoothingEnabled = true;

        this.input = new InputHandler();
        this.audio = new AudioManager();
        this.track = new Track();
        this.track.createSilverstone();

        // Initialize Players
        this.players = [
            new Player(1, 0.45, '#ff4444'), // Red
            new Player(2, -0.45, '#44aaff') // Blue
        ];

        // Hardcoded depth for consistent scaling (roughly 1.0 for FOV 100 on standard canvas)
        this.cameraDepth = 0.8;

        // Pre-calculate minimap path
        this.minimapPath = this.track.get2DPath();
    }

    private loadAssets(): Promise<void> {
        return new Promise((resolve) => {
            const promises: Promise<void>[] = [];

            // Load tree sprite
            const treePromise = new Promise<void>((resolveInner) => {
                const treeSprite = new Image();
                treeSprite.src = '/tree.png';
                treeSprite.onload = () => {
                    const processedTree = this.removeBackground(treeSprite);
                    this.sprites.set('/tree.png', processedTree);
                    resolveInner();
                };
            });
            promises.push(treePromise);

            // Load additional landmarks
            const others = ['/wing.png', '/grandstand.png', '/billboard.png', '/hangar.png'];
            others.forEach(src => {
                const p = new Promise<void>((res) => {
                    const img = new Image();
                    img.src = src;
                    img.onload = () => {
                        const processed = this.removeBackground(img);
                        this.sprites.set(src, processed);
                        res();
                    };
                });
                promises.push(p);
            });

            // Load Car Sprites and Recolor for both players
            const cars = [
                { id: 'straight', src: '/car_straight.png' },
                { id: 'left1', src: '/car_left_1.png' },
                { id: 'left2', src: '/car_left_2.png' },
                { id: 'right1', src: '/car_right_1.png' },
                { id: 'right2', src: '/car_right_2.png' }
            ];

            cars.forEach(car => {
                const p = new Promise<void>((res) => {
                    const img = new Image();
                    img.src = car.src;
                    img.onload = () => {
                        // Pre-process background (though they should have transparency, let's be sure)
                        const base = this.removeBackground(img);
                        base.onload = () => {
                            // Recolors for each player
                            this.players.forEach(player => {
                                const recolored = this.recolorSprite(base, player.color);
                                this.carSprites.set(`p${player.id}_${car.id}`, recolored);
                            });
                            res();
                        };
                    };
                    img.onerror = () => {
                        console.error(`Failed to load car sprite: ${car.src}`);
                        res(); // Continue anyway
                    };
                });
                promises.push(p);
            });

            // Wait for all sprites to load
            Promise.all(promises).then(() => {
                console.log("All assets loaded successfully");
                resolve();
            });
        });
    }

    private recolorSprite(img: HTMLImageElement | HTMLCanvasElement, targetColor: string): HTMLCanvasElement {
        const canvas = document.createElement('canvas');
        canvas.width = img instanceof HTMLImageElement ? img.width : img.width;
        canvas.height = img instanceof HTMLImageElement ? img.height : img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return canvas;

        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // Parse target color
        const rT = parseInt(targetColor.slice(1, 3), 16);
        const gT = parseInt(targetColor.slice(3, 5), 16);
        const bT = parseInt(targetColor.slice(5, 7), 16);

        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3];

            // Detect red bodywork (Original sprites are red)
            // Weighting: High Red, low Green/Blue
            if (r > 80 && r > g * 1.3 && r > b * 1.3) {
                const luminance = r / 255;
                data[i] = rT * luminance;
                data[i + 1] = gT * luminance;
                data[i + 2] = bT * luminance;
            }

            // Alpha cleanup to remove scaling artifacts/halos
            if (a < 30) data[i + 3] = 0;
            else if (a > 230) data[i + 3] = 255;
        }

        ctx.putImageData(imageData, 0, 0);
        return canvas;
    }

    private removeBackground(img: HTMLImageElement): HTMLCanvasElement {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return canvas;

        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
        let foundContent = false;

        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            // Fuzzy Magenta detection (#FF00FF)
            const isMagenta = r > 150 && b > 150 && g < 100;
            // Also handle the white/grayish highlights from AI generation
            const isBrightOrWhite = r > 230 && g > 230 && b > 230;

            if (isMagenta || isBrightOrWhite) {
                data[i + 3] = 0;
            } else if (data[i + 3] > 0) {
                // Track bounding box of actual content
                const x = (i / 4) % canvas.width;
                const y = Math.floor((i / 4) / canvas.width);
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
                foundContent = true;
            }
        }

        if (!foundContent) return canvas;

        // Create a cropped canvas
        const cropW = maxX - minX + 1;
        const cropH = maxY - minY + 1;
        const croppedCanvas = document.createElement('canvas');
        croppedCanvas.width = cropW;
        croppedCanvas.height = cropH;
        const croppedCtx = croppedCanvas.getContext('2d');
        if (!croppedCtx) return canvas;

        // Apply a "Soft Base" blending effect to landmarks to ground them in the terrain
        const featherHeight = 15;
        for (let y = maxY - featherHeight; y <= maxY; y++) {
            if (y < 0 || y >= canvas.height) continue;
            const alpha = ((maxY - y) / featherHeight); // 1.0 at top of feather, 0.0 at very bottom
            for (let x = minX; x <= maxX; x++) {
                if (x < 0 || x >= canvas.width) continue;
                const pixelIdx = (y * canvas.width + x) * 4;
                data[pixelIdx + 3] *= alpha;
            }
        }

        ctx.putImageData(imageData, 0, 0);
        croppedCtx.drawImage(canvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);

        return croppedCanvas;
    }

    public async start(): Promise<void> {
        // Load all assets before starting the game loop
        await this.loadAssets();

        this.gameState = 'COUNTDOWN';
        this.countdownTimer = 3.5; // Start at 3, extra half second for "GO" visibility later
        this.running = true;
        this.lastTime = performance.now();
        for (const player of this.players) {
            player.lapStartTime = this.lastTime;
        }
        requestAnimationFrame(this.loop.bind(this));
    }

    public stop(): void {
        this.running = false;
    }

    private loop(timestamp: number): void {
        if (!this.running) return;

        // Use the timestamp provided by requestAnimationFrame
        const deltaTime = Math.min(0.1, (timestamp - this.lastTime) / 1000);
        this.lastTime = timestamp;

        this.update(deltaTime, timestamp);
        this.render(timestamp);

        // Decay screen shake for all players
        for (const player of this.players) {
            if (player.screenShake > 0) {
                player.screenShake -= deltaTime * 100;
                if (player.screenShake < 0) player.screenShake = 0;
            }
        }
        if (this.gameState === 'FINISHED') {
            this.updateConfetti(deltaTime);
        }

        requestAnimationFrame(this.loop.bind(this));
    }

    private updateConfetti(dt: number): void {
        // Spawn
        if (this.confetti.length < 150) {
            const winner = this.players.find(p => p.id === this.winnerId);
            this.confetti.push({
                x: Math.random() * this.canvas.width,
                y: -20,
                vx: (Math.random() - 0.5) * 200,
                vy: 100 + Math.random() * 300,
                color: winner ? winner.color : (Math.random() > 0.5 ? '#ff4444' : '#44aaff'),
                size: 5 + Math.random() * 8,
                rotation: Math.random() * Math.PI * 2,
                vr: (Math.random() - 0.5) * 10
            });
        }

        // Update
        for (let i = this.confetti.length - 1; i >= 0; i--) {
            const p = this.confetti[i];
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.rotation += p.vr * dt;
            if (p.y > this.canvas.height) this.confetti.splice(i, 1);
        }
    }

    public reset(): void {
        this.gameState = 'COUNTDOWN';
        this.countdownTimer = 3.5;
        this.players[0].reset(0.45);
        this.players[1].reset(-0.45);
        this.winnerId = null;
        this.playerFinishTimes.clear();
        this.confetti = [];
        this.lastTime = performance.now();
    }

    private update(dt: number, timestamp: number): void {
        const p1Input = this.input.getKeys(1);
        const p2Input = this.input.getKeys(2);

        // Initialize audio on first user interaction (browser restriction)
        if (p1Input.throttle || p1Input.brake || p1Input.left || p1Input.right ||
            p2Input.throttle || p2Input.brake || p2Input.left || p2Input.right) {
            this.audio.init();
        }

        // Update Audio Engine (use Player 1 for engine sound for now)
        if (this.gameState === 'RACING') {
            this.audio.setEngineRPM(Math.abs(this.players[0].speed) / this.maxSpeed);
        } else {
            this.audio.stopEngine();
        }

        // Handle Countdown timer regardless of state (so "GO!" can vanish)
        if (this.countdownTimer > -1) {
            this.countdownTimer -= dt;
            if (this.gameState === 'COUNTDOWN' && this.countdownTimer <= 0) {
                this.gameState = 'RACING';
                this.raceStartTime = timestamp;
                for (const player of this.players) {
                    player.lapStartTime = timestamp;
                }
            }
        }

        if (this.gameState === 'FINISHED') {
            if (this.input.enter) {
                this.reset();
            }
            return; // Don't move cars when finished
        }
        if (this.gameState === 'COUNTDOWN') {
            return; // Don't move cars during countdown
        }

        for (const player of this.players) {
            const input = this.input.getKeys(player.id as 1 | 2);
            const currentSegment = this.findSegment(player.position);
            const speedPercent = player.speed / this.maxSpeed;

            const isOffRoad = player.playerX < -1 || player.playerX > 1;

            // Acceleration and Breaking
            if (input.throttle) {
                const currentAccel = isOffRoad ? this.accel * 0.6 : this.accel;
                player.speed += currentAccel * 60 * dt;
            } else if (input.brake) {
                if (player.speed > 0) {
                    player.speed -= this.breaking * 60 * dt;
                } else {
                    player.speed -= this.accel * 30 * dt;
                }
            } else {
                if (player.speed > 0) {
                    player.speed -= this.decel * 60 * dt;
                } else if (player.speed < 0) {
                    player.speed += this.decel * 60 * dt;
                }
            }

            // Steering
            const steering_input = (input.left ? -1 : (input.right ? 1 : 0));
            const turn_multiplier = Math.max(0.4, 1 - (player.speed - this.turnLimitSpeed) / (this.maxSpeed - this.turnLimitSpeed));
            player.playerX += steering_input * this.steeringSpeed * speedPercent * turn_multiplier * dt;

            // Centrifugal force
            const curve_pull = currentSegment.curve * speedPercent * speedPercent * 3 * dt;
            player.playerX -= curve_pull;

            // Off-road penalty
            if (isOffRoad) {
                const decelForce = Math.abs(player.speed) > OFF_ROAD_MAX_SPEED ?
                    this.offRoadDecel * 100 * dt :
                    this.offRoadDecel * 10 * dt;

                if (player.speed > 0) {
                    player.speed = Math.max(0, player.speed - decelForce);
                } else if (player.speed < 0) {
                    player.speed = Math.min(0, player.speed + decelForce);
                }
            }

            // Collision Detection
            const visualPosition = (player.position + PLAYER_Z_OFFSET) % this.track.trackLength;
            const visualSegment = this.findSegment(visualPosition);

            for (const spriteData of visualSegment.sprites) {
                const spriteWidthWorld = SPRITE_WIDTHS[spriteData.source] || 1000;
                const halfSpriteWidthUnits = (spriteWidthWorld / 2) / this.roadWidth;
                const longitudinalPos = visualPosition % this.track.segmentLength;
                const isLongitudinallyClose = longitudinalPos < (this.track.segmentLength * COLLISION_THRESHOLD);
                const isLaterallyOverlapping = Math.abs(player.playerX - spriteData.offset) < (halfSpriteWidthUnits + 0.1);

                if (isLongitudinallyClose && isLaterallyOverlapping && player.speed > 0) {
                    player.speed = 0;
                    player.screenShake = 20;
                    this.audio.playCollision();
                }
            }

            player.playerX = Math.max(-2, Math.min(2, player.playerX));
            player.speed = Math.max(MAX_REVERSE_SPEED, Math.min(player.speed, this.maxSpeed));
            player.position += player.speed * dt;

            // Lap Timing
            if (player.position >= this.track.trackLength) {
                if (player.currentLap >= TOTAL_LAPS) {
                    if (this.winnerId === null) {
                        this.winnerId = player.id;
                    }
                    if (!this.playerFinishTimes.has(player.id)) {
                        this.playerFinishTimes.set(player.id, timestamp - this.raceStartTime);
                        player.speed = 0; // Stop player once finished
                    }
                } else {
                    player.position -= this.track.trackLength;
                    player.currentLap++;
                    player.lastLapTime = timestamp - player.lapStartTime;
                    player.lapStartTime = timestamp;
                    if (player.bestLapTime === 0 || player.lastLapTime < player.bestLapTime) {
                        player.bestLapTime = player.lastLapTime;
                    }
                }
            }

            // Loop track backwards if necessary
            while (player.position < 0) {
                player.position += this.track.trackLength;
            }

            if (player.screenShake > 0) {
                player.screenShake -= dt * 60;
                if (player.screenShake < 0) player.screenShake = 0;
            }
        }

        // Check if all players finished
        if (this.playerFinishTimes.size === this.players.length) {
            this.gameState = 'FINISHED';
        }
    }

    private findSegment(position: number): Segment {
        const index = Math.floor(position / this.track.segmentLength) % this.track.segments.length;
        return this.track.segments[index];
    }

    private project(p: any, cameraX: number, cameraY: number, cameraZ: number, cameraDepth: number, width: number, height: number, roadWidth: number) {
        p.camera.x = (p.world.x || 0) - cameraX;
        p.camera.y = (p.world.y || 0) - cameraY;
        p.camera.z = (p.world.z || 0) - cameraZ;

        if (p.camera.z <= 0) p.screen.scale = 0;
        else p.screen.scale = cameraDepth / p.camera.z;

        p.screen.x = Math.round((width / 2) + (p.screen.scale * p.camera.x * width / 2));
        p.screen.y = Math.round((height / 2) - (p.screen.scale * p.camera.y * height / 2));
        p.screen.w = Math.round((p.screen.scale * roadWidth * width / 2));
    }

    private renderPolygon(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number, color: string) {
        this.ctx.fillStyle = color;
        this.ctx.beginPath();
        this.ctx.moveTo(x1, y1);
        this.ctx.lineTo(x2, y2);
        this.ctx.lineTo(x3, y3);
        this.ctx.lineTo(x4, y4);
        this.ctx.closePath();
        this.ctx.fill();
    }

    private drawHybridCar(ctx: CanvasRenderingContext2D, player: Player, x: number, y: number, width: number, height: number, tilt: number, speedPercent: number) {
        ctx.save();
        ctx.translate(x + width / 2, y + height);

        // Lean/tilt (Z-axis rotation for camera shake/curves)
        const lean = tilt * 0.04;
        ctx.rotate(lean);

        // --- EXTREME EFFECT: EXHAUST HEAT HAZE ---
        if (speedPercent > 0.1) {
            ctx.save();
            const hazeTime = performance.now() * 0.01;
            for (let i = 0; i < 3; i++) {
                const hazeX = Math.sin(hazeTime + i) * 10;
                const hazeW = width * (0.4 + i * 0.2);
                ctx.fillStyle = `rgba(200, 200, 200, ${0.1 - i * 0.03})`;
                ctx.beginPath();
                ctx.ellipse(hazeX, height * 0.1, hazeW, height * 0.2, 0, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }

        // --- Shadow ---
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.beginPath();
        ctx.ellipse(0, -height * 0.05, width * 0.7, height * 0.25, 0, 0, Math.PI * 2);
        ctx.fill();

        // --- Hybrid Sprite Selection ---
        let spriteId = 'straight';
        if (tilt < -1.5) spriteId = 'left2';
        else if (tilt < -0.3) spriteId = 'left1';
        else if (tilt > 1.5) spriteId = 'right2';
        else if (tilt > 0.3) spriteId = 'right1';

        const sprite = this.carSprites.get(`p${player.id}_${spriteId}`);
        if (sprite) {
            // Draw the high-fidelity raster body
            // Sprites are 512x512, but we scale them to the requested width/height
            // We need to center the sprite horizontally and align it so the bottom is at (0,0)
            ctx.drawImage(sprite, -width / 2, -height, width, height);
        }

        // --- Interactive Procedural Overlays ---
        // These are layered ON TOP of the sprite to provide interactivity

        // Cockpit location (approximate for the sprites)
        const cockpitY = -height * 0.65;
        const topYaw = tilt * width * 0.1;

        ctx.save();
        ctx.translate(topYaw, cockpitY);

        // RPM Shift Lights
        const drawRPMLight = (idx: number, on: boolean, color: string) => {
            ctx.fillStyle = on ? color : '#111';
            if (on) { ctx.shadowBlur = 8; ctx.shadowColor = color; }
            ctx.beginPath();
            ctx.arc(-width * 0.06 + idx * (width * 0.024), -width * 0.06, 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
        };
        drawRPMLight(0, speedPercent > 0.4, '#00ff00');
        drawRPMLight(1, speedPercent > 0.55, '#00ff00');
        drawRPMLight(2, speedPercent > 0.7, '#ff0000');
        drawRPMLight(3, speedPercent > 0.85, '#ff0000');
        drawRPMLight(4, speedPercent > 0.95, '#0000ff');

        ctx.restore();

        // Enhanced Rain Light (Animated)
        if (Math.sin(performance.now() / 150) > 0) {
            ctx.shadowBlur = 20;
            ctx.shadowColor = '#ff4444';
            ctx.fillStyle = '#ff6666';
            ctx.beginPath();
            ctx.roundRect(-width * 0.04, -height * 0.12, width * 0.08, height * 0.06, [1, 1, 1, 1]);
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(0, -height * 0.09, 2.5, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }

    private render(timestamp: number): void {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        const viewHeight = this.canvas.height / this.players.length;

        for (let i = 0; i < this.players.length; i++) {
            const player = this.players[i];
            const viewportY = i * viewHeight;

            this.ctx.save();
            // Clip to current player's view
            this.ctx.beginPath();
            this.ctx.rect(0, viewportY, this.canvas.width, viewHeight);
            this.ctx.clip();
            this.ctx.translate(0, viewportY);

            this.renderView(player, this.canvas.width, viewHeight, timestamp);

            this.ctx.restore();

            // Draw divider
            if (i < this.players.length - 1) {
                this.ctx.strokeStyle = 'rgba(255,255,255,0.3)';
                this.ctx.lineWidth = 4;
                this.ctx.beginPath();
                this.ctx.moveTo(0, viewportY + viewHeight);
                this.ctx.lineTo(this.canvas.width, viewportY + viewHeight);
                this.ctx.stroke();
            }
        }

        if (this.gameState === 'FINISHED') {
            this.drawConfetti();
            this.renderResults();
        }

        this.renderMinimap();
        this.renderCountdown();
    }

    private renderCountdown(): void {
        if (this.countdownTimer > -0.5) {
            this.ctx.save();
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.shadowColor = 'rgba(0,0,0,0.5)';
            this.ctx.shadowBlur = 10;

            if (this.countdownTimer > 0 && this.countdownTimer < 3) {
                this.ctx.font = 'bold 150px Courier New';
                this.ctx.fillStyle = '#fff';
                this.ctx.fillText(Math.ceil(this.countdownTimer).toString(), this.canvas.width / 2, this.canvas.height / 2);
            } else if (this.countdownTimer <= 0 && this.countdownTimer > -1) {
                this.ctx.font = 'bold 150px Courier New';
                this.ctx.fillStyle = '#00ff00';
                this.ctx.fillText("GO!", this.canvas.width / 2, this.canvas.height / 2);
            }
            this.ctx.restore();
        }
    }

    private drawConfetti(): void {
        this.ctx.save();
        for (const p of this.confetti) {
            this.ctx.save();
            this.ctx.translate(p.x, p.y);
            this.ctx.rotate(p.rotation);
            this.ctx.fillStyle = p.color;
            this.ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
            this.ctx.restore();
        }
        this.ctx.restore();
    }

    private renderView(player: Player, width: number, height: number, timestamp: number): void {
        // Apply screen shake
        if (player.screenShake > 0) {
            const shakeX = (Math.random() - 0.5) * player.screenShake;
            const shakeY = (Math.random() - 0.5) * player.screenShake;
            this.ctx.translate(shakeX, shakeY);
        }

        // Draw Sky
        const skyGradient = this.ctx.createLinearGradient(0, 0, 0, height / 2);
        skyGradient.addColorStop(0, '#1e5799');
        skyGradient.addColorStop(1, COLORS.SKY);
        this.ctx.fillStyle = skyGradient;
        this.ctx.fillRect(0, 0, width, height / 2);

        // Draw Ground
        this.ctx.fillStyle = COLORS.TREE;
        this.ctx.fillRect(0, height / 2, width, height / 2);

        const baseSegment = this.findSegment(player.position);
        const basePercent = (player.position % this.track.segmentLength) / this.track.segmentLength;
        const playerY = baseSegment.p1.world.y + (baseSegment.p2.world.y - baseSegment.p1.world.y) * basePercent;
        const cameraY = playerY + this.cameraHeight;
        const cameraZ = player.position - PLAYER_Z_OFFSET;

        let x = 0;
        let dx = -(baseSegment.curve * basePercent);

        // Start rendering from a few segments behind the player to ensure visibility of the other racer
        const startOffset = -5;
        for (let n = startOffset; n < this.drawDistance; n++) {
            const segmentIndex = (baseSegment.index + n + this.track.segments.length) % this.track.segments.length;
            const segment = this.track.segments[segmentIndex];

            // Handle track looping for Z calculation
            let loopOffset = 0;
            if (baseSegment.index + n >= this.track.segments.length) loopOffset = this.track.trackLength;
            if (baseSegment.index + n < 0) loopOffset = -this.track.trackLength;

            this.project(segment.p1, (player.playerX * this.roadWidth) - x, cameraY, cameraZ - loopOffset, this.cameraDepth, width, height, this.roadWidth);
            this.project(segment.p2, (player.playerX * this.roadWidth) - x - dx, cameraY, cameraZ - loopOffset, this.cameraDepth, width, height, this.roadWidth);

            x += dx;
            dx += segment.curve;
        }

        for (let n = this.drawDistance - 1; n >= startOffset; n--) {
            const segmentIndex = (baseSegment.index + n + this.track.segments.length) % this.track.segments.length;
            const segment = this.track.segments[segmentIndex];

            if (segment.p1.camera.z > this.cameraDepth && segment.p2.screen.y < segment.p1.screen.y) {
                // Grass
                this.ctx.fillStyle = segment.color.grass;
                this.ctx.fillRect(0, segment.p2.screen.y, width, segment.p1.screen.y - segment.p2.screen.y);

                // Road
                this.renderPolygon(
                    segment.p1.screen.x - segment.p1.screen.w, segment.p1.screen.y,
                    segment.p1.screen.x + segment.p1.screen.w, segment.p1.screen.y,
                    segment.p2.screen.x + segment.p2.screen.w, segment.p2.screen.y,
                    segment.p2.screen.x - segment.p2.screen.w, segment.p2.screen.y,
                    segment.color.road
                );

                // Rumble strips
                const rumbleW1 = segment.p1.screen.w * RUMBLE_WIDTH_RATIO;
                const rumbleW2 = segment.p2.screen.w * RUMBLE_WIDTH_RATIO;
                this.renderPolygon(
                    segment.p1.screen.x - segment.p1.screen.w - rumbleW1, segment.p1.screen.y,
                    segment.p1.screen.x - segment.p1.screen.w, segment.p1.screen.y,
                    segment.p2.screen.x - segment.p2.screen.w, segment.p2.screen.y,
                    segment.p2.screen.x - segment.p2.screen.w - rumbleW2, segment.p2.screen.y,
                    segment.color.rumble
                );
                this.renderPolygon(
                    segment.p1.screen.x + segment.p1.screen.w, segment.p1.screen.y,
                    segment.p1.screen.x + segment.p1.screen.w + rumbleW1, segment.p1.screen.y,
                    segment.p2.screen.x + segment.p2.screen.w + rumbleW2, segment.p2.screen.y,
                    segment.p2.screen.x + segment.p2.screen.w, segment.p2.screen.y,
                    segment.color.rumble
                );

                // Lane markers
                if (segment.color === COLORS.DARK) {
                    const laneW1 = segment.p1.screen.w * 0.04;
                    const laneW2 = segment.p2.screen.w * 0.04;
                    this.renderPolygon(
                        segment.p1.screen.x - laneW1, segment.p1.screen.y,
                        segment.p1.screen.x + laneW1, segment.p1.screen.y,
                        segment.p2.screen.x + laneW2, segment.p2.screen.y,
                        segment.p2.screen.x - laneW2, segment.p2.screen.y,
                        'rgba(255,255,255,0.4)'
                    );
                }
            }

            // Other players
            for (const otherPlayer of this.players) {
                if (otherPlayer === player) continue;
                const otherSegment = this.findSegment(otherPlayer.position);
                if (otherSegment.index === segment.index && segment.p1.screen.scale > 0) {
                    const spriteScale = segment.p1.screen.scale;
                    const spriteX = segment.p1.screen.x + (otherPlayer.playerX * segment.p1.screen.w);
                    const spriteY = segment.p1.screen.y;

                    // Unified proportional sizing based on CAR_WORLD_WIDTH
                    const spriteW = (CAR_WORLD_WIDTH * spriteScale * width / 2);
                    const spriteH = spriteW * 0.6; // Keep 0.6 aspect ratio

                    // Calculate perspective tilt based on relative lateral position
                    // relX > 0 means other is to the right (we see their left side)
                    const relX = otherPlayer.playerX - player.playerX;
                    const perspectiveTilt = -relX * 1.5; // Scale for visual impact

                    // Also account for other player's own steering
                    const otherInput = this.input.getKeys(otherPlayer.id as 1 | 2);
                    const otherSteering = (otherInput.left ? -1 : (otherInput.right ? 1 : 0));
                    const otherBaseSegment = this.findSegment(otherPlayer.position);
                    const visualTilt = perspectiveTilt + otherSteering + (otherBaseSegment.curve * 0.2);

                    const otherSpeedPercent = otherPlayer.speed / this.maxSpeed;
                    this.drawHybridCar(this.ctx, otherPlayer, spriteX - spriteW / 2, spriteY - spriteH, spriteW, spriteH, visualTilt, otherSpeedPercent);
                }
            }

            // Static sprites
            for (const spriteData of segment.sprites) {
                const spriteImg = this.sprites.get(spriteData.source);
                if (spriteImg && segment.p1.screen.scale > 0) {
                    const spriteScale = segment.p1.screen.scale;
                    const spriteX = segment.p1.screen.x + (spriteData.offset * segment.p1.screen.w);
                    const spriteY = segment.p1.screen.y;
                    const baseWidth = SPRITE_WIDTHS[spriteData.source] || 1000;
                    const spriteW = (baseWidth * spriteScale * width / 2);
                    const spriteH = (spriteImg.height / spriteImg.width * baseWidth) * spriteScale * width / 2;
                    const destX = spriteX - spriteW / 2;
                    const destY = spriteY - spriteH;
                    if (spriteData.mirror) {
                        this.ctx.save();
                        this.ctx.translate(destX + spriteW / 2, 0);
                        this.ctx.scale(-1, 1);
                        this.ctx.drawImage(spriteImg, -spriteW / 2, destY, spriteW, spriteH);
                        this.ctx.restore();
                    } else {
                        this.ctx.drawImage(spriteImg, destX, destY, spriteW, spriteH);
                    }
                }
            }
        }

        // --- VICTORY / FINISH HUD ---
        const hasFinished = this.playerFinishTimes.has(player.id);
        const isWinner = this.winnerId === player.id;

        if (hasFinished) {
            this.ctx.save();
            this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            this.ctx.fillRect(0, height * 0.3, width, 100);

            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.shadowBlur = 10;
            this.ctx.shadowColor = 'black';
            this.ctx.fillStyle = 'white';
            this.ctx.font = 'bold 60px Courier New';
            this.ctx.fillText("FINISH!", width / 2, height * 0.35);

            if (isWinner) {
                this.ctx.fillStyle = '#ffdd00';
                this.ctx.font = 'bold 40px Courier New';
                this.ctx.fillText("VICTORY!", width / 2, height * 0.35 + 50);
            }
            this.ctx.restore();
        }

        // Standard HUD Overlay
        this.ctx.save();
        this.ctx.fillStyle = 'white';
        this.ctx.font = 'Bold 24px Courier New';
        this.ctx.textAlign = 'left';
        this.ctx.fillText(`PLAYER ${player.id}`, 20, 40);

        this.ctx.textAlign = 'right';
        this.ctx.fillText(`LAP ${player.currentLap}/${TOTAL_LAPS}`, width - 20, 40);

        const currentLapTime = timestamp - player.lapStartTime;
        const formatTime = (ms: number) => (ms / 1000).toFixed(2) + 's';
        this.ctx.fillText(`TIME: ${formatTime(currentLapTime)}`, width - 20, 70);

        if (player.bestLapTime > 0) {
            this.ctx.fillStyle = '#44ff44';
            this.ctx.fillText(`BEST: ${formatTime(player.bestLapTime)}`, width - 20, 100);
        }
        this.ctx.restore();

        // --- Main Player Car ---
        const pInput = this.input.getKeys(player.id as 1 | 2);
        const steering = (pInput.left ? -1 : (pInput.right ? 1 : 0));
        const tilt = steering + (baseSegment.curve * 0.2);
        const speedPercent = player.speed / this.maxSpeed;

        const playerScale = this.cameraDepth / PLAYER_Z_OFFSET;
        const carX = width / 2;
        const carY = (height / 2) + (playerScale * this.cameraHeight * height / 2);
        const carW = (CAR_WORLD_WIDTH * playerScale * width / 2);
        const carH = carW * 0.6;

        this.drawHybridCar(this.ctx, player, carX - carW / 2, carY - carH, carW, carH, tilt, speedPercent);
    }

    private renderResults(): void {
        this.ctx.save();
        // Darkened backdrop with animated feel
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.ctx.textAlign = 'center';

        // Winner Glow Effect
        const winner = this.players.find(p => p.id === this.winnerId);
        if (winner) {
            const centerX = this.canvas.width / 2;
            const centerY = this.canvas.height / 2;
            const gradient = this.ctx.createRadialGradient(centerX, centerY, 50, centerX, centerY, 400);
            gradient.addColorStop(0, winner.color + '44'); // Low opacity
            gradient.addColorStop(1, 'transparent');
            this.ctx.fillStyle = gradient;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }

        this.ctx.shadowBlur = 15;
        this.ctx.shadowColor = winner ? winner.color : 'white';
        this.ctx.fillStyle = 'white';
        this.ctx.font = 'bold 80px Courier New';
        this.ctx.fillText("GRAND PRIX FINISH", this.canvas.width / 2, 120);

        this.ctx.shadowBlur = 0;
        const formatTime = (ms: number) => (ms / 1000).toFixed(3) + 's';

        for (let i = 0; i < this.players.length; i++) {
            const p = this.players[i];
            const isWinner = p.id === this.winnerId;
            const yOffset = 250 + i * 180;
            const cardX = this.canvas.width / 2 - 250;
            const cardW = 500;
            const cardH = 140;

            // Player Card Background
            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
            if (isWinner) this.ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
            this.ctx.fillRect(cardX, yOffset - 40, cardW, cardH);
            this.ctx.strokeStyle = p.color;
            this.ctx.lineWidth = isWinner ? 4 : 2;
            this.ctx.strokeRect(cardX, yOffset - 40, cardW, cardH);

            // Player Title
            this.ctx.textAlign = 'left';
            this.ctx.font = 'bold 32px Courier New';
            this.ctx.fillStyle = p.color;
            this.ctx.fillText(`PLAYER ${p.id}${isWinner ? ' - WINNER' : ''}`, cardX + 20, yOffset);

            // Stats
            this.ctx.font = '24px Courier New';
            this.ctx.fillStyle = 'white';
            const finishTime = this.playerFinishTimes.get(p.id);
            this.ctx.fillText(`FINISH: ${finishTime ? formatTime(finishTime) : 'DNF'}`, cardX + 20, yOffset + 40);
            this.ctx.fillText(`BEST LAP: ${formatTime(p.bestLapTime)}`, cardX + 20, yOffset + 75);

            // Trophy icon for winner
            if (isWinner) {
                this.ctx.font = '60px Courier New';
                this.ctx.fillText("🏆", cardX + cardW - 80, yOffset + 50);
            }
        }

        this.ctx.textAlign = 'center';
        this.ctx.fillStyle = '#ffdd00';
        this.ctx.font = 'bold 28px Courier New';
        this.ctx.fillText("PRESS ENTER TO RESTART", this.canvas.width / 2, this.canvas.height - 60);
        this.ctx.restore();
    }

    private renderMinimap(): void {
        const padding = 20;
        const size = 150;
        const x = this.canvas.width - size - padding;
        const y = padding;

        this.ctx.save();
        this.ctx.translate(x, y);

        // Background
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        this.ctx.fillRect(0, 0, size, size);
        this.ctx.strokeStyle = '#fff';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(0, 0, size, size);

        if (this.minimapPath.length === 0) {
            this.ctx.restore();
            return;
        }

        // Find bounds
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of this.minimapPath) {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
        }

        const mWidth = maxX - minX;
        const mHeight = maxY - minY;
        const mScale = (size * 0.8) / Math.max(mWidth, mHeight);

        // Coordinates relative to bounding box center
        const getMapX = (val: number) => (size / 2) + (val - (minX + maxX) / 2) * mScale;
        const getMapY = (val: number) => (size / 2) - (val - (minY + maxY) / 2) * mScale;

        // Draw track
        this.ctx.beginPath();
        this.ctx.strokeStyle = '#888';
        this.ctx.lineWidth = 3;
        for (let i = 0; i < this.minimapPath.length; i++) {
            const p = this.minimapPath[i];
            const px = getMapX(p.x);
            const py = getMapY(p.y);
            if (i === 0) this.ctx.moveTo(px, py);
            else this.ctx.lineTo(px, py);
        }
        this.ctx.closePath();
        this.ctx.stroke();

        // Draw racers
        const drawDot = (pos: number, color: string, radius: number = 3) => {
            const index = Math.floor(pos / this.track.segmentLength) % this.track.segments.length;
            const pathIndex = Math.floor(index * (this.minimapPath.length / this.track.segments.length)) % this.minimapPath.length;
            const p = this.minimapPath[pathIndex];
            if (!p) return; // Added check for undefined p
            const px = getMapX(p.x);
            const py = getMapY(p.y);
            this.ctx.fillStyle = color;
            this.ctx.beginPath();
            this.ctx.arc(px, py, radius, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.strokeStyle = '#000';
            this.ctx.lineWidth = 1;
            this.ctx.stroke();
        };

        // Players
        for (const player of this.players) {
            drawDot(player.position, player.color, 4);
        }

        this.ctx.restore();
    }
}
