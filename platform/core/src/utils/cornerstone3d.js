import { init as c3dCoreInit } from '@cornerstonejs/core';
import { init as c3dToolsInit } from '@cornerstonejs/tools';
import { init as c3dDcmImageLoaderInit } from '@cornerstonejs/dicom-image-loader';
import * as polySeg from '@cornerstonejs/polymorphic-segmentation';

import { init as c3dPolySegInit } from '@cornerstonejs/polymorphic-segmentation';


// Track init state of Cornerstone3D
let C3D_INIT = false;


export async function initCornerstone3d() {
	// Initialize Cornerstone3D tools

	if (!C3D_INIT) {
		await c3dCoreInit();
		await c3dDcmImageLoaderInit();
		await c3dPolySegInit();
		await c3dToolsInit({ addons: { polySeg }});

		C3D_INIT = true;
	}

	return C3D_INIT;
}