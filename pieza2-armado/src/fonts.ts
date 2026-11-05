import {loadFont as loadMontserrat} from '@remotion/google-fonts/Montserrat';
import {loadFont as loadCaveat} from '@remotion/google-fonts/Caveat';

export const montserrat = loadMontserrat('normal', {
  weights: ['400', '600', '800'],
  subsets: ['latin'],
});
export const caveat = loadCaveat('normal', {
  weights: ['500'],
  subsets: ['latin'],
});

export const FONT = montserrat.fontFamily;
export const HAND = caveat.fontFamily;
