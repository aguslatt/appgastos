import {Easing, interpolate} from 'remotion';

export const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

export const ease = Easing.bezier(0.33, 1, 0.68, 1); // out suave
export const easeIO = Easing.bezier(0.65, 0, 0.35, 1); // in-out suave

export const prog = (f: number, a: number, b: number, e = ease) =>
  interpolate(f, [a, b], [0, 1], {...clamp, easing: e});

export const typed = (text: string, f: number, start: number, framesPerChar: number) =>
  text.slice(0, Math.max(0, Math.floor((f - start) / framesPerChar) + 1));
