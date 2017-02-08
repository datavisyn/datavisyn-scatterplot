/**
 * Created by sam on 19.12.2016.
 */

import Scatterplot from './Scatterplot';
import {select, event as d3event} from 'd3-selection';
import {scaleLinear} from 'd3-scale';
import {brushX, brushY, brush, D3BrushEvent, BrushBehavior} from 'd3-brush';
import merge from './merge';
import {cssprefix} from './constants';
import {EScaleAxes, IMinMax, IWindow} from './AScatterplot';

export interface IMiniMapOptions {
  scale?: EScaleAxes;
}

export default class MiniMap {
  private readonly brush: BrushBehavior<any>;
  private readonly props: IMiniMapOptions = {
    scale: EScaleAxes.xy
  };

  private readonly xscale = scaleLinear();
  private readonly yscale = scaleLinear();
  private readonly node: SVGGElement;

  constructor(private plot: Scatterplot<any>, private parent: HTMLElement, props: IMiniMapOptions = {}) {
    this.props = merge(this.props, props);
    parent.innerHTML = `<svg class="${cssprefix}-minimap"><g></g></svg>`;
    parent.classList.add(cssprefix);

    switch (this.props.scale) {
      case EScaleAxes.x:
        this.brush = brushX();
        break;
      case EScaleAxes.y:
        this.brush = brushY();
        break;
      default:
        this.brush = brush();
        break;
    }
    const d = plot.domain;
    this.xscale.domain(d.xMinMax);
    this.yscale.domain(d.yMinMax);
    const $node = select(parent).select('svg > g').call(this.brush);
    this.node = <SVGGElement>$node.node();

    this.update(plot.window);
    $node.call(this.brush.on('brush', this.brushed.bind(this)));
    plot.on(Scatterplot.EVENT_WINDOW_CHANGED, this.update.bind(this));
  }

  private brushed() {
    const s = (<D3BrushEvent<any>>d3event).selection;
    let xMinMax = <IMinMax>this.xscale.domain();
    let yMinMax = <IMinMax>this.yscale.domain();

    let sx: IMinMax;
    let sy: IMinMax;
    switch (this.props.scale) {
      case EScaleAxes.x:
        sx = <IMinMax>s;
        xMinMax = <IMinMax>sx.map(this.xscale.invert.bind(this.xscale));
        break;
      case EScaleAxes.y:
        sy = <IMinMax>s;
        yMinMax = <IMinMax>sy.map(this.yscale.invert.bind(this.yscale));
        break;
      default:
        [sx, sy] = <[IMinMax, IMinMax]>s;
        xMinMax = <IMinMax>sx.map(this.xscale.invert.bind(this.xscale));
        yMinMax = <IMinMax>sy.map(this.yscale.invert.bind(this.yscale));
        break;
    }
    return {xMinMax, yMinMax};
  }

  private update(window: IWindow) {
    this.xscale.range([0, this.parent.clientWidth]);
    this.yscale.range([0, this.parent.clientHeight]);
    this.node.parentElement.setAttribute('width', this.parent.clientWidth.toString());
    this.node.parentElement.setAttribute('height', this.parent.clientHeight.toString());
    this.brush.extent([<IMinMax>this.xscale.range(), <IMinMax>this.yscale.range()]);

    const $node = select<SVGGElement,any>(this.node);
    switch (this.props.scale) {
      case EScaleAxes.x:
        this.brush.move($node, window.xMinMax.map(this.xscale));
        break;
      case EScaleAxes.y:
        this.brush.move($node, window.yMinMax.map(this.yscale));
        break;
      default:
        const s: [IMinMax, IMinMax] = [<IMinMax>window.xMinMax.map(this.xscale), <IMinMax>window.yMinMax.map(this.yscale)];
        this.brush.move($node, s);
        break;
    }
  }
}
