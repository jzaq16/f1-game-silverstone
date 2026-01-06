export class Opponent {
    public position: number; // position on the track
    public speed: number;
    public playerX: number; // horizontal offset
    public sprite: string;
    public targetX: number; // desired horizontal lane (-1 to 1)

    constructor(position: number, speed: number, playerX: number, sprite: string, targetX: number = 0) {
        this.position = position;
        this.speed = speed;
        this.playerX = playerX;
        this.sprite = sprite;
        this.targetX = targetX;
    }

    update(dt: number, trackLength: number, findSegment: (pos: number) => any) {
        // AI Logic
        const currentSegment = findSegment(this.position);

        // Lane-keeping AI: steer towards the assigned targetX
        this.playerX = Math.max(-1.5, Math.min(1.5, this.playerX + (this.targetX - this.playerX) * 0.1));

        // Slow down for curves
        const speedPercent = this.speed / 24000;
        const centrifugal_force = -currentSegment.curve * speedPercent * speedPercent;

        if (Math.abs(currentSegment.curve) > 2) {
            this.speed -= 100 * dt * Math.abs(currentSegment.curve);
        } else {
            this.speed += 50 * dt;
        }

        // Apply centrifugal force
        this.playerX += centrifugal_force * 0.1;

        this.speed = Math.max(5000, Math.min(this.speed, 20000));
        this.position += this.speed * dt;

        while (this.position >= trackLength) {
            this.position -= trackLength;
        }
        while (this.position < 0) {
            this.position += trackLength;
        }
    }
}
