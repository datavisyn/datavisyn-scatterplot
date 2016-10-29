/**
 * author:  Samuel Gratzl
 * email:   samuel_gratzl@gmx.at
 * created: 2016-10-28T11:19:52.797Z
 */

import {
  symbolCircle,
  symbolCross,
  symbolDiamond,
  symbolSquare,
  symbolStar,
  symbolTriangle,
  symbolWye,
  SymbolType
} from 'd3-shape';

/**
 * a symbol renderer renderes a bunch of data points using `render` at the end `done` will be called
 */
export interface ISymbolRenderer<T> {
  render(x: number, y: number, d: T);
  done();
}

/**
 * rendering mode for different kind of renderings
 */
export enum ERenderMode {
  NORMAL,
  SELECTED,
  HOVER
}

/**
 * factory for creating symbols renderers
 */
export interface ISymbol<T> {
  /**
   * @param ctx the context to use
   * @param mode the current render mode
   * @returns a symbol renderer
   */
  (ctx: CanvasRenderingContext2D, mode: ERenderMode): ISymbolRenderer<T>;
}

export const d3SymbolCircle: SymbolType = symbolCircle;
export const d3SymbolCross: SymbolType = symbolCross;
export const d3SymbolDiamond: SymbolType = symbolDiamond;
export const d3SymbolSquare: SymbolType = symbolSquare;
export const d3SymbolStar: SymbolType = symbolStar;
export const d3SymbolTriangle: SymbolType = symbolTriangle;
export const d3SymbolWye: SymbolType = symbolWye;

/**
 * generic wrapper around d3 symbols for rendering
 * @param symbol the symbol to render
 * @param fillStyle the style applied
 * @param size the size of the symbol
 * @returns {function(CanvasRenderingContext2D): undefined}
 */
export function d3Symbol(symbol: SymbolType = d3SymbolCircle, fillStyle: string = 'steelblue', size = 5): ISymbol<any> {
  return (ctx: CanvasRenderingContext2D) => {
    //before
    ctx.beginPath();
    return {
      //during
      render: (x: number, y: number) => {
        ctx.translate(x, y);
        symbol.draw(ctx, size);
        ctx.translate(-x, -y);
      },
      //after
      done: () => {
        ctx.closePath();
        ctx.fillStyle = fillStyle;
        ctx.fill();
      }
    };
  };
}

/**
 * circle symbol renderer (way faster than d3Symbol(d3symbolCircle)
 * @param fillStyle
 * @param size
 * @returns {function(CanvasRenderingContext2D): undefined}
 */
export function circleSymbol(fillStyle: string = 'steelblue', size = 20): ISymbol<any> {
  const r = Math.sqrt(size / Math.PI);
  const tau = 2 * Math.PI;

  const styles = {
    [ERenderMode.NORMAL]: fillStyle,
    [ERenderMode.HOVER]: 'orange',
    [ERenderMode.SELECTED]: 'red'
  };

  return (ctx: CanvasRenderingContext2D, mode: ERenderMode) => {
    //before
    ctx.beginPath();
    return {
      //during
      render: (x: number, y: number) => {
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, tau);
      },
      //after
      done: () => {
        ctx.closePath();
        ctx.fillStyle = styles[mode];
        ctx.fill();
      }
    };
  };
}
