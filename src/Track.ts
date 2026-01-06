import { COLORS } from './Colors';
import { SPRITE_WIDTHS, ROAD_HALFWIDTH, RUMBLE_WIDTH_RATIO, BUILDING_SAFETY_MARGIN } from './Constants';

export interface Point {
    world: { x: number; y: number; z: number };
    camera: { x: number; y: number; z: number };
    screen: { scale: number; x: number; y: number; w: number };
}

export interface Segment {
    index: number;
    p1: Point;
    p2: Point;
    color: typeof COLORS.LIGHT | typeof COLORS.DARK | typeof COLORS.START | typeof COLORS.FINISH;
    curve: number;
    sprites: { source: string, offset: number, mirror?: boolean }[];
}

export class Track {
    public segments: Segment[] = [];
    public segmentLength: number = 200;
    public rumbleLength: number = 3;
    public trackLength: number = 0;
    private lastY: number = 0;

    constructor() {
        this.reset();
    }

    public reset(): void {
        this.segments = [];
        this.trackLength = 0;
        this.lastY = 0;
    }

    private addSegment(curve: number, y: number): void {
        const n = this.segments.length;
        const color = Math.floor(n / this.rumbleLength) % 2 ? COLORS.DARK : COLORS.LIGHT;

        const segment: Segment = {
            index: n,
            p1: { world: { x: 0, y: this.lastY, z: n * this.segmentLength }, camera: { x: 0, y: 0, z: 0 }, screen: { scale: 0, x: 0, y: 0, w: 0 } },
            p2: { world: { x: 0, y: y, z: (n + 1) * this.segmentLength }, camera: { x: 0, y: 0, z: 0 }, screen: { scale: 0, x: 0, y: 0, w: 0 } },
            color: color,
            curve: curve,
            sprites: []
        };

        this.lastY = y;
        this.segments.push(segment);
    }

    private addRoad(enter: number, hold: number, leave: number, curve: number, y: number = 0): void {
        const startY = this.lastY;
        const endY = startY + (y * this.segmentLength);
        const total = enter + hold + leave;

        for (let n = 0; n < enter; n++) this.addSegment(this.easeIn(0, curve, n / enter), startY + (endY - startY) * this.easeInOut(0, 1, n / total));
        for (let n = 0; n < hold; n++)  this.addSegment(curve, startY + (endY - startY) * this.easeInOut(0, 1, (enter + n) / total));
        for (let n = 0; n < leave; n++) this.addSegment(this.easeInOut(curve, 0, n / leave), startY + (endY - startY) * this.easeInOut(0, 1, (enter + hold + n) / total));
    }

    private easeIn(a: number, b: number, percent: number): number {
        return a + (b - a) * Math.pow(percent, 2);
    }

    private easeInOut(a: number, b: number, percent: number): number {
        return a + (b - a) * ((-Math.cos(percent * Math.PI) / 2) + 0.5);
    }

    // Define specific track pieces
    public addStraight(num: number = 25, y: number = 0): void {
        this.addRoad(num, num, num, 0, y);
    }

    public addCurve(num: number = 20, curve: number = 4, y: number = 0): void {
        this.addRoad(num, num, num, curve, y);
    }

    public addHill(num: number, height: number): void {
        this.addRoad(num, num, num, 0, height);
    }

    public addLowRollingHills(num: number = 50, height: number = 20): void {
        this.addRoad(num, num, num, 0, height);
        this.addRoad(num, num, num, 0, -height);
    }

    public addSCurves(): void {
        this.addRoad(50, 50, 50, -3);
        this.addRoad(50, 50, 50, 3);
        this.addRoad(50, 50, 50, -3);
        this.addRoad(50, 50, 50, 3);
    }

    public addSprite(index: number, source: string, offset: number, mirror: boolean = false): void {
        if (this.segments[index]) {
            this.segments[index].sprites.push({ source, offset, mirror });
        }
    }

    /**
     * Places an object on the side of the track, ensuring its inner edge
     * is at a specific margin from the road edge, regardless of its width.
     */
    public addSideObject(index: number, source: string, side: -1 | 1, margin: number = 0.1): void {
        const spriteWidth = SPRITE_WIDTHS[source] || 1000;
        // Offset is in "road half-widths" from center. 
        // 1.0 is exactly the edge of the asphalt.
        // We add the rumble strip width and a safety margin.
        const halfSpriteInRoadUnits = (spriteWidth / 2) / ROAD_HALFWIDTH;
        const offset = side * (1.0 + RUMBLE_WIDTH_RATIO + BUILDING_SAFETY_MARGIN + margin + halfSpriteInRoadUnits);

        // Auto-mirror for right side grandstands
        const mirror = (side === 1 && source === '/grandstand.png');

        this.addSprite(index, source, offset, mirror);
    }

