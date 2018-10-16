import {AxisScale, Axis} from 'd3-axis';
import {extent} from 'd3-array';
import {format} from 'd3-format';
import {select, mouse, event as d3event} from 'd3-selection';
import {zoom as d3zoom, ZoomScale, ZoomTransform, D3ZoomEvent, zoomIdentity, ZoomBehavior} from 'd3-zoom';
import {drag as d3drag} from 'd3-drag';
import {scaleLinear} from 'd3-scale';
import {quadtree, Quadtree, QuadtreeInternalNode, QuadtreeLeaf} from 'd3-quadtree';
import {ISymbol, ISymbolRenderer} from './symbol';
import merge from './merge';
import {
  forEachLeaf,
  ellipseTester,
  isLeafNode,
  getTreeSize,
  findByTester,
  getFirstLeaf,
  ABORT_TRAVERSAL,
  CONTINUE_TRAVERSAL,
  IBoundsPredicate,
  ITester
} from './quadtree';
import Lasso, {ILassoOptions, defaultOptions} from './lasso';
import {cssprefix, debuglog} from './constants';
import showTooltip from './tooltip';
import {EventEmitter} from 'eventemitter3';

export enum EScaleAxes {
  x, y, xy
}

export interface IBoundsObject {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * a d3 scale essentially
 */
export interface IScale extends AxisScale<number>, ZoomScale {
  range(range: number[]): this;
  range(): number[];
  domain(): number[];
  domain(domain: number[]): this;
  invert(v: number): number;
  copy(): this;
}

export interface IScalesObject {
  x: IScale;
  y: IScale;
}

export interface INormalizedScalesObject {
  n2pX: IScale;
  n2pY: IScale;
}

export interface IAccessor<T> {
  (v: T): number;
}

export interface IZoomOptions {
  /**
   * scaling option whether to scale both, one, or no axis
   */
  scale: EScaleAxes;

  /**
   * delay before a full redraw is shown during zooming
   */
  zoomDelay: number;
  /**
   * min max scaling factor
   * default: 0.1, 10
   */
  zoomScaleExtent: [number, number];

  /**
   * initial zoom window
   */
  zoomWindow: IWindow|null;

  /**
   * initial scale factor
   */
  zoomScaleTo: number;
  /**
   * initial translate
   */
  zoomTranslateBy: [number, number];
}

export interface IFormatOptions {
  [key: string]: string | ((n: number) => string) | null;
}
export interface ITickOptions {
  [key: string]: number[] | ((s: IScale) => number[]) | null;
}

/**
 * margin for the scatterplot area
 * default (left=40, top=10, right=10, bottom=20)
 */
export interface IMarginOptions {
  marginLeft: number;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  canvasBorder: number;
}

/**
 * scatterplot options
 */
export interface IScatterplotOptions<T> extends IMarginOptions, IZoomOptions {
  format: IFormatOptions;
  ticks: ITickOptions;

  /**
   * x accessor of the data
   * default: d.x
   * @param d
   */
  x: IAccessor<T>;

  /**
   * x axis label
   * default: x
   */
  xlabel: string;

  /**
   * y axis label
   * default: x
   */
  ylabel: string;

  /**
   * y accessor of the data
   * default: d.y
   * @param d
   */
  y: IAccessor<T>;

  /**
   * d3 x scale
   * default: linear scale with a domain from 0...100
   */
  xscale: IScale;

  /**
   * instead of specifying the scale just the x limits
   */
  xlim: [number, number]|null;

  /**
   * d3 y scale
   * default: linear scale with a domain from 0...100
   */
  yscale: IScale;

  /**
   * instead of specifying the scale just the y limits
   */
  ylim: [number, number]|null;

  /**
   * symbol used to render an data point
   * default: steelblue circle
   */
  symbol: ISymbol<T> | string;

  /**
   * the radius in pixel in which a mouse click will be searched
   * default: 10
   */
  clickRadius: number;

