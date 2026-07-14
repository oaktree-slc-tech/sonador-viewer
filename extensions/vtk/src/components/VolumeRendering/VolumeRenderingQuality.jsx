import React, { useCallback, useEffect, useState } from 'react';
import { useSystem } from '@ohif/core';
import { Numeric } from '@ohif/ui-next';
import { getCornerstone3dViewport } from '../../utils/cornerstone3d.js';
import Enums from '../../enums';

export function VolumeRenderingQuality({ viewportId, volumeRenderingQualityRange }) {
  const { commandsManager } = useSystem();
  const { min, max, step } = volumeRenderingQualityRange;
  const [quality, setQuality] = useState(null);

  const onChange = useCallback(
    value => {
      commandsManager.runCommand('setVolumeRenderingQuality', {
        viewportId,
        volumeQuality: value,
      }, Enums.VIEWPORT);
      setQuality(value);
    },
    [commandsManager, viewportId]
  );

  useEffect(() => {
    const viewport = getCornerstone3dViewport(viewportId);
    if (!viewport) {
      return;
    }
    const actors = viewport.getActors();
    if (!actors?.length) {
      return;
    }
    const { actor } = actors[0];
    const mapper = actor.getMapper();
    const image = mapper.getInputData();
    const spacing = image.getSpacing();
    const sampleDistance = mapper.getSampleDistance();
    const averageSpacing = spacing.reduce((a, b) => a + b) / 3.0;
    if (sampleDistance === averageSpacing) {
      setQuality(1);
    } else {
      setQuality(Math.sqrt(averageSpacing / (sampleDistance * 0.5)));
    }
  }, [viewportId]);

  return (
    <div className="my-1 mt-2 flex flex-col space-y-2">
      {quality !== null && (
        <div className="w-full pl-2 pr-1">
          <Numeric.Container
            mode="singleRange"
            min={min}
            max={max}
            step={step}
            value={quality}
            onChange={onChange}
          >
            <div className="flex flex-row items-center">
              <Numeric.Label className="w-16">Quality</Numeric.Label>
              <Numeric.SingleRange sliderClassName="mx-2 flex-grow" />
            </div>
          </Numeric.Container>
        </div>
      )}
    </div>
  );
}
