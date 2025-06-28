import cornerstone from 'cornerstone-core';


export default function refreshCornerstoneViewports() {
  // Refresh all Cornerstone viewports

  cornerstone.getEnabledElements().forEach((enabledElement) => {
    if (enabledElement.image) {
      cornerstone.updateImage(enabledElement.element);
    }
  });
}