  /**
   * delay before a tooltip will be shown after a mouse was moved
   * default: 500
   */
  tooltipDelay: number;

  /**
   * shows the tooltip
   * default: simple popup similar to bootstrap
   * if `null` or `false` tooltips are disabled
   * @param parent the scatterplot html element
   * @param items items to show, empty to hide tooltip
   * @param x the x position relative to the plot
   * @param y the y position relative to the plot
   * @param event the MouseEvent
   */
  showTooltip(parent: HTMLElement, items: T[], x: number, y: number, event?: MouseEvent): void;

  /**
   * determines whether the given mouse is a selection or panning event, if `null` or `false` selection is disabled
   * default: event.ctrlKey || event.altKey
   *
   */
  isSelectEvent: ((event: MouseEvent) => boolean) | null | false;

  /**
   * lasso options
   */
  lasso: Partial<ILassoOptions & {
    /**
     * lasso update frequency to improve performance
     */
    interval: number
  }>;

  /**
   * additional render elements, e.g. lines
   * @param ctx
   * @param xscale
   * @param yscale
   */
  extras: ((ctx: CanvasRenderingContext2D, xscale: IScale, yscale: IScale) => void)|null;

  /**
   * optional hint for the scatterplot in which aspect ratio it will be rendered. This is useful for improving the selection and interaction in non 1:1 aspect ratios
   */
  aspectRatio: number;

  /**
   * additional background rendering
   */
  renderBackground: ((ctx: CanvasRenderingContext2D, xscale: IScale, yscale: IScale) => void)|null;
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

/**
 * @internal
 */
export function fixScale<T>(current: IScale, acc: IAccessor<T>, data: (T)[], given: IScale|null|undefined, givenLimits: [number, number]|null|undefined) {
  if (given) {
    return given;
  }
  if (givenLimits) {
    return current.domain(givenLimits);
  }
  const ex = extent(data, acc);
  return current.domain([ex[0]!, ex[1]!]);
}

export interface ITransformDelta {
  x: number;
  y: number;
  kx: number;
  ky: number;
}

function defaultProps<T>(): Readonly<IScatterplotOptions<T>> {
  return {
    marginLeft: 48,
    marginTop: 10,
    marginBottom: 32,
    marginRight: 10,
    canvasBorder: 0,
    clickRadius: 10,

    x: (d) => (<any>d).x,
    y: (d) => (<any>d).y,

    xlabel: 'x',
    ylabel: 'y',

    xscale: <IScale>scaleLinear().domain([0, 100]),
    xlim: null,
    yscale: <IScale>scaleLinear().domain([0, 100]),
    ylim: null,

    symbol: 'o',

    scale: EScaleAxes.xy,
    zoomDelay: 300,
    zoomScaleExtent: [1, +Infinity],
    zoomWindow: null,
    zoomScaleTo: 1,
    zoomTranslateBy: [0, 0],

    format: {},
    ticks: {},

    tooltipDelay: 500,

    showTooltip,

    isSelectEvent: (event: MouseEvent) => event.ctrlKey || event.altKey,

    lasso: Object.assign({
      interval: 100
    }, defaultOptions()),

    extras: null,
    renderBackground: null,

    aspectRatio: 1
  };
}

/**
 * an class for rendering a scatterplot in a canvas
 */
abstract class AScatterplot<T, C extends IScatterplotOptions<T>> extends EventEmitter {

  static EVENT_SELECTION_CHANGED = 'selectionChanged';
  static EVENT_SELECTION_IN_PROGRESS_CHANGED = 'selectionInProgressChanged';
  static EVENT_RENDER = 'render';
  static EVENT_WINDOW_CHANGED = 'windowChanged';

  protected canvasDataLayer: HTMLCanvasElement|null = null;
  protected canvasSelectionLayer: HTMLCanvasElement|null = null;
  protected tree: Quadtree<T>|null = null;

