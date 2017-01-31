/**
 * Created by sam on 19.12.2016.
 */

import './style.scss';
import Scatterplot from './Scatterplot';
import DualAxisScatterplot from './DualAxisScatterplot';
import * as _symbol from './symbol';
import * as d3scale from 'd3-scale';
export {default as Scatterplot, EScaleAxes, IAccessor, IScale, IScatterplotOptions, IWindow, IZoomOptions} from './Scatterplot';
//export {default as MiniMap} from './MiniMap';

/**
 * reexport d3 scale
 */
export const scale = d3scale;
export const symbol = _symbol;

export default Scatterplot;

export function create<T>(data:T[], canvas:HTMLCanvasElement):Scatterplot<T> {
  return new Scatterplot(data, canvas);
}

export function dualAxis(data, secondaryData, canvas) {
  return new DualAxisScatterplot(data, secondaryData, canvas);
}
