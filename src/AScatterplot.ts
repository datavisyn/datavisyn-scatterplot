import {axisLeft, axisBottom, AxisScale, Axis} from 'd3-axis';
import {extent} from 'd3-array';
import {format} from 'd3-format';
import {scaleLinear} from 'd3-scale';
import {select, mouse, event as d3event} from 'd3-selection';
import {zoom as d3zoom, ZoomScale, ZoomTransform, D3ZoomEvent, zoomIdentity, ZoomBehavior} from 'd3-zoom';
import {drag as d3drag} from 'd3-drag';
import {quadtree, Quadtree, QuadtreeInternalNode, QuadtreeLeaf} from 'd3-quadtree';
import {circleSymbol, ISymbol, ISymbolRenderer, ERenderMode, createRenderer} from './symbol';
import merge from './merge';
import {
  forEachLeaf,
  ellipseTester,
  isLeafNode,
  hasOverlap,
  getTreeSize,
  findByTester,
  getFirstLeaf,
  ABORT_TRAVERSAL,
  CONTINUE_TRAVERSAL,
  IBoundsPredicate,
  ITester
} from './quadtree';
import Lasso, {ILassoOptions} from './lasso';
import {cssprefix, DEBUG, debuglog} from './constants';
import showTooltip from './tooltip';
import {EventEmitter} from 'eventemitter3';

export enum EScaleAxes {
  x, y, xy
}


/**
 * a d3 scale essentially
 */
export interface IScale extends AxisScale<number>, ZoomScale {
  range(range: number[]);
  range(): number[];
  domain(): number[];
  domain(domain: number[]);
  invert(v: number): number;
  copy(): this;
}

export interface IAccessor<T> {
  (v: T): number;
}


export interface IZoomOptions {
  /**
   * scaling option whether to scale both, one, or no axis
   */
  scale?: EScaleAxes;

  /**
   * delay before a full redraw is shown during zooming
   */
  delay?: number;
  /**
   * min max scaling factor
   * default: 0.1, 10
   */
  scaleExtent?: [number, number];

  /**
   * initial zoom window
   */
  window?: IWindow;

  /**
   * initial scale factor
   */
  scaleTo?: number;
  /**
   * initial translate
   */
  translateBy?: [number, number];
}

export interface IFormatOptions {
  /**
   * d3 format used for formatting the x axis
   */
  x?: string | ((n: number) => string);
  /**
   * d3 format used for formatting the y axis
   */
  y?: string | ((n: number) => string);
}

/**
 * scatterplot options
 */
export interface IScatterplotOptions<T> {
  /**
   * margin for the scatterplot area
   * default (left=40, top=10, right=10, bottom=20)
   */
  margin?: {
    left?: number;
    top?: number;
    right?: number;
    bottom?: number;
  };

  zoom?: IZoomOptions;

  format?: IFormatOptions;

  /**
   * x accessor of the data
   * default: d.x
   * @param d
   */
  x?: IAccessor<T>;

  /**
   * x axis label
   * default: x
   */
  xlabel?: string;

  /**
   * y axis label
   * default: x
   */
  ylabel?: string;

  /**
   * y accessor of the data
   * default: d.y
   * @param d
   */
  y?: IAccessor<T>;

  /**
   * d3 x scale
   * default: linear scale with a domain from 0...100
   */
  xscale?: IScale;

  /**
   * instead of specifying the scale just the x limits
   */
  xlim?: [number, number];

  /**
   * d3 y scale
   * default: linear scale with a domain from 0...100
   */
  yscale?: IScale;

  /**
   * instead of specifying the scale just the y limits
   */
  ylim?: [number, number];

  /**
   * symbol used to render an data point
   * default: steelblue circle
   */
  symbol?: ISymbol<T>|string;

  /**
   * the radius in pixel in which a mouse click will be searched
   * default: 10
   */
  clickRadius?: number;

  /**
   * delay before a tooltip will be shown after a mouse was moved
   * default: 500
   */
  tooltipDelay?: number;

  /**
   * shows the tooltip
   * default: simple popup similar to bootstrap
   * if `null` or `false` tooltips are disabled
   * @param parent the scatterplot html element
   * @param items items to show, empty to hide tooltip
   * @param x the x position relative to the plot
   * @param y the y position relative to the plot
   */
  showTooltip?(parent: HTMLElement, items: T[], x: number, y: number);

  /**
   * determines whether the given mouse is a selection or panning event, if `null` or `false` selection is disabled
   * default: event.ctrlKey || event.altKey
   *
   */
  isSelectEvent?(event: MouseEvent): boolean; //=> event.ctrlKey || event.altKey

  /**
   * lasso options
   */
  lasso?: ILassoOptions & {
    /**
     * lasso update frequency to improve performance
     */
    interval?: number
  };

  /**
   * additional render elements, e.g. lines
   * @param ctx
   * @param xscale
   * @param yscale
   */
  extras?(ctx: CanvasRenderingContext2D, xscale: IScale, yscale: IScale);

  /**
   * optional hint for the scatterplot in which aspect ratio it will be rendered. This is useful for improving the selection and interaction in non 1:1 aspect ratios
   */
  aspectRatio?: number;
}

export declare type IMinMax = [number, number];

/**
 * visible window
 */
export interface IWindow {
  xMinMax: IMinMax;
  yMinMax: IMinMax;
}

function fixScale<T>(current: IScale, acc: IAccessor<T>, data: T[], given: IScale, givenLimits: [number, number]) {
  if (given) {
    return given;
  }
  if (givenLimits) {
    return current.domain(givenLimits);
  }
  return current.domain(extent(data, acc));
}

/**
 * an class for rendering a scatterplot in a canvas
 */
abstract class AScatterplot<T> extends EventEmitter {

  static EVENT_SELECTION_CHANGED = 'selectionChanged';
  static EVENT_RENDER = 'render';
  static EVENT_WINDOW_CHANGED = 'windowChanged';


  protected canvasDataLayer: HTMLCanvasElement;
  protected canvasSelectionLayer: HTMLCanvasElement;
  protected tree: Quadtree<T>;

  protected selectionTree: Quadtree<T>;

  /**
   * timout handle when the tooltip is shown
   * @type {number}
   */
  protected showTooltipHandle = -1;

  protected readonly lasso = new Lasso();

  protected currentTransform: ZoomTransform = zoomIdentity;
  protected zoomBehavior: ZoomBehavior<HTMLElement, any>;
  protected zoomStartTransform: ZoomTransform;
  protected zoomHandle = -1;
  protected dragHandle = -1;

  protected readonly parent: HTMLElement;

  constructor(data: T[], root: HTMLElement) {
    super();

    this.parent = root.ownerDocument.createElement('div');
  }

}

export default AScatterplot;