  protected selectionTree: Quadtree<T>|null = null;

  /**
   * timout handle when the tooltip is shown
   * @type {number}
   */
  protected showTooltipHandle = -1;

  protected readonly lasso = new Lasso();

  protected currentTransform: ZoomTransform = zoomIdentity;
  protected readonly zoomBehavior: ZoomBehavior<HTMLElement, any> | null;
  protected zoomStartTransform: ZoomTransform = zoomIdentity;
  protected zoomHandle = -1;
  protected dragHandle = -1;

  protected readonly parent: HTMLElement;

  protected props: C;
  protected abstract normalized2pixel: IScalesObject;
  protected abstract transformedNormalized2PixelScales(): INormalizedScalesObject;
  abstract transformedScales(): IScalesObject;
  abstract render(reason?: ERenderReason, transformDelta?: ITransformDelta): void;

  constructor(root: HTMLElement, props?: Partial<C>) {
    super();
    this.props = <C>merge(defaultProps(), props);
    this.parent = root.ownerDocument.createElement('div');

    //need to use d3 for d3.mouse to work
    const $parent = select<HTMLElement, null>(this.parent);
    root.appendChild(this.parent);

    if (this.props.scale !== null) {
      //register zoom
      this.zoomBehavior = d3zoom<HTMLElement, any>()
        .on('start', this.onZoomStart.bind(this))
        .on('zoom', this.onZoom.bind(this))
        .on('end', this.onZoomEnd.bind(this))
        .scaleExtent(this.props.zoomScaleExtent)
        .translateExtent([[0, 0], [+Infinity, +Infinity]])
        .filter(() => d3event.button === 0 && (typeof this.props.isSelectEvent !== 'function' || !this.props.isSelectEvent(<MouseEvent>d3event)));
      if (this.props.zoomWindow != null) {
        this.window = this.props.zoomWindow;
      } else {
        const z = zoomIdentity.scale(this.props.zoomScaleTo).translate(this.props.zoomTranslateBy[0], this.props.zoomTranslateBy[1]);
        this.zoomBehavior.transform($parent, z);
      }
    } else {
      this.zoomBehavior = null;
    }

    if (typeof this.props.isSelectEvent === 'function') {
      const drag = d3drag<HTMLElement, null>()
        .container(function(this: any) { return this; })
        .on('start', this.onDragStart.bind(this))
        .on('drag', this.onDrag.bind(this))
        .on('end', this.onDragEnd.bind(this))
        .filter(() => d3event.button === 0 && typeof this.props.isSelectEvent === 'function' && this.props.isSelectEvent(<MouseEvent>d3event));
      $parent.call(drag)
        .on('click', () => this.onClick(d3event));
    }
    if (this.hasTooltips()) {
      $parent.on('mouseleave', () => this.onMouseLeave(d3event))
        .on('mousemove', () => this.onMouseMove(d3event));
    }

    this.parent.classList.add(cssprefix);
  }

  get node() {
    return this.parent;
  }

  protected initDOM(extraMarkup: string = '') {
    //init dom
    this.parent.innerHTML = `
      <canvas class="${cssprefix}-data-layer"></canvas>
      <canvas class="${cssprefix}-selection-layer" ${typeof this.props.isSelectEvent !== 'function' && this.props.extras == null ? 'style="visibility: hidden"' : ''}></canvas>
      <div class="${cssprefix}-draw-area"  style="left: ${this.props.marginLeft}px; right: ${this.props.marginRight}px; top: ${this.props.marginTop}px; bottom: ${this.props.marginBottom}px"></div>
      <svg class="${cssprefix}-axis-left" style="width: ${this.props.marginLeft + 2}px;">
        <g transform="translate(${this.props.marginLeft},${this.props.marginTop})"><g>
      </svg>
      <svg class="${cssprefix}-axis-bottom" style="height: ${this.props.marginBottom}px;">
        <g transform="translate(${this.props.marginLeft},0)"><g>
      </svg>
      <div class="${cssprefix}-axis-bottom-label" style="left: ${this.props.marginLeft + 2}px; right: ${this.props.marginRight}px"><div>${this.props.xlabel}</div></div>
      <div class="${cssprefix}-axis-left-label"  style="top: ${this.props.marginTop + 2}px; bottom: ${this.props.marginBottom}px"><div>${this.props.ylabel}</div></div>
      ${extraMarkup}
    `;

    if (!this.zoomBehavior) {
      return;
    }
    select(this.parent).select<HTMLElement>(`.${cssprefix}-draw-area`)
      .call(this.zoomBehavior)
      .on('wheel', () => d3event.preventDefault());
  }

