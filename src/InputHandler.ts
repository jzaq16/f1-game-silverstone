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

    public get throttle(): boolean {
        return this.isDown('ArrowUp') || this.isDown('KeyW');
    }

    public get brake(): boolean {
        return this.isDown('ArrowDown') || this.isDown('KeyS');
    }

    public get left(): boolean {
        return this.isDown('ArrowLeft') || this.isDown('KeyA');
    }

    public get right(): boolean {
        return this.isDown('ArrowRight') || this.isDown('KeyD');
    }

    public get enter(): boolean {
        return this.isDown('Enter');
    }
}
