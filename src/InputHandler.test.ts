import { describe, it, expect, beforeEach } from 'vitest';
import { InputHandler } from './InputHandler';

describe('InputHandler', () => {
    let input: InputHandler;

    beforeEach(() => {
        input = new InputHandler();
    });

    it('should detect Player 1 ArrowUp for throttle', () => {
        const event = new KeyboardEvent('keydown', { code: 'ArrowUp' });
        window.dispatchEvent(event);
        expect(input.getKeys(1).throttle).toBe(true);
        expect(input.getKeys(2).throttle).toBe(false);
    });

    it('should detect Player 2 KeyW for throttle', () => {
        const event = new KeyboardEvent('keydown', { code: 'KeyW' });
        window.dispatchEvent(event);
        expect(input.getKeys(2).throttle).toBe(true);
        expect(input.getKeys(1).throttle).toBe(false);
    });

    it('should detect Player 1 ArrowDown for brake', () => {
        const event = new KeyboardEvent('keydown', { code: 'ArrowDown' });
        window.dispatchEvent(event);
        expect(input.getKeys(1).brake).toBe(true);
    });

    it('should detect Player 2 KeyS for brake', () => {
        const event = new KeyboardEvent('keydown', { code: 'KeyS' });
        window.dispatchEvent(event);
        expect(input.getKeys(2).brake).toBe(true);
    });

    it('should detect Enter key', () => {
        const event = new KeyboardEvent('keydown', { code: 'Enter' });
        window.dispatchEvent(event);
        expect(input.enter).toBe(true);
    });
});
