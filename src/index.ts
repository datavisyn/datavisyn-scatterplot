/**
 * Created by sam on 19.12.2016.
 */

import './style.scss';
import Scatterplot, {IScatterplotOptions} from './Scatterplot';
import DualAxisScatterplot, {IScatterplotOptions as DualAxisScatterplotOptions} from './DualAxisScatterplot';
import * as _symbol from './symbol';
import * as d3scale from 'd3-scale';
export {default as Scatterplot, EScaleAxes, IAccessor, IScale, IScatterplotOptions, IWindow, IZoomOptions} from './Scatterplot';
export {default as DualAxisScatterplot} from './DualAxisScatterplot';
//export {default as MiniMap} from './MiniMap';

/**
 * reexport d3 scale
 */
export const scale = d3scale;
export const symbol = _symbol;

export default Scatterplot;

export function create<T>(data:T[], canvas:HTMLCanvasElement, options: IScatterplotOptions<T>):Scatterplot<T> {
  return new Scatterplot(data, canvas);
}

export function dualAxis<T>(data:T[], secondaryData:T[], canvas:HTMLCanvasElement, options: DualAxisScatterplotOptions<T>) {
  return new DualAxisScatterplot(data, secondaryData, canvas, options);
}
