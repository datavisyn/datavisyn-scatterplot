import { ITester } from './quadtree';
export default class Lasso {
    private line;
    private points;
    private current;
    start(x: number, y: number): void;
    setCurrent(x: number, y: number): void;
    pushCurrent(): boolean;
    end(x: number, y: number): void;
    clear(): void;
    tester(p2nX: (p: number) => number, p2nY: (p: number) => number): ITester;
    render(ctx: CanvasRenderingContext2D): void;
}
