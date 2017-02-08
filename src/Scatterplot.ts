/**
 * author:  Samuel Gratzl
 * email:   samuel_gratzl@gmx.at
 * created: 2016-10-28T11:19:52.797Z
 */

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
import {line} from 'd3-shape';
import AScatterplot, {
  fixScale,
  IScale,
  IScatterplotOptions,
  IScalesObject,
  IAccessor,
  EScaleAxes,
  IZoomOptions,
  IFormatOptions,
  ERenderReason,
  IMinMax,
  IWindow
} from './AScatterplot';

//normalized range the quadtree is defined
const DEFAULT_NORMALIZED_RANGE = [0, 100];

/**
 * a class for rendering a scatterplot in a canvas
 */
export default class Scatterplot<T> extends AScatterplot<T> {
  protected props: IScatterplotOptions<T> = {
    x: (d) => (<any>d).x,
    y: (d) => (<any>d).y,

    xlabel: 'x',
    ylabel: 'y',

    xscale: <IScale>scaleLinear().domain([0, 100]),
    yscale: <IScale>scaleLinear().domain([0, 100]),

    symbol: 'o',
  };


  protected readonly normalized2pixel = {
    x: scaleLinear(),
    y: scaleLinear()
  };

  private readonly renderer: ISymbol<T>;

  constructor(data: T[], root: HTMLElement, props?: IScatterplotOptions<T>) {
    super(data, root);
    this.props = merge(this.props, props);
    this.props.xscale = fixScale(this.props.xscale, this.props.x, data, props ? props.xscale : null, props ? props.xlim : null);
    this.props.yscale = fixScale(this.props.yscale, this.props.y, data, props ? props.yscale : null, props ? props.ylim : null);

    this.renderer = createRenderer(this.props.symbol);

    // generate aspect ratio right normalized domain
    this.normalized2pixel.x.domain(DEFAULT_NORMALIZED_RANGE.map((d) => d*this.baseProps.aspectRatio));
    this.normalized2pixel.y.domain(DEFAULT_NORMALIZED_RANGE);

    this.setDataImpl(data);
    this.selectionTree = quadtree([], this.tree.x(), this.tree.y());

    this.initDOM();

    this.canvasDataLayer = <HTMLCanvasElement>this.parent.children[0];
    this.canvasSelectionLayer = <HTMLCanvasElement>this.parent.children[1];
  }

