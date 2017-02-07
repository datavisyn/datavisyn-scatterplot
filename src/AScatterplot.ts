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

export interface IScalesObject {
  xscale: IScale;
  yscale: IScale;
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

// TODO: split baseProps and childProps to two different types
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

/**
 * reasons why a new render pass is needed
 */
export enum ERenderReason {
  DIRTY,
  SELECTION_CHANGED,
  ZOOMED,
  PERFORM_SCALE_AND_TRANSLATE,
  AFTER_SCALE_AND_TRANSLATE,
  PERFORM_TRANSLATE,
  AFTER_TRANSLATE,
  PERFORM_SCALE,
  AFTER_SCALE
}


export declare type IMinMax = [number, number];

/**
 * visible window
 */
export interface IWindow {
  xMinMax: IMinMax;
  yMinMax: IMinMax;
}

export function fixScale<T>(current: IScale, acc: IAccessor<T>, data: T[], given: IScale, givenLimits: [number, number]) {
  if (given) {
    return given;
  }
  if (givenLimits) {
    return current.domain(givenLimits);
  }
  return current.domain(extent(data, acc));
}

export interface ITransformDelta {
  x: number;
  y: number;
  kx: number;
  ky: number;
}

/**
 * an class for rendering a scatterplot in a canvas
 */
abstract class AScatterplot<T> extends EventEmitter {

  static EVENT_SELECTION_CHANGED = 'selectionChanged';
  static EVENT_RENDER = 'render';
  static EVENT_WINDOW_CHANGED = 'windowChanged';

  // TODO: use childProps type
  private childProps;
  protected baseProps: IScatterplotOptions<T> = {
    margin: {
      left: 48,
      top: 10,
      bottom: 32,
      right: 10
    },
    clickRadius: 10,

    zoom: {
      scale: EScaleAxes.xy,
      delay: 300,
      scaleExtent: [1, +Infinity],
      window: null,
      scaleTo: 1,
      translateBy: [0, 0],
    },

    format: {},

    tooltipDelay: 500,

    showTooltip,

    isSelectEvent: (event: MouseEvent) => event.ctrlKey || event.altKey,

    lasso: {
      interval: 100
    },

    extras: null,

    aspectRatio: 1
  };


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

  constructor(data: T[], root: HTMLElement, childProps?) {
    super();

    this.parent = root.ownerDocument.createElement('div');

    //need to use d3 for d3.mouse to work
    const $parent = select(this.parent);

    if (this.baseProps.zoom.scale !== null) {
      const zoom = this.baseProps.zoom;
      //register zoom
      this.zoomBehavior = d3zoom()
        .on('start', this.onZoomStart.bind(this))
        .on('zoom', this.onZoom.bind(this))
        .on('end', this.onZoomEnd.bind(this))
        .scaleExtent(zoom.scaleExtent)
        .translateExtent([[0,0], [+Infinity, +Infinity]])
        .filter(() => d3event.button === 0 && (!this.isSelectAble() || !this.baseProps.isSelectEvent(<MouseEvent>d3event)));
      $parent
        .call(this.zoomBehavior)
        .on('wheel', () => d3event.preventDefault());
      if (zoom.window != null) {
        this.window = zoom.window;
      } else {
        this.zoomBehavior.scaleTo($parent, zoom.scaleTo);
        this.zoomBehavior.translateBy($parent, zoom.translateBy[0], zoom.translateBy[1]);
      }
    }
  }

  protected isSelectAble() {
    return this.baseProps.isSelectEvent != null && (<any>this.baseProps.isSelectEvent) !== false;
  }

  protected hasExtras() {
    return this.baseProps.extras != null;
  }

  protected hasTooltips() {
    return this.baseProps.showTooltip != null && (<any>this.baseProps.showTooltip) !== false;
  }

  /**
   * returns the current selection
   */
  get selection() {
    if (!this.isSelectAble()) {
      return [];
    }
    return this.selectionTree.data();
  }

  /**
   * sets the current selection
   * @param selection
   */
  set selection(selection: T[]) {
    this.setSelection(selection);
  }

