import { TOOLBAR_BUTTON_TYPES, TOOLBAR_BUTTON_BEHAVIORS } from '@ohif/ui';

import {
  M3DToolbarButton,
  M3DAnimationControlToolbarButton,
} from './toolbarComponents/M3DToolbarButton.js';

const definitions = [
  {
    id: 'M3DAnimationControl',
    label: 'CINE',
    icon: 'youtube',
    CustomComponent: M3DAnimationControlToolbarButton,
    type: TOOLBAR_BUTTON_TYPES.BUILT_IN,
    options: {
      behavior: TOOLBAR_BUTTON_BEHAVIORS.CINE,
    },
    context: 'VIEWER',
  },
];

export default {
  definitions,
};
