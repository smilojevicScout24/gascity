// City is a core view: an animated town map of the live city (mayor, rigs,
// polecats, witness, refinery, deacon, dogs). Lazy so its sprites and SVG
// layer stay out of the first-paint bundle.

import { lazy } from 'react';
import type { FrontendViewDescriptor } from '../types';

export const cityView: FrontendViewDescriptor = {
  id: 'city',
  kind: 'core',
  path: '/map',
  nav: { label: 'City', order: 15 },
  element: lazy(() => import('../../routes/City').then((m) => ({ default: m.CityPage }))),
};
