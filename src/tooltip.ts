/**
 * Created by sam on 28.10.2016.
 */

import './style.scss';
import {cssprefix} from './constants';

//based on bootstrap tooltips
const template = `<div class="${cssprefix}-tooltip" role="tooltip">
  <div></div>
  <div></div>
</div>`;

function findTooltip(parent: HTMLElement, ensureExists = true) {
  let tooltip = <HTMLElement>parent.querySelector(`div.${cssprefix}-tooltip`);
  if (!tooltip && ensureExists) {
    tooltip = document.createElement('div'); //helper
    tooltip.innerHTML = template;
    tooltip = <HTMLDivElement>tooltip.childNodes[0];
    parent.appendChild(tooltip);
  }
  return tooltip;
}

function showTooltipAt(tooltip: HTMLElement, x: number, y: number) {
  tooltip.style.display = 'block';
  tooltip.style.left = (x-tooltip.clientWidth/2)+'px';
  tooltip.style.top = (y-tooltip.clientHeight)+'px';
}

function toString(d: any) {
  if (typeof d.toString === 'function') {
    let s = d.toString();
    if (s !== '[object Object]') {
      return s;
    }
  }
  return JSON.stringify(d);
}

export default function showTooltip(parent: HTMLElement, items:any[], x:number, y:number) {
  const tooltip: HTMLElement = findTooltip(parent, items.length > 0);
  if (items.length === 0) {
    if (tooltip) {
      //hide tooltip
      tooltip.style.display = null;
    }
    return;
  }
  const content = <HTMLElement>tooltip.querySelector('div');
  content.innerHTML = `<pre>${items.map(toString).join('\n')}</pre>`;

  showTooltipAt(tooltip, x, y);
}