  setSelection(selection: T[]): boolean {
    if (!this.isSelectAble()) {
      return false;
    }
    if (selection == null) {
      selection = []; //ensure valid value
    }
    //this.lasso.clear();
    if (selection.length === 0) {
      return this.clearSelection();
    }
    //find the delta
    let changed = false;
    const s = this.selection.slice();
    selection.forEach((sNew) => {
      const i = s.indexOf(sNew);
      if (i < 0) { //new
        this.selectionTree.add(sNew);
        changed = true;
      } else {
        s.splice(i, 1); //mark as used
      }
    });
    changed = changed || s.length > 0;
    //remove removed items
    this.selectionTree.removeAll(s);
    if (changed) {
      this.emit(AScatterplot.EVENT_SELECTION_CHANGED, this);
      this.render(ERenderReason.SELECTION_CHANGED);
    }
    return changed;
  }

  /**
   * clears the selection, same as .selection=[]
   */
  clearSelection(): boolean {
    const changed = this.selectionTree !== null && this.selectionTree.size() > 0;
    if (changed) {
      this.selectionTree = quadtree([], this.tree.x(), this.tree.y());
      this.emit(AScatterplot.EVENT_SELECTION_CHANGED, this);
      this.render(ERenderReason.SELECTION_CHANGED);
    }
    return changed;
  }

  /**
   * shortcut to add items to the selection
   * @param items
   */
  addToSelection(items: T[]) {
    if (items.length === 0 || !this.isSelectAble()) {
      return false;
    }
    this.selectionTree.addAll(items);
    this.emit(AScatterplot.EVENT_SELECTION_CHANGED, this);
    this.render(ERenderReason.SELECTION_CHANGED);
    return true;
  }

  /**
   * shortcut to remove items from the selection
   * @param items
   */
  removeFromSelection(items: T[]) {
    if (items.length === 0 || !this.isSelectAble()) {
      return false;
    }
    this.selectionTree.removeAll(items);
    this.emit(AScatterplot.EVENT_SELECTION_CHANGED, this);
    this.render(ERenderReason.SELECTION_CHANGED);
    return true;
  }


  protected selectWithTester(tester: ITester) {
    const selection = findByTester(this.tree, tester);
    return this.setSelection(selection);
  }

  protected checkResize() {
    const c = this.canvasDataLayer;
    if (c.width !== c.clientWidth || c.height !== c.clientHeight) {
      this.canvasSelectionLayer.width = c.width = c.clientWidth;
      this.canvasSelectionLayer.height = c.height = c.clientHeight;
      this.adaptMaxTranslation();
      return true;
    }
    return false;
  }

  private adaptMaxTranslation() {
    if (!this.zoomBehavior) {
      return;
    }

    const availableWidth = this.canvasDataLayer.width - this.baseProps.margin.left - this.baseProps.margin.right;
    const availableHeight = this.canvasDataLayer.height - this.baseProps.margin.top - this.baseProps.margin.bottom;
    this.zoomBehavior
      .extent([[0, 0], [availableWidth, availableHeight]])
      .translateExtent([[0, 0], [availableWidth, availableHeight]]);
  }

  protected rescale(axis: EScaleAxes, scale: IScale) {
    const c = this.currentTransform;
    const p = this.baseProps.zoom.scale;
    switch (axis) {
      case EScaleAxes.x:
        return p === EScaleAxes.x || p === EScaleAxes.xy ? c.rescaleX(scale) : scale;
      case EScaleAxes.y:
        return p === EScaleAxes.y || p === EScaleAxes.xy ? c.rescaleY(scale) : scale;
    }
    throw new Error('Not Implemented');
  }

  protected mousePosAtCanvas() {
    const pos = mouse(this.parent);
    // shift by the margin since the scales doesn't include them for better scaling experience
    return [pos[0] - this.baseProps.margin.left, pos[1] - this.baseProps.margin.top];
  }

