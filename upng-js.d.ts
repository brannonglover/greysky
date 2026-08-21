declare module 'upng-js' {
  export function decode(buffer: ArrayBuffer): { width: number; height: number };
  export function toRGBA8(img: { width: number; height: number }): ArrayBuffer[];
}
