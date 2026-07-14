import React, { useState } from 'react';
import { AllInOneMenu } from '@ohif/ui-next';
import { VolumeRenderingQuality } from './VolumeRenderingQuality';
import { VolumeShift } from './VolumeShift';
import { VolumeLighting } from './VolumeLighting';
import { VolumeShade } from './VolumeShade';

const DEFAULT_QUALITY_RANGE = { min: 1, max: 4, step: 1 };

export function VolumeRenderingOptions({ viewportId, volumeRenderingQualityRange }) {
  const qualityRange = volumeRenderingQualityRange || DEFAULT_QUALITY_RANGE;
  const [hasShade, setShade] = useState(false);

  return (
    <AllInOneMenu.ItemPanel>
      <VolumeRenderingQuality
        viewportId={viewportId}
        volumeRenderingQualityRange={qualityRange}
      />
      <VolumeShift viewportId={viewportId} />
      <div className="mt-2 flex h-[20px] w-full flex-shrink-0 items-center justify-start px-2">
        <div className="text-muted-foreground text-sm">Lighting</div>
      </div>
      <div className="bg-background mt-1 mb-1 h-px w-full" />
      <div className="hover:bg-accent flex h-8 w-full flex-shrink-0 items-center px-2 text-base hover:rounded">
        <VolumeShade
          viewportId={viewportId}
          onClickShade={setShade}
        />
      </div>
      <VolumeLighting
        viewportId={viewportId}
        hasShade={hasShade}
      />
    </AllInOneMenu.ItemPanel>
  );
}
