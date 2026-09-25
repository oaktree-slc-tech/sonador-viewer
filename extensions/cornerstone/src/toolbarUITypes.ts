import { ToolBoxButtonGroupWrapper, ToolBoxButtonWrapper, ToolButtonWrapper, Toolbar } from './Toolbar';

/**
 * OHIF v3 button UI types resolved by the ToolbarService (the v3 extensions/default toolbar
 * module entries that the Seg-Editor tool palettes use). Registered through the `uiTypes`
 * key of this extension's toolbar module.
 */
const toolbarUITypes = [
  {
    name: 'ohif.toolButton',
    defaultComponent: ToolButtonWrapper,
  },
  {
    name: 'ohif.toolBoxButtonGroup',
    defaultComponent: ToolBoxButtonGroupWrapper,
  },
  {
    name: 'ohif.toolBoxButton',
    defaultComponent: ToolBoxButtonWrapper,
  },
  {
    name: 'ohif.Toolbar',
    defaultComponent: Toolbar,
  },
];

export default toolbarUITypes;