  get data() {
    return this.tree ? this.tree!.data() : [];
  }

  protected setDataImpl(data: T[]) {
    //generate a quad tree out of the data
    //work on a normalized dimension within the quadtree to
    // * be independent of the current pixel size
    // * but still consider the mapping function (linear, pow, log) from the data domain
    const domain2normalizedX = this.props.xscale.copy().range(this.normalized2pixel.x.domain());
    const domain2normalizedY = this.props.yscale.copy().range(this.normalized2pixel.y.domain());
    this.tree = quadtree(data, (d) => domain2normalizedX(this.props.x(d))!, (d) => domain2normalizedY(this.props.y(d))!);
  }

  set data(data: T[]) {
    this.setDataImpl(data);
    this.selectionTree = quadtree([], this.tree!.x(), this.tree!.y());
    this.render(ERenderReason.DIRTY);
  }

  /**
   * returns the total domain
   * @returns {{xMinMax: number[], yMinMax: number[]}}
   */
  get domain(): IWindow {
    return {
      xMinMax: <IMinMax>this.props.xscale.domain(),
      yMinMax: <IMinMax>this.props.yscale.domain(),
    };
  }

  protected hasTooltips() {
    return this.props.showTooltip != null && (<any>this.props.showTooltip) !== false;
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
      const view = this.props.clickRadius;
      const transform = this.currentTransform;
      const scale = this.props.scale;
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
    if (typeof this.props.isSelectEvent !== 'function') {
      return [];
    }
    return this.selectionTree!.data();
  }

  /**
   * sets the current selection
   * @param selection
   */
  set selection(selection: T[]) {
    this.setSelection(selection);
  }

  setSelection(selection: T[]): boolean {
    return this.setSelectionImpl(selection);
  }

  private setSelectionImpl(selection: T[], inProgress = false): boolean {
    if (typeof this.props.isSelectEvent !== 'function') {
      return false;
    }
    if (selection == null) {
      selection = []; //ensure valid value
    }
    //this.lasso.clear();
    if (selection.length === 0) {
      return this.clearSelectionImpl(inProgress);
    }
    //find the delta
    let changed = false;
    const s = this.selection.slice();
    selection.forEach((sNew) => {
      const i = s.indexOf(sNew);
      if (i < 0) { //new
        this.selectionTree!.add(sNew);
        changed = true;
      } else {
        s.splice(i, 1); //mark as used
      }
    });
    changed = changed || s.length > 0;
    //remove removed items
    this.selectionTree!.removeAll(s);
    if (changed) {
      this.emit(inProgress ? AScatterplot.EVENT_SELECTION_IN_PROGRESS_CHANGED : AScatterplot.EVENT_SELECTION_CHANGED, this);
      this.render(ERenderReason.SELECTION_CHANGED);
    }
    return changed;
  }

  /**
   * clears the selection, same as .selection=[]
   */
  clearSelection(): boolean {
    return this.clearSelection();
  }

