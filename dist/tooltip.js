/**
 * Created by sam on 28.10.2016.
 */
import './scss/main.scss';
import { cssprefix } from './constants';
export class TooltipUtils {
    static findTooltip(parent, ensureExists = true) {
        let tooltip = parent.querySelector(`div.${cssprefix}-tooltip`);
        if (!tooltip && ensureExists) {
            tooltip = document.createElement('div'); //helper
            tooltip.innerHTML = TooltipUtils.template;
            tooltip = tooltip.childNodes[0];
            parent.appendChild(tooltip);
        }
        return tooltip;
    }
    static showTooltipAt(tooltip, x, y) {
        tooltip.style.display = 'block';
        tooltip.style.left = `${(x - tooltip.clientWidth / 2)}px`;
        tooltip.style.top = `${(y - tooltip.clientHeight)}px`;
    }
    static toString(d) {
        if (typeof d.toString === 'function') {
            const s = d.toString();
            if (s !== '[object Object]') {
                return s;
            }
        }
        return JSON.stringify(d);
    }
    /**
     * @internal
     */
    static showTooltip(parent, items, x, y) {
        const tooltip = TooltipUtils.findTooltip(parent, items.length > 0);
        if (items.length === 0) {
            if (tooltip) {
                //hide tooltip
                tooltip.style.display = '';
            }
            return;
        }
        const content = tooltip.querySelector('div');
        content.innerHTML = `<pre>${items.map(toString).join('\n')}</pre>`;
        TooltipUtils.showTooltipAt(tooltip, x, y);
    }
}
//based on bootstrap tooltips
TooltipUtils.template = `<div class="${cssprefix}-tooltip" role="tooltip">
    <div></div>
    <div></div>
  </div>`;
//# sourceMappingURL=tooltip.js.map