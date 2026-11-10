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

  // The icon goes in the label rather than the item's 28px icon slot, which centres the 21px image
  // with almost no space before the text. The dialog icon gets 4px more than the item's ml-2 gap
  return (
    <AllInOneMenu.Item
      label={
        <span className="flex items-center gap-[10px] whitespace-nowrap">
          <Icons.VolumeRendering className="h-[21px] w-[21px] flex-shrink-0" />
          Rendering Presets
        </span>
      }
      rightIcon={<span className="ml-1 flex"><Icons.ByName name="action-new-dialog" /></span>}
      onClick={onClickPresets}
    />
  );
}