  private clearSelectionImpl(inProgress = false): boolean {
    const changed = this.selectionTree !== null && this.selectionTree.size() > 0;
    if (changed) {
      this.selectionTree = quadtree([], this.tree!.x(), this.tree!.y());
      this.emit(inProgress ? AScatterplot.EVENT_SELECTION_IN_PROGRESS_CHANGED : AScatterplot.EVENT_SELECTION_CHANGED, this);
      this.render(ERenderReason.SELECTION_CHANGED);
    }
    return changed;
  }

  /**
   * shortcut to add items to the selection
   * @param items
   */
  addToSelection(items: T[]) {
    if (items.length === 0 || typeof this.props.isSelectEvent !== 'function') {
      return false;
    }
    this.selectionTree!.addAll(items);
    this.emit(AScatterplot.EVENT_SELECTION_CHANGED, this);
    this.render(ERenderReason.SELECTION_CHANGED);
    return true;
  }

  /**
   * shortcut to remove items from the selection
   * @param items
   */
  removeFromSelection(items: T[]) {
    if (items.length === 0 || typeof this.props.isSelectEvent !== 'function') {
      return false;
    }
    this.selectionTree!.removeAll(items);
    this.emit(AScatterplot.EVENT_SELECTION_CHANGED, this);
    this.render(ERenderReason.SELECTION_CHANGED);
    return true;
  }


  protected selectWithTester(tester: ITester, inProgress = false) {
    const selection = findByTester(this.tree!, tester);
    return this.setSelectionImpl(selection, inProgress);
  }

  protected checkResize() {
    const c = this.canvasDataLayer!;
    if (c.width !== c.clientWidth || c.height !== c.clientHeight) {
      this.canvasSelectionLayer!.width = c.width = c.clientWidth;
      this.canvasSelectionLayer!.height = c.height = c.clientHeight;
      this.adaptMaxTranslation();
      return true;
    }
    return false;
  }

  private adaptMaxTranslation() {
    if (!this.zoomBehavior) {
      return;
    }

    const availableWidth = this.canvasDataLayer!.width - this.props.marginLeft - this.props.marginRight;
    const availableHeight = this.canvasDataLayer!.height - this.props.marginTop - this.props.marginBottom;
    this.zoomBehavior
      .extent([[0, 0], [availableWidth, availableHeight]])
      .translateExtent([[0, 0], [availableWidth, availableHeight]]);
  }

  protected rescale(axis: EScaleAxes, scale: IScale) {
    const c = this.currentTransform;
    const p = this.props.scale;
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
    return [pos[0] - this.props.marginLeft, pos[1] - this.props.marginTop];
  }

  /**
   * sets the current visible window
   * @param window
   */
  set window(window: IWindow) {
    if (!this.zoomBehavior) {
      return;
    }
    const {k, tx, ty} = this.window2transform(window);
    const $zoom = select(this.parent);
    this.zoomBehavior.transform($zoom, zoomIdentity.scale(k).translate(tx, ty));
    this.node.classList.toggle(`${EScaleAxes[this.props.scale]}-zoomed`, this.isZoomed());
    this.render();
  }

  private window2transform(window: IWindow) {
    const range2transform = (minMax: IMinMax, scale: IScale) => {
      const pmin = scale(minMax[0])!;
      const pmax = scale(minMax[1])!;
      const k = (scale.range()[1] - scale.range()[0]) / (pmax - pmin);
      return {k, t: (scale.range()[0] - pmin)};
    };
    const s = this.props.scale;
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
    const {x: xscale, y: yscale} = this.transformedScales();
    return {
      xMinMax: <IMinMax>(xscale.range().map(xscale.invert.bind(xscale))),
      yMinMax: <IMinMax>(yscale.range().map(yscale.invert.bind(yscale)))
    };
  }

  private onZoomStart() {
    this.zoomStartTransform = this.currentTransform;
  }

  private isZoomed() {
    return this.currentTransform.k !== 1;
  }


