/**
 * author:  Samuel Gratzl
 * email:   samuel_gratzl@gmx.at
 * created: 2016-10-28T11:19:52.797Z
 */
export class ObjectUtils {
    /**
     * merges the second object into the first one
     * @param target
     * @param others
     * @internal
     * @returns {T}
     */
    static merge(target, ...others) {
        others = others.filter((o) => !!o); //is defined
        if (others.length === 0) {
            return target;
        }
        others.forEach((other) => Object.keys(other).forEach((key) => {
            const v = other[key];
            if (Object.prototype.toString.call(v) === '[object Object]') {
                //nested
                target[key] = (target[key] != null) ? ObjectUtils.merge(target[key], v) : v;
            }
            else {
                target[key] = v;
            }
        }));
        return target;
    }
}
//# sourceMappingURL=ObjectUtils.js.map