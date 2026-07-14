import React from 'react';
import { useSystem } from '@ohif/core';
import { AllInOneMenu, Icons } from '@ohif/ui-next';
import { VolumeRenderingPresetsContent } from './VolumeRenderingPresetsContent';

export function VolumeRenderingPresets({ viewportId, volumeRenderingPresets }) {
  const { servicesManager } = useSystem();
  const { UIDialogService } = servicesManager.services;

  const onClickPresets = () => {
    UIDialogService.show({
      id: 'volume-rendering-presets',
      content: VolumeRenderingPresetsContent,
      isDraggable: false,
      shouldCloseOnEsc: true,
      centralize: true,
      showOverlay: true,
      contentProps: {
        presets: volumeRenderingPresets,
        viewportId,
        hide: () => UIDialogService.dismiss({ id: 'volume-rendering-presets' }),
      },
    });
  };

  return (
    <AllInOneMenu.Item
      label="Rendering Presets"
      icon={<Icons.VolumeRendering />}
      rightIcon={<Icons.ByName name="action-new-dialog" />}
      onClick={onClickPresets}
    />
  );
}
