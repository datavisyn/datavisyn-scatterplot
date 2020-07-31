/**
 * author:  Samuel Gratzl
 * email:   samuel_gratzl@gmx.at
 * created: 2016-10-28T11:19:52.797Z
 */
export declare class ObjectUtils {
    /**
     * merges the second object into the first one
     * @param target
     * @param others
     * @internal
     * @returns {T}
     */
    static merge<T extends any>(target: T, ...others: any[]): T;
}