    public createSilverstone(): void {
        this.reset();

        // 1. Hamilton Straight (Start/Finish)
        this.addStraight(50);
        this.addSideObject(10, '/wing.png', 1, 0.2); // Right side, 20% margin
        this.addSideObject(5, '/billboard.png', -1, 0.1);
        this.addSideObject(30, '/billboard.png', 1, 0.1);

        // 2. Abbey (Fast Right)
        this.addCurve(20, 2, 20); // Elevation rise
        this.addSideObject(this.segments.length - 10, '/grandstand.png', -1, 0.1);

        // 3. Farm Curve (Gentle Left)
        this.addCurve(15, -1);
        this.addSideObject(this.segments.length - 5, '/billboard.png', 1, 0.2);

        // 4. Village (Tight Right)
        this.addRoad(10, 20, 10, 4);

        // 5. The Loop (Tight Left)
        this.addRoad(10, 25, 10, -5);

        // 6. Aintree (Left onto straight)
        this.addCurve(15, -2);
        this.addSideObject(this.segments.length - 5, '/billboard.png', -1, 0.1);

        // 7. Wellington Straight
        this.addStraight(60);
        this.addSideObject(this.segments.length - 30, '/billboard.png', 1, 0.1);

        // 8. Brooklands (Long Left)
        this.addRoad(20, 30, 20, -3);
        this.addSideObject(this.segments.length - 20, '/grandstand.png', -1, 0.1);

        // 9. Luffield (Long looping Right)
        this.addRoad(20, 60, 20, 3);
        this.addSideObject(this.segments.length - 30, '/grandstand.png', 1, 0.1);

        // 10. Woodcote (Fast Right)
        this.addCurve(20, 2);

        // 11. National Pits Straight (formerly Start/Finish)
        this.addStraight(40);
        this.addSideObject(10, '/billboard.png', -1, 0.1);

        // 12. Copse (Fast Right - critical corner!)
        this.addRoad(10, 20, 10, 3);
        this.addSideObject(this.segments.length - 15, '/grandstand.png', 1, 0.1);

        // 13. Maggotts / Becketts / Chapel (The Snake)
        // Fast Left
        this.addRoad(10, 10, 10, -2);
        // Fast Right
        this.addRoad(10, 15, 10, 3);
        // Fast Left
        this.addRoad(10, 15, 10, -3);
        // Fast Right (Chapel)
        this.addRoad(10, 10, 10, 2);

        // 14. Hangar Straight (Longest)
        this.addStraight(40);
        const hangarBaseIndex = this.segments.length - 40;
        this.addLowRollingHills(25, 30); // Elevation on Hangar straight
        this.addSideObject(hangarBaseIndex + 5, '/hangar.png', 1, 0.4);
        this.addSideObject(hangarBaseIndex + 15, '/hangar.png', -1, 0.4);
        this.addSideObject(hangarBaseIndex + 25, '/billboard.png', 1, 0.3);
        this.addStraight(25);

        // 15. Stowe (Fast Right)
        this.addRoad(15, 20, 15, 2.5, -20); // Dips into Stowe
        this.addSideObject(this.segments.length - 20, '/grandstand.png', 1, 0.1);

        // 16. Vale (Straight into chicane)
        this.addStraight(15);
        this.addRoad(10, 10, 10, -3); // Chicane left...
        this.addRoad(5, 5, 5, 3); // ...right

        // 17. Club (Long Right onto main straight)
        this.addRoad(20, 40, 20, 2, 10); // Climb back to start line

        // Finish line buffer
        this.addStraight(10);

        // Add some scenery
        for (let i = 10; i < 200; i += 20) {
            this.addSprite(i, '/tree.png', -2.5);
            this.addSprite(i, '/tree.png', 1.5);
        }

        // Mark start/finish lines
        this.segments[2].color = COLORS.START;
        this.segments[3].color = COLORS.START;

        this.trackLength = this.segments.length * this.segmentLength;
    }
}

