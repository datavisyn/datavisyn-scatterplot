/**
 * Created by sam on 19.12.2016.
 */

import './style.scss';
import Scatterplot from './Scatterplot';
import DualAxisScatterplot, {IDualAxisScatterplotOptions} from './DualAxisScatterplot';
import * as _symbol from './symbol';
import * as d3scale from 'd3-scale';
import {IScatterplotOptions} from './AScatterplot';

export {default, default as Scatterplot} from './Scatterplot';
export * from './Scatterplot';
export {default as DualAxisScatterplot} from './DualAxisScatterplot';
export * from './DualAxisScatterplot';
export * from './AScatterplot';
export {ISymbol, ERenderMode, ISymbolRenderer, IRenderInfo, IStyleSymbolOptions, ISymbolOptions} from './symbol';
//export {default as MiniMap} from './MiniMap';

/**
 * reexport d3 scale
 */
export const scale = d3scale;
export const symbol = _symbol;

export function create<T>(data:T[], canvas:HTMLCanvasElement, options: IScatterplotOptions<T>):Scatterplot<T> {
  return new Scatterplot(data, canvas, options);
}

export function dualAxis<T, U>(data:T[], secondaryData:U[], canvas:HTMLCanvasElement, options: IDualAxisScatterplotOptions<T, U>) {
  return new DualAxisScatterplot(data, secondaryData, canvas, options);
}
