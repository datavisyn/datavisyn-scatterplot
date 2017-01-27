/**
 * author:  Samuel Gratzl
 * email:   samuel_gratzl@gmx.at
 * created: 2016-10-28T11:19:52.797Z
 */

import {line as d3line, curveLinearClosed} from 'd3-shape';
import {polygonHull, polygonContains} from 'd3-polygon';
import {extent} from 'd3-array';
import {hasOverlap, ITester} from './quadtree';
import merge from './merge';

declare type IPoint = [number, number];

const MIN_POINT_DISTANCE2 = 10 * 10;

function distance2(a: IPoint, b: IPoint) {
  const x = a[0] - b[0];
  const y = a[1] - b[1];
  return x * x + y * y;
}

export interface ILassoOptions {
  lineWidth?: number;
  strokeStyle?: string;
  fillStyle?: string;
  pointRadius?: number;
  dashedLine?: {dashLength: number, gapLength: number};
}

export default class Lasso {
  private props: ILassoOptions = {
    lineWidth: 2,
    strokeStyle: 'rgba(0,0,0,1)',
    fillStyle: 'rgba(0,0,0,0.2)',
    pointRadius: 3,
    dashedLine: {
      dashLength: 5,
      gapLength: 3
    }
  };
  private line = d3line().curve(curveLinearClosed);
  private points: IPoint[] = [];
  private current: IPoint = null;

  constructor(options?: ILassoOptions) {
    merge(this.props, options);
  }

  start(x: number, y: number) {
    this.clear();
    this.current = [x, y];
    this.points.push(this.current);
  }

  setCurrent(x: number, y: number) {
    this.current = [x, y];
  }

  pushCurrent() {
    const p = this.points,
      pl = p.length,
      c = this.current;
    if (!c || (pl > 0 && distance2(p[pl - 1], c) < MIN_POINT_DISTANCE2)) {
      return false;
    }
    p.push(this.current);
    return true;
  }

  end(x: number, y: number) {
    this.setCurrent(x, y);
    this.pushCurrent();
    this.current = null;
  }

  clear() {
    this.points = [];
    this.current = null;
  }

  tester(p2nX: (p: number)=>number, p2nY: (p: number)=>number, shiftX: number = 0, shiftY: number = 0): ITester {
    if (this.points.length < 3) {
      return null;
    }
    const polygon = polygonHull(this.points.map(([x,y]) => <[number, number]>[p2nX(x + shiftX), p2nY(y + shiftY)]));
    const [x0, x1] = extent(polygon, (d) => d[0]);
    const [y0, y1] = extent(polygon, (d) => d[1]);
    return {
      test: (x: number, y: number) => polygonContains(polygon, [x, y]),
      testArea: hasOverlap(x0, y0, x1, y1)
    };
  }

  render(ctx: CanvasRenderingContext2D) {
    const p = this.points;
    ctx.save();
    ctx.beginPath();

    ctx.lineWidth = this.props.lineWidth;
    ctx.strokeStyle = this.props.strokeStyle;

    if(this.props.dashedLine) {
      ctx.setLineDash([this.props.dashedLine.dashLength, this.props.dashedLine.gapLength]);
    }

    if (p.length > 0) {
      this.line.context(ctx)(p);
      ctx.fillStyle = this.props.fillStyle;
      ctx.fill();
      ctx.stroke();
    }
    ctx.closePath();
    ctx.restore();
    ctx.beginPath();


    const renderPoint = (p: IPoint) => {
      if (!p) {
        return;
      }
      ctx.moveTo(p[0], p[1]);
      ctx.arc(p[0], p[1], this.props.pointRadius, 0, Math.PI * 2);
    };

    renderPoint(p[0]);
    renderPoint(this.current);
    ctx.closePath();
    ctx.stroke();

    ctx.restore();
  }
}
