/**
 * @jest-environment ./src/__tests__/jsdomEnvironment.js
 */
// The Measurements panel hears whether its side panel is open: the side panel keeps the panel
// mounted while closed, so the table is told through its isOpen property.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const mockTable = jest.fn(() => null);
jest.mock('./SonadorMeasurementsTable.js', () => ({ __esModule: true, default: props => mockTable(props) }));
jest.mock('./init.js', () => ({ __esModule: true, default: () => {} }));
jest.mock('@ohif/ui', () => ({ workflow: {} }), { virtual: true });
jest.mock('@ohif/core', () => ({ __esModule: true, default: {}, measurements: {} }), { virtual: true });

import panelExtension from './index';

global.IS_REACT_ACT_ENVIRONMENT = true;

it('passes the side panel open state to the table', () => {
  const { components: [{ component: Panel }] } = panelExtension.getPanelModule({ servicesManager: { services: {} }, commandsManager: {} });
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => root.render(<Panel isOpen={false} />));
  expect(mockTable).toHaveBeenLastCalledWith(expect.objectContaining({ isOpen: false }));
  act(() => root.render(<Panel isOpen />));
  expect(mockTable).toHaveBeenLastCalledWith(expect.objectContaining({ isOpen: true }));
  act(() => root.unmount());
});
