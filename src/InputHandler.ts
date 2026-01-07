export class InputHandler {
    private keys: Record<string, boolean> = {};

    constructor() {
        window.addEventListener('keydown', (e) => this.onKeyDown(e));
        window.addEventListener('keyup', (e) => this.onKeyUp(e));
    }

    private onKeyDown(e: KeyboardEvent): void {
        this.keys[e.code] = true;
    }

    private onKeyUp(e: KeyboardEvent): void {
        this.keys[e.code] = false;
    }

    public isDown(code: string): boolean {
        return !!this.keys[code];
    }

    public getKeys(player: 1 | 2) {
        if (player === 1) {
            return {
                throttle: this.isDown('ArrowUp'),
                brake: this.isDown('ArrowDown'),
                left: this.isDown('ArrowLeft'),
                right: this.isDown('ArrowRight'),
            };
        } else {
            return {
                throttle: this.isDown('KeyW'),
                brake: this.isDown('KeyS'),
                left: this.isDown('KeyA'),
                right: this.isDown('KeyD'),
            };
        }
    }

    public get enter(): boolean {
        return this.isDown('Enter');
    }
}
