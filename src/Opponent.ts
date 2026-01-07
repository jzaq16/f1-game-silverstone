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
        const steerSpeed = 0.1;
        this.playerX = Math.max(-1.5, Math.min(1.5, this.playerX + (this.targetX - this.playerX) * steerSpeed));

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

    /**
     * Determines which sprite frame and mirror status to use.
     * We use a mirrored system for perfect symmetry.
     */
    public getSpriteFrame(playerX: number, curve: number): { frame: string, mirror: boolean } {
        const relativeX = (this.playerX - playerX);
        const perspectiveScore = -relativeX * 1.5;
        const curveScore = -curve * 0.5; // Left curve (-) -> Positive score -> Angled Left
        const steering = (this.targetX - this.playerX);
        const steeringScore = -steering * 2.0; // Steering left (-) -> Positive score -> Angled Left

        const totalScore = perspectiveScore + curveScore + steeringScore;

        // Symmetric logic: 
        // Our base sprites (_left_1, _left_2) are angled LEFT (pointing left/seeing right bodywork).
        // Positive totalScore means we WANT the car angled left.

        const isAngledLeft = totalScore > 0;
        const absScore = Math.abs(totalScore);

        let frame = '_straight';
        if (absScore > 3.0) frame = isAngledLeft ? '_left_2' : '_right_2';
        else if (absScore > 1.2) frame = isAngledLeft ? '_left_1' : '_right_1';

        // We only mirror if we ARE using a left sprite for a right turn
        const needsMirror = !isAngledLeft && frame.includes('_left');
        return { frame, mirror: needsMirror };
    }
}
