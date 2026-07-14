import React from 'react';
import { useSystem } from '@ohif/core';
import { AllInOneMenu } from '@ohif/ui-next';
import { CONSTANTS } from '@cornerstonejs/core';
import { VolumeRenderingPresets } from './VolumeRenderingPresets';
import { VolumeRenderingOptions } from './VolumeRenderingOptions';

const { VIEWPORT_PRESETS } = CONSTANTS;

const VOLUME_RENDERING_QUALITY_RANGE = { min: 1, max: 4, step: 1 };

/**
 * Toolbar button that opens the volume rendering controls menu.
 * Provides preset selection and rendering options (quality, shift, lighting).
 * Uses the ViewportWindowLevel icon (half-black/half-white circle) matching OHIF-v3 style.
 * Menu appears above the button via IconMenu's BottomToTop vertical direction.
 */
export function VolumeRenderingMenuButton({ viewportId: propViewportId }) {
  const { servicesManager } = useSystem();

  const viewportId = propViewportId ||
    servicesManager.services.viewportGridService?.getActiveViewportId?.() ||
    null;

  return (
    <AllInOneMenu.IconMenu
      icon="viewport-window-level"
      iconClassName="hover:bg-accent text-primary flex h-8 w-8 cursor-pointer items-center justify-center rounded"
      verticalDirection={AllInOneMenu.VerticalDirection.BottomToTop}
      horizontalDirection={AllInOneMenu.HorizontalDirection.LeftToRight}
      menuClassName="z-50 min-w-[200px]"
    >
      <VolumeRenderingPresets
        viewportId={viewportId}
        volumeRenderingPresets={VIEWPORT_PRESETS}
      />
      <AllInOneMenu.DividerItem />
      <AllInOneMenu.SubMenu
        itemLabel="Rendering Options"
        backLabel="Volume Rendering"
      >
        <VolumeRenderingOptions
          viewportId={viewportId}
          volumeRenderingQualityRange={VOLUME_RENDERING_QUALITY_RANGE}
        />
      </AllInOneMenu.SubMenu>
    </AllInOneMenu.IconMenu>
  );
}

export default VolumeRenderingMenuButton;