  /**
   * sets the current visible window
   * @param window
   */
  set window(window: IWindow) {
    const {k, tx, ty} = this.window2transform(window);
    const $zoom = select(this.parent);
    this.zoomBehavior.scaleTo($zoom, k);
    this.zoomBehavior.translateBy($zoom, tx, ty);
    this.render();
  }

  private window2transform(window: IWindow) {
    const range2transform = (minMax: IMinMax, scale: IScale) => {
      const pmin = scale(minMax[0]);
      const pmax = scale(minMax[1]);
      const k = (scale.range()[1] - scale.range()[0]) / (pmax - pmin);
      return {k, t: (scale.range()[0] - pmin)};
    };
    const s = this.baseProps.zoom.scale;
    const x = (s === EScaleAxes.x || s === EScaleAxes.xy) ? range2transform(window.xMinMax, this.childProps.xscale) : null;
    const y = (s === EScaleAxes.y || s === EScaleAxes.xy) ? range2transform(window.yMinMax, this.childProps.yscale) : null;
    let k = 1;
    if (x && y) {
      k = Math.min(x.k, y.k);
    } else if (x) {
      k = x.k;
    } else if (y) {
      k = y.k;
    }
    return {
      k,
      tx: x ? x.t : 0,
      ty: y ? y.t : 0
    };
  }

  /**
   * returns the current visible window
   * @returns {{xMinMax: [number,number], yMinMax: [number,number]}}
   */
  get window(): IWindow {
    const {xscale, yscale} = this.transformedScales();
    return {
      xMinMax: <IMinMax>(xscale.range().map(xscale.invert.bind(xscale))),
      yMinMax: <IMinMax>(yscale.range().map(yscale.invert.bind(yscale)))
    };
  }

  protected onZoomStart() {
    this.zoomStartTransform = this.currentTransform;
  }

  protected onZoom() {
    const evt = <D3ZoomEvent<any,any>>d3event;
    const newValue: ZoomTransform = evt.transform;
    const oldValue = this.currentTransform;
    this.currentTransform = newValue;
    const scale = this.baseProps.zoom.scale;
    const tchanged = ((scale !== EScaleAxes.y && oldValue.x !== newValue.x) || (scale !== EScaleAxes.x && oldValue.y !== newValue.y));
    const schanged = (oldValue.k !== newValue.k);
    const delta = {
      x: (scale === EScaleAxes.x || scale === EScaleAxes.xy) ? newValue.x - oldValue.x : 0,
      y: (scale === EScaleAxes.y || scale === EScaleAxes.xy) ? newValue.y - oldValue.y : 0,
      kx: (scale === EScaleAxes.x || scale === EScaleAxes.xy) ? newValue.k / oldValue.k : 1,
      ky: (scale === EScaleAxes.y || scale === EScaleAxes.xy) ? newValue.k / oldValue.k : 1
    };
    if (tchanged && schanged) {
      this.emit(AScatterplot.EVENT_WINDOW_CHANGED, this.window);
      this.render(ERenderReason.PERFORM_SCALE_AND_TRANSLATE, delta);
    } else if (schanged) {
      this.emit(AScatterplot.EVENT_WINDOW_CHANGED, this.window);
      this.render(ERenderReason.PERFORM_SCALE, delta);
    } else if (tchanged) {
      this.emit(AScatterplot.EVENT_WINDOW_CHANGED, this.window);
      this.render(ERenderReason.PERFORM_TRANSLATE, delta);
    }
    //nothing if no changed
  }

  protected onZoomEnd() {
    const start = this.zoomStartTransform;
    const end = this.currentTransform;
    const tchanged = (start.x !== end.x || start.y !== end.y);
    const schanged = (start.k !== end.k);
    if (tchanged && schanged) {
      this.render(ERenderReason.AFTER_SCALE_AND_TRANSLATE);
    } else if (schanged) {
      this.render(ERenderReason.AFTER_SCALE);
    } else if (tchanged) {
      this.render(ERenderReason.AFTER_TRANSLATE);
    }
  }

  protected abstract transformedScales();
  protected abstract render(reason?: ERenderReason, transformDelta?: ITransformDelta);


}

export default AScatterplot;
