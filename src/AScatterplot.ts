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

export interface IScatterplotOptions<T> {
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

export interface IScatterplotBaseOptions<T> {
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

  private childProps: IScatterplotOptions<T>;
  protected baseProps: IScatterplotBaseOptions<T> = {
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

  constructor(data: T[], root: HTMLElement, baseProps?: IScatterplotBaseOptions<T>, childProps?: IScatterplotOptions<T>) {
    super();

    this.baseProps = merge(this.baseProps, baseProps);

    this.parent = root.ownerDocument.createElement('div');

    //need to use d3 for d3.mouse to work
    const $parent = select(this.parent);
    root.appendChild(this.parent);

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

    if (this.isSelectAble()) {
      const drag = d3drag()
        .on('start', this.onDragStart.bind(this))
        .on('drag', this.onDrag.bind(this))
        .on('end', this.onDragEnd.bind(this))
        .filter(() => d3event.button === 0 && this.baseProps.isSelectEvent(<MouseEvent>d3event));
      $parent.call(drag)
        .on('click', () => this.onClick(d3event));
    }
    if (this.hasTooltips()) {
      $parent.on('mouseleave', () => this.onMouseLeave(d3event))
        .on('mousemove', () => this.onMouseMove(d3event));
    }

    this.parent.classList.add(cssprefix);
  }

  protected initDOM(extraMarkup: string = '') {
    //init dom
    this.parent.innerHTML = `
      <canvas class="${cssprefix}-data-layer"></canvas>
      <canvas class="${cssprefix}-selection-layer" ${!this.isSelectAble() && !this.hasExtras() ? 'style="visibility: hidden"' : ''}></canvas>
      <svg class="${cssprefix}-axis-left" style="width: ${this.baseProps.margin.left + 2}px;">
        <g transform="translate(${this.baseProps.margin.left},${this.baseProps.margin.top})"><g>
      </svg>
      <svg class="${cssprefix}-axis-bottom" style="height: ${this.baseProps.margin.bottom}px;">
        <g transform="translate(${this.baseProps.margin.left},0)"><g>
      </svg>
      <div class="${cssprefix}-axis-bottom-label" style="left: ${this.baseProps.margin.left + 2}px; right: ${this.baseProps.margin.right}px"><div>${this.props.xlabel}</div></div>
      <div class="${cssprefix}-axis-left-label"  style="top: ${this.baseProps.margin.top + 2}px; bottom: ${this.baseProps.margin.bottom}px"><div>${this.props.ylabel}</div></div>
      ${extraMarkup}
    `;
  }

  get data() {
    return this.tree.data();
  }

  protected setDataImpl(data: T[]) {
    //generate a quad tree out of the data
    //work on a normalized dimension within the quadtree to
    // * be independent of the current pixel size
    // * but still consider the mapping function (linear, pow, log) from the data domain
    const domain2normalizedX = this.props.xscale.copy().range(this.normalized2pixel.x.domain());
    const domain2normalizedY = this.props.yscale.copy().range(this.normalized2pixel.y.domain());
    this.tree = quadtree(data, (d) => domain2normalizedX(this.props.x(d)), (d) => domain2normalizedY(this.props.y(d)));
  }

  set data(data: T[]) {
    this.setDataImpl(data);
    this.selectionTree = quadtree([], this.tree.x(), this.tree.y());
    this.render(ERenderReason.DIRTY);
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

  protected resized() {
    this.render(ERenderReason.DIRTY);
  }

  protected getMouseNormalizedPos(canvasPixelPox = this.mousePosAtCanvas()) {
    const {n2pX, n2pY} = this.transformedNormalized2PixelScales();

    function range(range: number[]) {
      return Math.abs(range[1] - range[0]);
    }

    const computeClickRadius = () => {
      //compute the data domain radius based on xscale and the scaling factor
      const view = this.baseProps.clickRadius;
      const transform = this.currentTransform;
      const scale = this.baseProps.zoom.scale;
      const kX = (scale === EScaleAxes.x || scale === EScaleAxes.xy) ? transform.k : 1;
      const kY = (scale === EScaleAxes.y || scale === EScaleAxes.xy) ? transform.k : 1;
      const viewSizeX = kX * range(this.normalized2pixel.x.range());
      const viewSizeY = kY * range(this.normalized2pixel.y.range());
      //transform from view to data without translation
      const normalizedRangeX = range(this.normalized2pixel.x.domain());
      const normalizedRangeY = range(this.normalized2pixel.y.domain());
      const normalizedX = view / viewSizeX * normalizedRangeX;
      const normalizedY = view / viewSizeY * normalizedRangeY;
      //const view = this.props.xscale(base)*transform.k - this.props.xscale.range()[0]; //skip translation
      //debuglog(view, viewSize, transform.k, normalizedSize, normalized);
      return [normalizedX, normalizedY];
    };

    const [clickRadiusX, clickRadiusY] = computeClickRadius();
    return {x: n2pX.invert(canvasPixelPox[0]), y: n2pY.invert(canvasPixelPox[1]), clickRadiusX, clickRadiusY};
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
    const x = (s === EScaleAxes.x || s === EScaleAxes.xy) ? range2transform(window.xMinMax, this.props.xscale) : null;
    const y = (s === EScaleAxes.y || s === EScaleAxes.xy) ? range2transform(window.yMinMax, this.props.yscale) : null;
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

  private onZoomStart() {
    this.zoomStartTransform = this.currentTransform;
  }

  private onZoom() {
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

  private onZoomEnd() {
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

  private onDragStart() {
    this.lasso.start(d3event.x, d3event.y);
    if (!this.clearSelection()) {
      this.render(ERenderReason.SELECTION_CHANGED);
    }
  }

  private onDrag() {
    if (this.dragHandle < 0) {
      this.dragHandle = setInterval(this.updateDrag.bind(this), this.baseProps.lasso.interval);
    }
    this.lasso.setCurrent(d3event.x, d3event.y);
    this.render(ERenderReason.SELECTION_CHANGED);
  }

  private updateDrag() {
    if (this.lasso.pushCurrent()) {
      this.retestLasso();
    }
  }

  private onDragEnd() {
    clearInterval(this.dragHandle);
    this.dragHandle = -1;

    this.lasso.end(d3event.x, d3event.y);
    if (!this.retestLasso()) {
      this.render(ERenderReason.SELECTION_CHANGED);
    }
    this.lasso.clear();
  }

  private retestLasso() {
    const {n2pX, n2pY} = this.transformedNormalized2PixelScales();
    // shift by the margin since the scales doesn't include them for better scaling experience
    const tester = this.lasso.tester(n2pX.invert.bind(n2pX), n2pY.invert.bind(n2pY), -this.baseProps.margin.left, -this.baseProps.margin.top);
    return tester && this.selectWithTester(tester);
  }

  private onClick(event: MouseEvent) {
    if (event.button > 0) {
      //right button or something like that = reset
      this.selection = [];
      return;
    }
    const {x, y, clickRadiusX, clickRadiusY} = this.getMouseNormalizedPos();
    //find closest data item
    const tester = ellipseTester(x, y, clickRadiusX, clickRadiusY);
    this.selectWithTester(tester);
  }

  private showTooltip(canvasPos: [number, number]) {
    //highlight selected item
    const {x, y, clickRadiusX, clickRadiusY} = this.getMouseNormalizedPos(canvasPos);
    const tester = ellipseTester(x, y, clickRadiusX, clickRadiusY);
    const items = findByTester(this.tree, tester);
    // canvas pos doesn't include the margin
    this.baseProps.showTooltip(this.parent, items, canvasPos[0] +  this.baseProps.margin.left, canvasPos[1] + this.baseProps.margin.top);
    this.showTooltipHandle = -1;
  }

  private onMouseMove(event: MouseEvent) {
    if (this.showTooltipHandle >= 0) {
      this.onMouseLeave(event);
    }
    const pos = this.mousePosAtCanvas();
    //TODO find a more efficient way or optimize the timing
    this.showTooltipHandle = setTimeout(this.showTooltip.bind(this, pos), this.baseProps.tooltipDelay);
  }

  private onMouseLeave(event: MouseEvent) {
    clearTimeout(this.showTooltipHandle);
    this.showTooltipHandle = -1;
    this.baseProps.showTooltip(this.parent, [], 0, 0);
  }

  protected traverseTree(ctx: CanvasRenderingContext2D, tree: Quadtree<T>, renderer: ISymbolRenderer<T>, xscale: IScale, yscale: IScale, isNodeVisible: IBoundsPredicate, useAggregation: IBoundsPredicate, debug = false, x: IAccessor<T>, y: IAccessor<T>) {
    //debug stats
    let rendered = 0, aggregated = 0, hidden = 0;

    function visitTree(node: QuadtreeInternalNode<T> | QuadtreeLeaf<T>, x0: number, y0: number, x1: number, y1: number) {
      if (!isNodeVisible(x0, y0, x1, y1)) {
        hidden += debug ? getTreeSize(node) : 0;
        return ABORT_TRAVERSAL;
      }
      if (useAggregation(x0, y0, x1, y1)) {
        const d = getFirstLeaf(node);
        //debuglog('aggregate', getTreeSize(node));
        rendered++;
        aggregated += debug ? (getTreeSize(node) - 1) : 0;
        renderer.render(xscale(x(d)), yscale(y(d)), d);
        return ABORT_TRAVERSAL;
      }
      if (isLeafNode(node)) { //is a leaf
        rendered += forEachLeaf(<QuadtreeLeaf<T>>node, (d) => renderer.render(xscale(x(d)), yscale(y(d)), d));
      }
      return CONTINUE_TRAVERSAL;
    }

    ctx.save();

    tree.visit(visitTree);
    renderer.done();

    if (debug) {
      debuglog('rendered', rendered, 'aggregated', aggregated, 'hidden', hidden, 'total', this.tree.size());
    }

    //a dummy path to clear the 'to draw' state
    ctx.beginPath();
    ctx.closePath();

    ctx.restore();
  }

  protected setAxisFormat = (axis: Axis<number>, key: string) => {
    const p = this.baseProps.format[key];
    if (p == null) {
      return;
    }
    axis.tickFormat(typeof p === 'string' ? format(p) : p);
  }

  protected transformData(c, bounds, boundsWidth, boundsHeight, x: number, y: number, kx: number, ky: number) {
    //idea copy the data layer to selection layer in a transformed way and swap
    const ctx = this.canvasSelectionLayer.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.save();
    ctx.rect(bounds.x0, bounds.y0, boundsWidth, boundsHeight);
    ctx.clip();

    //ctx.translate(bounds.x0, bounds.y0+bounds_height); //move to visible area
    //debuglog(x,y,k, bounds.x0, bounds.y0, n2pX(0), n2pY(100), this.currentTransform.x, this.currentTransform.y);
    //ctx.scale(k,k);
    //ctx.translate(0, -bounds_height); //move to visible area
    ctx.translate(x, y);
    //copy just the visible area
    //canvas, clip area, target area
    //see http://www.w3schools.com/tags/canvas_drawimage.asp
    ctx.drawImage(this.canvasDataLayer, bounds.x0, bounds.y0, boundsWidth, boundsHeight, bounds.x0, bounds.y0, boundsWidth * kx, boundsHeight * ky);
    ctx.restore();

    //swap and update class names
    [this.canvasDataLayer, this.canvasSelectionLayer] = [this.canvasSelectionLayer, this.canvasDataLayer];
    this.canvasDataLayer.className = `${cssprefix}-data-layer`;
    this.canvasSelectionLayer.className = `${cssprefix}-selection-layer`;
  }

  protected abstract normalized2pixel;
  protected abstract props: IScatterplotOptions<T>;
  protected abstract transformedNormalized2PixelScales();
  protected abstract transformedScales();
  protected abstract render(reason?: ERenderReason, transformDelta?: ITransformDelta);
}

export default AScatterplot;
