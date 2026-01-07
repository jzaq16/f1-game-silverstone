import { InputHandler } from './InputHandler';
import { Opponent } from './Opponent';
import { AudioManager } from './AudioManager';
import { Track } from './Track';
import type { Segment } from './Track';
import { COLORS } from './Colors';
import { ROAD_HALFWIDTH, SPRITE_WIDTHS, RUMBLE_WIDTH_RATIO, OFF_ROAD_MAX_SPEED, COLLISION_THRESHOLD, MAX_REVERSE_SPEED, PLAYER_Z_OFFSET, TOTAL_LAPS } from './Constants';

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
    private totalRaceTime: number = 0;

    // Car Sprite
    private sprites: Map<string, HTMLCanvasElement> = new Map();
    private carAngles: string[] = ['_straight', '_left_1', '_left_2', '_right_1', '_right_2'];
    private opponents: Opponent[] = [];

    // Game State
    private position: number = 0;
    private speed: number = 0;
    private playerX: number = 0.4; // Initial start in Right Lane
    private maxSpeed: number = 24000;
    private accel: number = 100;
    private breaking: number = 300;
    private decel: number = 50;
    private offRoadDecel: number = 200;

    // Lap timing
    private currentLap: number = 1;
    private lapStartTime: number = 0;
    private lastLapTime: number = 0;
    private bestLapTime: number = 0;

    // Physics Properties
    private steeringSpeed: number = 2.5; // Lateral speed
    private turnLimitSpeed: number = 10000; // Speed above which turning is harder
    private screenShake: number = 0; // Screen shake intensity on impact

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

        // Start cars side-by-side: Opponent at visual line, Player at visual line
        this.playerX = 0.45; // Slightly offset from center for better lane fit

        // Single rival placed strictly on the asphalt (Left Lane center)
        this.opponents.push(new Opponent(
            PLAYER_Z_OFFSET,      // Side-by-side at the start
            12000,                // Speed
            -0.45,                // Left lane offset
            '/car.png',           // Base path
            -0.45                 // Target lane
        ));

        // Hardcoded depth for consistent scaling (roughly 1.0 for FOV 100 on standard canvas)
        this.cameraDepth = 0.8;
    }

    private loadAssets(): Promise<void> {
        return new Promise((resolve) => {
            const promises: Promise<void>[] = [];

            // Load car sprites (Symmetric Mirrored System)
            this.carAngles.forEach(angle => {
                const src = `/car${angle}.png`;
                const p = new Promise<void>((resolveInner) => {
                    const img = new Image();
                    img.src = src;
                    img.onload = () => {
                        const processed = this.removeBackground(img);
                        processed.onload = () => {
                            this.sprites.set(src, processed);
                            resolveInner();
                        };
                    };
                });
                promises.push(p);
            });

            // Load tree sprite
            const treePromise = new Promise<void>((resolveInner) => {
                const treeSprite = new Image();
                treeSprite.src = '/tree.png';
                treeSprite.onload = () => {
                    const processedTree = this.removeBackground(treeSprite);
                    processedTree.onload = () => {
                        this.sprites.set('/tree.png', processedTree);
                        console.log("Tree sprite loaded and processed");
                        resolveInner();
                    };
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
                        processed.onload = () => {
                            this.sprites.set(src, processed);
                            res();
                        };
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

    private removeBackground(img: HTMLImageElement): HTMLImageElement {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return img;

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
            // Magenta has high R and B, low G.
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

        if (!foundContent) return img;

        // Create a cropped canvas
        const cropW = maxX - minX + 1;
        const cropH = maxY - minY + 1;
        const croppedCanvas = document.createElement('canvas');
        croppedCanvas.width = cropW;
        croppedCanvas.height = cropH;
        const croppedCtx = croppedCanvas.getContext('2d');
        if (!croppedCtx) return img;

        // Put the processed (transparent) data back and then draw cropped
        ctx.putImageData(imageData, 0, 0);

        // Apply a "Soft Base" blending effect to landmarks to ground them in the terrain
        // We'll feather the bottom few pixels with decreasing alpha
        const featherHeight = 15;
        for (let y = maxY - featherHeight; y <= maxY; y++) {
            const alpha = ((maxY - y) / featherHeight); // 1.0 at top of feather, 0.0 at very bottom
            for (let x = minX; x <= maxX; x++) {
                const pixelIdx = (y * canvas.width + x) * 4;
                data[pixelIdx + 3] *= alpha;
            }
        }
        ctx.putImageData(imageData, 0, 0);

        croppedCtx.drawImage(canvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);

        const newImg = new Image();
        newImg.src = croppedCanvas.toDataURL();
        return newImg;
    }

    public async start(): Promise<void> {
        // Load all assets before starting the game loop
        await this.loadAssets();

        this.gameState = 'COUNTDOWN';
        this.countdownTimer = 3.5; // Start at 3, extra half second for "GO" visibility later
        this.running = true;
        this.lastTime = performance.now();
        this.lapStartTime = this.lastTime;
        requestAnimationFrame(this.loop.bind(this));
    }

    public stop(): void {
        this.running = false;
    }

    private loop(timestamp: number): void {
        if (!this.running) return;

        const deltaTime = Math.min(1, (timestamp - this.lastTime) / 1000); // cap Max dt
        this.lastTime = timestamp;

        this.update(deltaTime, timestamp);
        this.render(timestamp);

        // Decay screen shake
        if (this.screenShake > 0) {
            this.screenShake -= deltaTime * 100;
            if (this.screenShake < 0) this.screenShake = 0;
        }

        requestAnimationFrame(this.loop.bind(this));
    }

    private reset(): void {
        this.position = 0;
        this.speed = 0;
        this.playerX = 0.4;
        this.currentLap = 1;
        this.gameState = 'COUNTDOWN';
        this.countdownTimer = 3.5;
        this.raceStartTime = 0;
        this.totalRaceTime = 0;
        this.lapStartTime = 0;
        this.lastLapTime = 0;

        // Reset opponents
        for (const opponent of this.opponents) {
            opponent.position = PLAYER_Z_OFFSET; // Reset to start line
            opponent.playerX = -0.45;
        }
    }

    private update(dt: number, timestamp: number): void {
        // Initialize audio on first user interaction (browser restriction)
        if (this.input.throttle || this.input.brake || this.input.left || this.input.right) {
            this.audio.init();
        }

        // Update Audio Engine
        if (this.gameState === 'RACING') {
            this.audio.setEngineRPM(Math.abs(this.speed) / this.maxSpeed);
        } else {
            this.audio.stopEngine();
        }

        // Handle Countdown timer regardless of state (so "GO!" can vanish)
        if (this.countdownTimer > -1) {
            this.countdownTimer -= dt;
            if (this.gameState === 'COUNTDOWN' && this.countdownTimer <= 0) {
                this.gameState = 'RACING';
                this.lapStartTime = timestamp;
                this.raceStartTime = timestamp;
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
        const input = this.input;
        const currentSegment = this.findSegment(this.position);
        const speedPercent = this.speed / this.maxSpeed;

        const isOffRoad = this.playerX < -1 || this.playerX > 1;

        // Acceleration and Breaking
        if (input.throttle) {
            // Forward acceleration - slightly slower off-road
            const currentAccel = isOffRoad ? this.accel * 0.6 : this.accel;
            this.speed += currentAccel * 60 * dt;
        } else if (input.brake) {
            if (this.speed > 0) {
                this.speed -= this.breaking * 60 * dt;
            } else {
                // Reverse acceleration
                this.speed -= this.accel * 30 * dt;
            }
        } else {
            // Natural deceleration
            if (this.speed > 0) {
                this.speed -= this.decel * 60 * dt;
            } else if (this.speed < 0) {
                this.speed += this.decel * 60 * dt;
            }
        }

        // --- Direct Steering Physics ---
        const steering_input = (input.left ? -1 : (input.right ? 1 : 0));

        // Steering becomes harder at very high speeds
        const turn_multiplier = Math.max(0.4, 1 - (this.speed - this.turnLimitSpeed) / (this.maxSpeed - this.turnLimitSpeed));

        // Apply direct lateral movement
        this.playerX += steering_input * this.steeringSpeed * speedPercent * turn_multiplier * dt;

        // Centrifugal force: track curves "pull" the car outward
        // We use a small factor so it's noticeable but easily overcome
        const curve_pull = currentSegment.curve * speedPercent * speedPercent * 3 * dt;
        this.playerX -= curve_pull;

        // Off-road penalty: Slow down if not on asphalt (Acts as friction/drag)
        if (isOffRoad) {
            const decelForce = Math.abs(this.speed) > OFF_ROAD_MAX_SPEED ?
                this.offRoadDecel * 100 * dt :
                this.offRoadDecel * 10 * dt;

            if (this.speed > 0) {
                this.speed = Math.max(0, this.speed - decelForce);
            } else if (this.speed < 0) {
                this.speed = Math.min(0, this.speed + decelForce);
            }
        }

        // --- Environment Collision Detection ---
        // We check for collisions ahead of the camera, where the player car is visually drawn
        const visualPosition = (this.position + PLAYER_Z_OFFSET) % this.track.trackLength;
        const visualSegment = this.findSegment(visualPosition);

        for (const spriteData of visualSegment.sprites) {
            const spriteWidthWorld = SPRITE_WIDTHS[spriteData.source] || 1000;
            const halfSpriteWidthUnits = (spriteWidthWorld / 2) / this.roadWidth;

            // Longitudinal check: Are we close to the start of this segment where the sprite is?
            const longitudinalPos = visualPosition % this.track.segmentLength;
            const isLongitudinallyClose = longitudinalPos < (this.track.segmentLength * COLLISION_THRESHOLD);

            // Check if playerX is within the sprite's span
            const isLaterallyOverlapping = Math.abs(this.playerX - spriteData.offset) < (halfSpriteWidthUnits + 0.1);

            if (isLongitudinallyClose && isLaterallyOverlapping && this.speed > 0) {
                // COLLISION! STOP THE CAR IMMEDIATELY
                this.speed = 0;
                this.screenShake = 20; // Trigger impact shake
                this.audio.playCollision(); // Trigger SFX
            }
        }
        // --- End Collision Detection ---

        // --- End Direct Steering ---

        // Clamp player position to road boundaries (with a little give for effect)
        this.playerX = Math.max(-2, Math.min(2, this.playerX));

        // Clamp speed to min reverse and max forward
        this.speed = Math.max(MAX_REVERSE_SPEED, Math.min(this.speed, this.maxSpeed));

        // Move player along track
        this.position += this.speed * dt;


        // Lap Timing
        const lastPosition = this.position - this.speed * dt;
        if (lastPosition < this.track.segmentLength * 3 && this.position >= this.track.segmentLength * 3) {
            this.currentLap++;
            this.lastLapTime = timestamp - this.lapStartTime;
            if (this.bestLapTime === 0 || this.lastLapTime < this.bestLapTime) {
                this.bestLapTime = this.lastLapTime;
            }
            this.lapStartTime = timestamp;

            // Check for Race Completion
            if (this.currentLap > TOTAL_LAPS) {
                this.gameState = 'FINISHED';
                this.totalRaceTime = timestamp - this.raceStartTime;
                this.speed = 0; // Immediate stop for simplicity, or let it coast? 
                // User said "stop the car", so let's set speed to 0.
            }
        }


        // Loop track
        while (this.position >= this.track.trackLength) {
            this.position -= this.track.trackLength;
        }
        while (this.position < 0) {
            this.position += this.track.trackLength;
        }

        // Update opponents
        for (const opponent of this.opponents) {
            opponent.update(dt, this.track.trackLength, this.findSegment.bind(this));
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

    private render(timestamp: number): void {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Apply screen shake
        if (this.screenShake > 0) {
            const shakeX = (Math.random() - 0.5) * this.screenShake;
            const shakeY = (Math.random() - 0.5) * this.screenShake;
            this.ctx.translate(shakeX, shakeY);
        }

        // Draw Sky (Gradient for realism)
        const skyGradient = this.ctx.createLinearGradient(0, 0, 0, this.canvas.height / 2);
        skyGradient.addColorStop(0, '#1e5799');
        skyGradient.addColorStop(1, COLORS.SKY);
        this.ctx.fillStyle = skyGradient;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height / 2);

        // Draw Ground (Grass)
        this.ctx.fillStyle = COLORS.TREE;
        this.ctx.fillRect(0, this.canvas.height / 2, this.canvas.width, this.canvas.height / 2);

        const baseSegment = this.findSegment(this.position);
        const basePercent = (this.position % this.track.segmentLength) / this.track.segmentLength;
        const playerY = baseSegment.p1.world.y + (baseSegment.p2.world.y - baseSegment.p1.world.y) * basePercent;
        const cameraY = playerY + this.cameraHeight;

        let x = 0;
        let dx = -(baseSegment.curve * basePercent);

        for (let n = 0; n < this.drawDistance; n++) {
            const segment = this.track.segments[(baseSegment.index + n) % this.track.segments.length];
            const looped = (baseSegment.index + n) >= this.track.segments.length;
            const cameraZ = this.position - (looped ? this.track.trackLength : 0);

            // Project: Syncing track math with x/dx offsets
            this.project(segment.p1, (this.playerX * this.roadWidth) - x, cameraY, cameraZ, this.cameraDepth, this.canvas.width, this.canvas.height, this.roadWidth);
            this.project(segment.p2, (this.playerX * this.roadWidth) - x - dx, cameraY, cameraZ, this.cameraDepth, this.canvas.width, this.canvas.height, this.roadWidth);

            x += dx;
            dx += segment.curve;
        }

        // --- Pass 2: Sprites, Opponents & Track (Back-to-Front / Painter's Algorithm) ---
        // By drawing farthest to nearest, hills (near) will naturally cover sprites (far).
        for (let n = this.drawDistance - 1; n >= 0; n--) {
            const segment = this.track.segments[(baseSegment.index + n) % this.track.segments.length];

            // Render Segment Geometry (merged back for correct occlusion)
            // Skip segments behind camera or off-screen
            if (segment.p1.camera.z > this.cameraDepth && segment.p2.screen.y < segment.p1.screen.y) {
                // Draw Grass
                this.ctx.fillStyle = segment.color.grass;
                this.ctx.fillRect(0, segment.p2.screen.y, this.canvas.width, segment.p1.screen.y - segment.p2.screen.y);

                // Draw Road
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

            // (Pass 2 continues here - we already have the start of the n loop)

            // Collect all sprites for this segment
            const allSegmentSprites = segment.sprites.map(s => ({ ...s }));
            for (const opponent of this.opponents) {
                const opponentSegment = this.findSegment(opponent.position);
                if (opponentSegment.index === segment.index) {
                    const info = opponent.getSpriteFrame(this.playerX, segment.curve);
                    const spritePath = `/car${info.frame}.png`;
                    allSegmentSprites.push({ source: spritePath, offset: opponent.playerX, mirror: info.mirror });
                }
            }

            for (const spriteData of allSegmentSprites) {
                const sprite = this.sprites.get(spriteData.source);
                if (sprite && segment.p1.screen.scale > 0) {
                    const spriteScale = segment.p1.screen.scale;
                    const spriteX = segment.p1.screen.x + (spriteData.offset * segment.p1.screen.w);
                    const spriteY = segment.p1.screen.y;

                    let baseSpriteWidth = SPRITE_WIDTHS[spriteData.source] || 1000;

                    const spriteW = (baseSpriteWidth * spriteScale * this.canvas.width / 2);
                    const spriteH = (sprite.height / sprite.width * baseSpriteWidth) * spriteScale * this.canvas.width / 2;

                    const destX = spriteX - spriteW / 2;
                    const destY = spriteY - spriteH;

                    if (spriteData.mirror) {
                        this.ctx.save();
                        this.ctx.translate(destX + spriteW / 2, 0);
                        this.ctx.scale(-1, 1);
                        this.ctx.drawImage(sprite, -spriteW / 2, destY, spriteW, spriteH);
                        this.ctx.restore();
                    } else {
                        this.ctx.drawImage(sprite, destX, destY, spriteW, spriteH);
                    }
                }
            }
        }

        // Draw HUD
        this.ctx.fillStyle = '#fff';
        this.ctx.font = 'bold 24px Courier New';
        this.ctx.shadowColor = 'black';
        this.ctx.shadowBlur = 8;

        const kph = this.speed / 100;
        this.ctx.fillText("SPEED: " + kph.toFixed(0) + " km/h", 20, 40);

        const currentLapTime = (this.gameState === 'RACING') ? (timestamp - this.lapStartTime) / 1000 : 0;
        this.ctx.fillText("LAP:   " + this.currentLap, 20, 70);
        this.ctx.fillText("TIME:  " + currentLapTime.toFixed(2), 20, 100);

        const formatTime = (ms: number) => {
            if (ms === 0) return "0.00";
            const seconds = ms / 1000;
            return seconds.toFixed(2);
        }

        this.ctx.textAlign = 'right';
        this.ctx.fillText("LAST: " + formatTime(this.lastLapTime), this.canvas.width - 20, 40);
        this.ctx.fillText("BEST: " + formatTime(this.bestLapTime), this.canvas.width - 20, 70);
        this.ctx.textAlign = 'left';

        this.ctx.shadowBlur = 0;

        // Draw Countdown Overlay
        if (this.countdownTimer > -0.5) {
            const count = Math.ceil(this.countdownTimer);
            let text = "";
            let color = "#fff";

            if (count > 0 && count <= 3) {
                text = count.toString();
                color = count === 1 ? "#ff4444" : (count === 2 ? "#ffbb00" : "#ffff00");
            } else if (this.countdownTimer <= 0 && this.countdownTimer > -0.5) {
                text = "GO!";
                color = "#44ff44";
            }

            if (text) {
                this.ctx.save();
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.font = 'bold 120px Courier New';
                this.ctx.fillStyle = color;
                this.ctx.shadowColor = 'black';
                this.ctx.shadowBlur = 15;
                this.ctx.fillText(text, this.canvas.width / 2, this.canvas.height / 2);
                this.ctx.restore();
            }
        }

        // Draw Car (Realistic Sprite)
        const steering_input = (this.input.left ? -1 : (this.input.right ? 1 : 0));
        const curve_tilt = baseSegment.curve * 0.2;
        const total_tilt = steering_input + curve_tilt;

        let playerFrame = '_straight';
        let mirrorPlayer = false;

        if (total_tilt < -1.5) {
            playerFrame = '_left_2';
            mirrorPlayer = false;
        } else if (total_tilt < -0.8) {
            playerFrame = '_left_1';
            mirrorPlayer = false;
        } else if (total_tilt > 1.5) {
            playerFrame = this.sprites.has('/car_right_2.png') ? '_right_2' : '_left_2';
            mirrorPlayer = !this.sprites.has('/car_right_2.png');
        } else if (total_tilt > 0.8) {
            playerFrame = this.sprites.has('/car_right_1.png') ? '_right_1' : '_left_1';
            mirrorPlayer = !this.sprites.has('/car_right_1.png');
        }

        // If the user says it's backwards, it might be that the _left sprites look like right turns?
        // Or the signs are flipped. Let's try inverting the mirrorPlayer logic based on user feedback.
        // Actually, let's keep it consistent and ask for a screenshot if it persists.
        // BUT wait, if the user says "backwards", I should probably flip the true/false for mirroring.
        if (playerFrame.includes('_left')) {
            mirrorPlayer = total_tilt > 0;
        } else if (playerFrame.includes('_right')) {
            mirrorPlayer = total_tilt < 0;
        }

        const playerSprite = this.sprites.get(`/car${playerFrame}.png`);

        if (playerSprite && playerSprite.complete) {
            const carW = 160; // Reduced from 200 to fit lane better
            const carH = carW * (playerSprite.height / playerSprite.width);
            const carX = (this.canvas.width / 2) - (carW / 2);
            const carY = this.canvas.height - carH - 20;

            // Subtle rotation for extra "lean"
            const rotation = total_tilt * 0.05;

            this.ctx.save();
            this.ctx.translate(carX + carW / 2, carY + carH / 2);

            if (mirrorPlayer) {
                this.ctx.scale(-1, 1);
            }
            this.ctx.rotate(rotation * (mirrorPlayer ? -1 : 1));

            // Draw "YOU" indicator during countdown only
            if (this.gameState === 'COUNTDOWN') {
                this.ctx.save();
                // If mirroring the car, we must UN-mirror the coordinate system for text
                // OR we just use a separate translate since we're already centered.
                this.ctx.scale(mirrorPlayer ? -1 : 1, 1);
                this.ctx.textAlign = 'center';
                this.ctx.font = 'bold 30px Courier New';
                this.ctx.fillStyle = '#ffdd00'; // Brighter gold
                this.ctx.shadowBlur = 10;
                this.ctx.fillText("YOU", 0, -carH / 2 - 25);
                this.ctx.restore();
            }

            this.ctx.drawImage(playerSprite, -carW / 2, -carH / 2 + Math.sin(this.position / 50) * 2, carW, carH);
            this.ctx.restore();
        }

        if (this.screenShake > 0) {
            this.ctx.setTransform(1, 0, 0, 1, 0, 0); // Restore from shake
        }

        if (this.gameState === 'FINISHED') {
            this.renderResults();
        }
    }

    private renderResults(): void {
        this.ctx.save();

        // Darken screen
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.ctx.textAlign = 'center';
        this.ctx.fillStyle = 'white';
        this.ctx.shadowBlur = 10;
        this.ctx.shadowColor = 'black';

        // Title
        this.ctx.font = 'bold 80px Courier New';
        this.ctx.fillText("RACE COMPLETE", this.canvas.width / 2, this.canvas.height / 2 - 120);

        // Stats
        this.ctx.font = '40px Courier New';
        const formatTime = (ms: number) => (ms / 1000).toFixed(3) + 's';

        this.ctx.fillText(`TOTAL TIME: ${formatTime(this.totalRaceTime)}`, this.canvas.width / 2, this.canvas.height / 2 - 20);
        this.ctx.fillText(`BEST LAP:   ${formatTime(this.bestLapTime)}`, this.canvas.width / 2, this.canvas.height / 2 + 30);

        // Prompt
        this.ctx.fillStyle = '#ffdd00';
        this.ctx.font = 'bold 30px Courier New';
        this.ctx.fillText("PRESS ENTER TO RESTART", this.canvas.width / 2, this.canvas.height / 2 + 150);

        this.ctx.restore();
    }
}
