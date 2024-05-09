import { create } from 'zustand';

export const useViewerSidePanels = create((set) => ({
  isIssuesContentRightSidePanel: false,
  isLeftSidePanelOpen: true,
  isRightSidePanelOpen: false,
  selectedRightSidePanel: '',
  selectedLeftSidePanel: 'studies',
  setIsIssuesContentRightSidePanel: (value) => set(() => ({ isIssuesContentRightSidePanel: value })),
  onChangeSidePanel: (side, selectedPanel) =>
    set((prevState) => {
      const newState = {};

      const isOpen = side === 'left' ? prevState.isLeftSidePanelOpen : prevState.isRightSidePanelOpen;
      const prevSelectedPanel = side === 'left' ? prevState.selectedLeftSidePanel : prevState.selectedRightSidePanel;

      const isSameSelectedPanel = prevSelectedPanel === selectedPanel || selectedPanel === null;

      if (side === 'left') {
        newState.selectedLeftSidePanel = selectedPanel || prevSelectedPanel;
      } else {
        newState.selectedRightSidePanel = selectedPanel || prevSelectedPanel;
      }

      const isClosedOrShouldClose = !isOpen || isSameSelectedPanel;

      if (isClosedOrShouldClose) {
        if (side === 'left') {
          newState.isLeftSidePanelOpen = !prevState.isLeftSidePanelOpen;
        } else {
          newState.isRightSidePanelOpen = !prevState.isRightSidePanelOpen;
        }
      }

      return newState;
    }),
}));