  private shiftTransform(t: ZoomTransform) {
    // zoom transform is over the whole canvas an not just the center part in which the scales are defined
    return t;
  }

  private onZoom() {
    const evt = <D3ZoomEvent<any, any>>d3event;
    const newValue: ZoomTransform = this.shiftTransform(evt.transform);
    const oldValue = this.currentTransform;
    this.currentTransform = newValue;
    const scale = this.props.scale;
    const tchanged = ((scale !== EScaleAxes.y && oldValue.x !== newValue.x) || (scale !== EScaleAxes.x && oldValue.y !== newValue.y));
    const schanged = (oldValue.k !== newValue.k);
    const delta = {
      x: (scale === EScaleAxes.x || scale === EScaleAxes.xy) ? newValue.x - oldValue.x : 0,
      y: (scale === EScaleAxes.y || scale === EScaleAxes.xy) ? newValue.y - oldValue.y : 0,
      kx: (scale === EScaleAxes.x || scale === EScaleAxes.xy) ? newValue.k / oldValue.k : 1,
      ky: (scale === EScaleAxes.y || scale === EScaleAxes.xy) ? newValue.k / oldValue.k : 1
    };
    if (tchanged && schanged) {
      this.emit(AScatterplot.EVENT_WINDOW_CHANGED, this.window, this.transformedScales());
      this.render(ERenderReason.PERFORM_SCALE_AND_TRANSLATE, delta);
    } else if (schanged) {
      this.emit(AScatterplot.EVENT_WINDOW_CHANGED, this.window, this.transformedScales());
      this.render(ERenderReason.PERFORM_SCALE, delta);
    } else if (tchanged) {
      this.emit(AScatterplot.EVENT_WINDOW_CHANGED, this.window, this.transformedScales());
      this.render(ERenderReason.PERFORM_TRANSLATE, delta);
    }
    //nothing if no changed
  }

  private onZoomEnd() {
    const start = this.zoomStartTransform;
    const end = this.currentTransform;
    const tchanged = (start.x !== end.x || start.y !== end.y);
    const schanged = (start.k !== end.k);
    this.node.classList.toggle(`${EScaleAxes[this.props.scale]}-zoomed`, this.isZoomed());
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
    if (!this.clearSelectionImpl(true)) {
      this.render(ERenderReason.SELECTION_CHANGED);
    }
  }

