import React, { useCallback, useEffect, useState } from 'react';
import { useSystem } from '@ohif/core';
import { Numeric } from '@ohif/ui-next';
import { getCornerstone3dViewport } from '../../utils/cornerstone3d.js';
import Enums from '../../enums';

const LIGHTING_PROPERTIES = [
  { key: 'ambient', label: 'Ambient' },
  { key: 'diffuse', label: 'Diffuse' },
  { key: 'specular', label: 'Specular' },
];

export function VolumeLighting({ viewportId, hasShade }) {
  const { commandsManager } = useSystem();
  const [lightingValues, setLightingValues] = useState({
    ambient: null,
    diffuse: null,
    specular: null,
  });

  const onLightingChange = useCallback(
    (property, value) => {
      commandsManager.runCommand('setVolumeLighting', {
        viewportId,
        options: { [property]: value },
      }, Enums.VIEWPORT);
      setLightingValues(prev => ({ ...prev, [property]: value }));
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
    const property = actor.getProperty();
    setLightingValues({
      ambient: property.getAmbient(),
      diffuse: property.getDiffuse(),
      specular: property.getSpecular(),
    });
  }, [viewportId]);

  const disableOption = hasShade ? '' : 'pointer-events-none opacity-40';

  return (
    <div className="my-1 mt-2 flex flex-col space-y-2">
      {LIGHTING_PROPERTIES.map(
        ({ key, label }) =>
          lightingValues[key] !== null && (
            <div
              key={key}
              className={`w-full pl-2 pr-1 ${disableOption}`}
            >
              <Numeric.Container
                mode="singleRange"
                min={0}
                max={1}
                step={0.1}
                value={lightingValues[key]}
                onChange={value => onLightingChange(key, value)}
              >
                <div className="flex flex-row items-center">
                  <Numeric.Label className="w-16">{label}</Numeric.Label>
                  <Numeric.SingleRange sliderClassName="mx-2 flex-grow" />
                </div>
              </Numeric.Container>
            </div>
          )
      )}
    </div>
  );
}