  protected transformedScales(): IScalesObject {
    const xscale = this.rescale(EScaleAxes.x, this.props.xscale);
    const yscale = this.rescale(EScaleAxes.y, this.props.yscale);
    return {xscale, yscale};
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

  protected render(reason = ERenderReason.DIRTY, transformDelta = {x: 0, y: 0, kx: 1, ky: 1}) {
    if (this.checkResize()) {
      //check resize
      return this.resized();
    }

    const c = this.canvasDataLayer,
      margin = this.baseProps.margin,
      bounds = {x0: margin.left, y0: margin.top, x1: c.clientWidth - margin.right, y1: c.clientHeight - margin.bottom},
      boundsWidth = bounds.x1 - bounds.x0,
      boundsHeight = bounds.y1 - bounds.y0;

    // emit render reason as string
    this.emit(Scatterplot.EVENT_RENDER, ERenderReason[reason], transformDelta);

    if (reason === ERenderReason.DIRTY) {
      this.props.xscale.range([0, boundsWidth]);
      this.props.yscale.range([boundsHeight, 0]);
      this.normalized2pixel.x.range(this.props.xscale.range());
      this.normalized2pixel.y.range(this.props.yscale.range());
    }

    //transform scale
    const {xscale, yscale} = this.transformedScales();

    const {n2pX, n2pY} = this.transformedNormalized2PixelScales();
    const nx = (v) => n2pX.invert(v),
      ny = (v) => n2pY.invert(v);
    //inverted y scale
    const isNodeVisible = hasOverlap(nx(0), ny(boundsHeight), nx(boundsWidth), ny(0));

    const renderInfo = {
      zoomLevel: this.currentTransform.k
    };

    const renderCtx = (isSelection = false) => {
      const ctx = (isSelection ? this.canvasSelectionLayer : this.canvasDataLayer).getContext('2d');
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.save();
      ctx.rect(bounds.x0, bounds.y0, boundsWidth, boundsHeight);
      ctx.clip();
      const tree = isSelection ? this.selectionTree : this.tree;
      const renderer = this.renderer(ctx, isSelection ? ERenderMode.SELECTED : ERenderMode.NORMAL, renderInfo);
      const debug = !isSelection && DEBUG;
      ctx.translate(bounds.x0, bounds.y0);
      this.renderTree(ctx, tree, renderer, xscale, yscale, isNodeVisible, debug);

      if (isSelection && this.hasExtras()) {
        ctx.save();
        this.baseProps.extras(ctx, xscale, yscale);
        ctx.restore();
      }

      ctx.restore();
      return ctx;
    };

    const renderSelection = !this.isSelectAble() && !this.hasExtras() ? () => undefined : () => {
        const ctx = renderCtx(true);
        this.lasso.render(ctx);
      };

    const renderAxes = this.renderAxes.bind(this, xscale, yscale);
    const renderData = renderCtx.bind(this, false);

    const clearAutoZoomRedraw = () => {
      if (this.zoomHandle >= 0) {
        //delete auto redraw timer
        clearTimeout(this.zoomHandle);
        this.zoomHandle = -1;
      }
    };

    debuglog(ERenderReason[reason]);
    //render logic
    switch (reason) {
      case ERenderReason.PERFORM_TRANSLATE:
        clearAutoZoomRedraw();
        this.transformData(c, bounds, boundsWidth, boundsHeight, transformDelta.x, transformDelta.y, transformDelta.kx, transformDelta.ky);
        renderSelection();
        renderAxes();
        //redraw everything after a while, i.e stopped moving
        this.zoomHandle = setTimeout(this.render.bind(this, ERenderReason.AFTER_TRANSLATE), this.baseProps.zoom.delay);
        break;
      case ERenderReason.SELECTION_CHANGED:
        renderSelection();
        break;
      case ERenderReason.AFTER_TRANSLATE:
        //just data needed after translation
        clearAutoZoomRedraw();
        renderData();
        break;
      case ERenderReason.AFTER_SCALE_AND_TRANSLATE:
      case ERenderReason.AFTER_SCALE:
        //nothing current approach is to draw all
        break;
      //case ERenderReason.PERFORM_SCALE:
      //case ERenderReason.PERFORM_SCALE_AND_TRANSLATE:
      default:
        clearAutoZoomRedraw();
        renderData();
        renderAxes();
        renderSelection();
    }
  }

  protected renderAxes(xscale: IScale, yscale: IScale) {
    const left = axisLeft(yscale),
      bottom = axisBottom(xscale),
      $parent = select(this.parent);
    this.setAxisFormat(left, 'y');
    this.setAxisFormat(bottom, 'x');
    $parent.select(`.${cssprefix}-axis-left > g`).call(left);
    $parent.select(`.${cssprefix}-axis-bottom > g`).call(bottom);
  }

  private renderTree(ctx: CanvasRenderingContext2D, tree: Quadtree<T>, renderer: ISymbolRenderer<T>, xscale: IScale, yscale: IScale, isNodeVisible: IBoundsPredicate, debug = false) {
    const {x, y} = this.props;

    //function debugNode(color:string, x0:number, y0:number, x1:number, y1:number) {
    //  ctx.closePath();
    //  ctx.fillStyle = 'steelblue';
    //  ctx.fill();
    //  ctx.fillStyle = color;
    //  x0 = xscale(x0);
    //  y0 = yscale(y0);
    //  x1 = xscale(x1);
    //  y1 = yscale(y1);
    //  ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x0 - x1), Math.abs(y0 - y1));
    //  ctx.beginPath();
    //
    //}

    //debug stats

    super.traverseTree(ctx, tree, renderer, xscale, yscale, isNodeVisible, debug, x, y);
  }
}