  private onDrag() {
    if (this.dragHandle < 0) {
      this.dragHandle = setInterval(this.updateDrag.bind(this), this.props.lasso.interval);
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
    this.emit(AScatterplot.EVENT_SELECTION_CHANGED, this);
  }

  private retestLasso() {
    const {n2pX, n2pY} = this.transformedNormalized2PixelScales();
    // shift by the margin since the scales doesn't include them for better scaling experience
    const tester = this.lasso.tester(n2pX.invert.bind(n2pX), n2pY.invert.bind(n2pY), -this.props.marginLeft, -this.props.marginTop);
    return tester && this.selectWithTester(tester, true);
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

  private showTooltip(canvasPos: [number, number], event: MouseEvent) {
    //highlight selected item
    const {x, y, clickRadiusX, clickRadiusY} = this.getMouseNormalizedPos(canvasPos);
    const tester = ellipseTester(x, y, clickRadiusX, clickRadiusY);
    const items = findByTester(this.tree!, tester);
    // canvas pos doesn't include the margin
    this.props.showTooltip(this.parent, items, canvasPos[0] + this.props.marginLeft, canvasPos[1] + this.props.marginTop, event);
    this.showTooltipHandle = -1;
  }

  private onMouseMove(event: MouseEvent) {
    if (this.showTooltipHandle >= 0) {
      this.onMouseLeave(event);
    }
    const pos = this.mousePosAtCanvas();
    //TODO find a more efficient way or optimize the timing
    this.showTooltipHandle = setTimeout(this.showTooltip.bind(this, pos, event), this.props.tooltipDelay);
  }

  private onMouseLeave(event: MouseEvent) {
    clearTimeout(this.showTooltipHandle);
    this.showTooltipHandle = -1;
    this.props.showTooltip(this.parent, [], 0, 0, event);
  }

  protected traverseTree<X>(ctx: CanvasRenderingContext2D, tree: Quadtree<X>, renderer: ISymbolRenderer<X>, xscale: IScale, yscale: IScale, isNodeVisible: IBoundsPredicate, debug = false, x: IAccessor<X>, y: IAccessor<X>) {
    //debug stats
    let rendered = 0, aggregated = 0, hidden = 0;

    const {n2pX, n2pY} = this.transformedNormalized2PixelScales();

    const visitTree = (node: QuadtreeInternalNode<X> | QuadtreeLeaf<X>, x0: number, y0: number, x1: number, y1: number) => {
      if (!isNodeVisible(x0, y0, x1, y1)) {
        hidden += debug ? getTreeSize(node) : 0;
        return ABORT_TRAVERSAL;
      }
      if (this.useAggregation(n2pX, n2pY, x0, y0, x1, y1)) {
        const d = getFirstLeaf(node);
        //debuglog('aggregate', getTreeSize(node));
        rendered++;
        aggregated += debug ? (getTreeSize(node) - 1) : 0;
        renderer.render(xscale(x(d))!, yscale(y(d))!, d);
        return ABORT_TRAVERSAL;
      }
      if (isLeafNode(node)) { //is a leaf
        rendered += forEachLeaf(<QuadtreeLeaf<X>>node, (d) => renderer.render(xscale(x(d))!, yscale(y(d))!, d));
      }
      return CONTINUE_TRAVERSAL;
    };

    ctx.save();

    tree.visit(visitTree);
    renderer.done();

    if (debug) {
      debuglog('rendered', rendered, 'aggregated', aggregated, 'hidden', hidden, 'total', this.tree!.size());
    }

    //a dummy path to clear the 'to draw' state
    ctx.beginPath();
    ctx.closePath();

    ctx.restore();
  }

  protected setAxisFormat(axis: Axis<number>, key: keyof IFormatOptions) {
    const f = this.props.format[key];
    if (f != null) {
      axis.tickFormat(typeof f === 'string' ? format(f) : f);
    }
    const t = this.props.ticks[key];
    if (t != null) {
      axis.tickValues(Array.isArray(t) ? t : t(<IScale>axis.scale()));
    }
  }

  protected transformData(c: HTMLCanvasElement, bounds: IBoundsObject, boundsWidth: number, boundsHeight: number, x: number, y: number, kx: number, ky: number) {
    //idea copy the data layer to selection layer in a transformed way and swap
    const ctx = this.canvasSelectionLayer!.getContext('2d')!;
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
    ctx.drawImage(this.canvasDataLayer!, bounds.x0, bounds.y0, boundsWidth, boundsHeight, bounds.x0, bounds.y0, boundsWidth * kx, boundsHeight * ky);
    ctx.restore();

    //swap and update class names
    [this.canvasDataLayer, this.canvasSelectionLayer] = [this.canvasSelectionLayer, this.canvasDataLayer];
    this.canvasDataLayer!.className = `${cssprefix}-data-layer`;
    this.canvasSelectionLayer!.className = `${cssprefix}-selection-layer`;
  }

  private useAggregation(n2pX: (v: number) => number|undefined, n2pY: (v: number) => number|undefined, x0: number, y0: number, x1: number, y1: number) {
    x0 = n2pX(x0)!;
    y0 = n2pY(y0)!;
    x1 = n2pX(x1)!;
    y1 = n2pY(y1)!;
    const minSize = Math.max(Math.abs(x0 - x1), Math.abs(y0 - y1));
    return minSize < 5; //TODO tune depend on visual impact
  }
}

export default AScatterplot;
