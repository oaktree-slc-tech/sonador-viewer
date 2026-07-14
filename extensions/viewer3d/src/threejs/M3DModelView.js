import _ from 'lodash';

import React, { Component } from 'react';
import PropTypes from 'prop-types';

import OHIF, { utils, redux } from '@ohif/core';

const { TypedArrayProp } = OHIF.classes;

import * as THREE from 'three';
import {
  Clock,
  BoxBufferGeometry,
  AnimationMixer,
  Color,
  Mesh,
  Group,
  MeshBasicMaterial,
  MeshPhongMaterial,
  MeshStandardMaterial,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  WireFrame,
  PerspectiveCamera,
  HemisphereLight,
  DirectionalLight,
  AmbientLight,
  PointLight,
  Scene,
  WebGLRenderer,
  PMREMGenerator,
  Box3,
  Vector3,
  ACESFilmicToneMapping,
  SRGBColorSpace,
  PCFSoftShadowMap,
} from 'three';

import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';


import CameraControls from 'camera-controls';
CameraControls.install({ THREE });

import { MIMETYPE_GLB, MIMETYPE_STL } from '../sopClassHandlers/OHIFDicom3DSopClassHandler.js';

export default class M3DModelView extends Component {
  // OHIF model view class (wraps a Three.js scene). Models are loaded from the modelFileUrl

  constructor(props) {
    super(props);

    this.container = React.createRef();
  }

  static propTypes = {
    modelType: PropTypes.string.isRequired,
    models: PropTypes.array.isRequired,
    onCreated: PropTypes.func,
    onDestroyed: PropTypes.func,
    cameraOptions: PropTypes.object.isRequired,
    dollyToCursor : PropTypes.bool.isRequired,
    cameraStart: PropTypes.array.isRequired,
    renderOptions: PropTypes.object.isRequired,
    defaultGeometryColor: PropTypes.node.isRequired,
    coordinateTransform: PropTypes.object.isRequired,
    interactionControlOptions: PropTypes.object.isRequired,
    lightOptions: PropTypes.object.isRequired,
    env: PropTypes.object.isRequired,
    deviceRenderDefault: PropTypes.number.isRequired,
    getStaticUrl: PropTypes.func.isRequired,
    onInteractionChange: PropTypes.func,
    onInteractionStart: PropTypes.func,
    onInteractionEnd: PropTypes.func,
  };

  state = {
    cinePlaying: false,
    timeScale: 1,
  };

  static defaultProps = {
    cameraOptions: {
      fov: 35,
      near: 0.1,
      far: 100,
      offset: 0,
      farEdgeBuffer: 3,
    },
    dollyToCursor: true,
    cameraStart: [0, 0, 10],
    renderOptions: { antialias: true, alpha: true, },
    defaultGeometryColor: 0x049ef4,
    coordinateTransform: {},
    env: { sigma: 0.0 },
    interactionControlOptions: {
      target: [0, 0.5, 0],
      enablePan: true,
      enableDamping: true,
      dampingFactor: 0.025,
    },
    lightOptions: {
      ambient: { color: 0x000000, intensity: 0.35, },
      hemisphere: { sky: 0xbfc7d1, ground: 0x202020, intensity: 0.35 },
      directional: [
        // Directional ights to be added to the scene. The unitPos vector will
        // be multipled by the spatial dimensions of the model for scaling.
        { color: 0xffffff, intensity: 2.6, unitPos: [1.8, 2.2, 2.2] },
        { color: 0xaabbd6, intensity: 0.7, unitPos: [-2.0, 1.0, 1.0] },
        { color: 0xffffff, intensity: 1.1, unitPos: [-1.2, 2.0, -2.0] },
      ],
      lights: [
        // Point lights to be added to the scene. The unitPos vector will be multipled
        // by the spatial dimensions of the model for scaling.
      ],
    },
    cine: {},
    deviceRenderDefault: 60,
  };

  initRenderer() {
    // Initialize renderer
    // @returns render instance
    const { renderOptions: roptions } = this.props;

    const renderer = new WebGLRenderer(roptions);
    renderer.outputEncoding;
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;

    renderer.physicallyCorrectLights = true;
    renderer.setClearColor(0x000000, 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;

    return renderer;
  }

  initClock(options) {
    // Initialize clock instance. (The clock will be stopped on initialization to allow for
    // synchronization with animation loops, unless specified otherwise in the options.)
    options = options || {};
    _.defaults(options, { running: false });

    // Initialize clock and apply options.
    const clock = new Clock();
    _.extend(clock, options);

    return clock;
  }

  initCamera(model, options) {
    // Initialize camera instance
    // @returns camera instance
    options = options || {};
    const {
      cameraOptions: defaultCameraOptions,
      cameraStart: defaultCameraStart,
    } = this.props;
    _.defaults(options, _.pick(defaultCameraOptions, 'fov', 'near', 'far', 'offset', 'farEdgeBuffer'));

    // Camera aspect ratio
    const aspect = this.container.current.clientWidth / this.container.current.clientHeight;

    // Placeholder variables for calculating the camera settings based on
    const camera = new PerspectiveCamera(options.fov, aspect, options.near, options.far);
    if (!model) {
      camera.position.set(...cameraStart);
      return camera;
    }

    const fit = this.getModelFit(model);
    const { size, center, radius } = fit;

    const fov = camera.fov * (Math.PI / 180);
    const fitHeightDistance = size.y / (2 * Math.tan(fov / 2));
    const fitWidthDistance =
      size.x / (2 * Math.tan(Math.atan(Math.tan(fov / 2) * aspect)));

    let distance = Math.max(fitHeightDistance, fitWidthDistance);
    distance += size.z * 0.75;

    if (_.isNumber(options.offset) && options.offset > 0) {
      distance *= options.offset;
    } else {
      distance *= 1.2;
    }

    camera.position.set(center.x, center.y, center.z + distance);
    camera.near = Math.max(0.01, radius / 100);
    camera.far = Math.max(100, distance + radius * options.farEdgeBuffer * 4);
    camera.updateProjectionMatrix();
    camera.lookAt(center);

    return camera;
  }

  lightScene(model, scene) {
    // Add lignts to the scene
    const { lightOptions } = this.props;

    // Create ambient light to provide some degree of lighting in case of no model.
    if (lightOptions.ambient) {
      const ambientLight = new AmbientLight(
        lightOptions.ambient.color,
        lightOptions.ambient.intensity
      );
      scene.add(ambientLight);
    }

    // Create hemisphere light
    if (lightOptions.hemisphere) {
      const hemisphereLight = new HemisphereLight(
        lightOptions.hemisphere.sky,
        lightOptions.hemisphere.ground,
        lightOptions.hemisphere.intensity
      );
      scene.add(hemisphereLight);
    }

    if (model) {
      // Calculate the size of the model
      const box = new Box3().setFromObject(model);
      const size = box.getSize(new Vector3());

      if (lightOptions.directional && lightOptions.directional.length) {
        
        // Add directional lights to scene
        _.each(lightOptions.directional, function (dl) {
          const dlight = new DirectionalLight(dl.color, dl.intensity);
          dlight.position.set(
            dl.unitPos[0] * size.x,
            dl.unitPos[1] * size.y,
            dl.unitPos[2] * size.z
          );
          scene.add(dlight);
        });
      }

      if (lightOptions.lights && lightOptions.lights.length) {
        
        // Add points lights to the scene
        _.each(lightOptions.lights, function (l) {
          const light = new PointLight(l.color, l.intensity, 0);
          light.position.set(
            l.unitPos[0] * size.x,
            l.unitPos[1] * size.y,
            l.unitPos[2] * size.y
          );
          scene.add(light);
        });
      }
    }
  }

  initGenerator(renderer) {
    // Initialize "Prefiltered, Mipmapped Radiance Environment Map (PMREM)" instance
    const generator = new PMREMGenerator(renderer);
    return generator;
  }

  initScene(renderer, generator) {
    // Initialize scene instance
    const { env } = this.props;

    const scene = new Scene();
    if (generator && this.props.modelType === MIMETYPE_GLB) {
      scene.environment = generator.fromScene(
        new RoomEnvironment(),
        env.sigma || 0
      ).texture;
    }

    // Initialize environment
    return scene;
  }

  getModelFit(model) {
    // Retrieve the mdoel bounding box, size, center, maximum dimensions and 
    // interaction radius.

    if (!model) {
      return null;
    }

    const box = new Box3().setFromObject(model);
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());

    const maxDim = Math.max(size.x, size.y, size.z);
    const radius = size.length() * 0.5;

    return {
      box,
      size,
      center,
      maxDim,
      radius,
    };
  }

  initControls(renderer, camera, model) {
    // Initialize interactive controls for the scene
    const {
      interactionControlOptions: coptions,
      onInteractionChange,
      onInteractionStart,
      onInteractionEnd,
      dollyToCursor,
    } = this.props;

    // Initialize controls
    const controls = new CameraControls(camera, renderer.domElement);
    controls.dollyToCursor = dollyToCursor

    // Set controls orbit preferentially from the model center
    if (model) {
      const fit = this.getModelFit(model);
      controls.fitToBox(fit.box, false);
    } else if (coptions.target) {
      controls.setTarget(...coptions.target);
    }

    // Add interaction event handlers
    if (_.isFunction(onInteractionStart)) {
      controls.addEventListener('start', onInteractionStart);
    }
    if (_.isFunction(onInteractionEnd)) {
      controls.addEventListener('end', onInteractionEnd);
    }
    if (_.isFunction(onInteractionChange)) {
      controls.addEventListener('change', onInteractionChange);
    }

    // Apply options to controls and return
    _.extend(
      controls,
      _.pick(coptions, 'enablePan', 'enableDamping', 'dampingFactor')
    );

    controls.update()
    return controls;
  }

  initMixer(model) {
    // Initialize mixer for animations
    const mixer = new AnimationMixer(model);
    return mixer;
  }

  loadModelData() {
    // Assemble the scene from the per-viewport instances hydrated from the M3D geometry cache.
    // Each model carries an already-hydrated Three.js instance (see hydrateM3DInstance):
    //   GLB -> { scene, animations }   STL -> Mesh (shared cached geometry, per-instance material)
    const { modelType, models, coordinateTransform } = this.props;

    // For GLB scenes, ensure that only a single model is defined.
    if (modelType == MIMETYPE_GLB && models && models.length > 1) {
      throw new Error(
        'Unable to create scene, only a single GLB file is supported per series by the viewer'
      );
    }

    let sceneData;
    _.each(models, function (m) {
      const inst = m.instance;
      if (!inst) {
        return;
      }

      if (inst.scene) {
        // GLB: a hydrated { scene, animations }
        sceneData = inst;
      } else {
        // STL: a hydrated Mesh
        if (!sceneData) {
          sceneData = {};
        }
        if (!sceneData.geometries) {
          sceneData.geometries = [];
        }
        sceneData.geometries.push(inst);
      }
    });

    this.sceneData = sceneData;
    this.model = sceneData ? sceneData.scene : undefined;

    // Add full model (GLB scene) to the scene
    if (this.model) {
      this.scene.add(this.model);
    }

    // Add STL geometries to the scene
    if (this.sceneData && this.sceneData.geometries && this.sceneData.geometries.length) {

      //  Create a group for the geometries and add all meshes to the group
      const mgroup = new Group();
      _.each(this.sceneData.geometries, function (g) { mgroup.add(g); });

      // Apply coordinate transformations
      if (coordinateTransform && coordinateTransform.rotation) {
        mgroup.rotation.setFromVector3(
          new Vector3(...coordinateTransform.rotation)
        );
      }

      // If no scene object under scene data, add the group as the scene.
      if (!this.sceneData.scene) {
        this.sceneData.scene = mgroup;
      }

      // If no model specified as part of an existing scene, make the group the model.
      if (!this.model) {
        this.model = mgroup;
      }

      // Add the group to the scene
      this.scene.add(mgroup);
    }
  }

  getModelInstance(geometryId) {
    // Resolve the per-viewport Three.js instance (STL: Mesh) for an M3D geometry-cache id
    const model = _.find(this.props.models, (m) => m.geometryId == geometryId);
    return model ? model.instance : undefined;
  }

  setModelVisibility(geometryId, visible) {
    // Toggle the display of a single model within the scene
    const instance = this.getModelInstance(geometryId);
    if (instance) {
      instance.visible = !!visible;
    }
  }

  setModelWireframe(geometryId, wireframe) {
    // Toggle wireframe rendering for a single model. STL instances own their material
    // (hydrateM3DInstance), so the mutation stays local to this viewport.
    const instance = this.getModelInstance(geometryId);
    if (instance && instance.material) {
      instance.material.wireframe = !!wireframe;
    }
  }

  setModelColor(geometryId, color) {
    // Set the material colour of a single model (accepts hex strings or numeric colours)
    const instance = this.getModelInstance(geometryId);
    if (instance && instance.material && instance.material.color) {
      instance.material.color.set(color);
    }
  }

  getModelPresentation(geometryId) {
    // Retrieve the current presentation state for a single model
    const instance = this.getModelInstance(geometryId);
    if (!instance) {
      return undefined;
    }
    return {
      visible: instance.visible,
      wireframe: instance.material ? !!instance.material.wireframe : false,
      color: instance.material && instance.material.color
        ? '#' + instance.material.color.getHexString() : undefined,
    };
  }

  resize() {
    // Set the scene aspect, size, and pixel ratios of the camera and renderer
    if (!this.container || !this.camera || !this.renderer) {
      throw new Error(
        'Unable to resize scene, invalid renderer or camera settings'
      );
    }

    // Set camera's apsect ratio and update the viewing frustrum
    this.camera.aspect =
      this.container.current.clientWidth / this.container.current.clientHeight;
    this.camera.updateProjectionMatrix();

    // Set renderer size and ratio
    this.renderer.setSize(
      this.container.current.clientWidth,
      this.container.current.clientHeight
    );
    this.renderer.setPixelRatio(window.devicePixelRatio);
  }

  renderScene() {
    // Render scene contents
    if (!this.renderer || !this.scene || !this.camera) {
      throw new Error(
        'Unable to render scene, invalid renderer, camera, or scene settings'
      );
    }

    this.renderer.render(this.scene, this.camera);
  }

  startAnimationPlayback(animation) {
    // Begin animation playback
    const { cinePlaying } = this.state;

    // Ensure that there are animations and a mixer
    if (!this.sceneData || !(this.sceneData.animations || []).length) {
      throw new Error(
        'Unable to begin animation playback. No animations are defined in the scene.'
      );
    }

    if (!this.mixer) {
      throw new Error('Unable to begin animation playback. No mixer defined.');
    }

    if (!cinePlaying) {
      animation = animation || this.sceneData.animations[0];

      // Re-start anaimation clock
      this.clock.running = true;
      this.clock.start();

      // Initialize animation and begin playback
      if (!this.cineAction) {
        this.cineAction = this.mixer.clipAction(animation);
        this.cineAction.play();
      }

      this.setState({ cinePlaying: true });
    }
  }

  setAnimationFrameRate(frate) {
    // Change the time scale of the animation
    const { deviceRenderDefault } = this.props;
    let timeScale = frate / deviceRenderDefault;

    if (this.mixer) {
      this.mixer.timeScale = timeScale;
    }

    this.setState({ timeScale: timeScale });
  }

  stopAnimationPlayback() {
    const { cinePlaying } = this.state;
    if (cinePlaying) {
      this.clock.running = false;
      this.setState({ cinePlaying: false });
    }
  }

  animate() {
    // Begin scene playback: animation, interaction, and render loop
    if (this.model) {
      const { cinePlaying } = this.state;

      // Animate the model
      window.requestAnimationFrame(this.animate.bind(this));

      // getDelta must be called every frame unconditionally so the clock stays
      // in sync. CameraControls.update() requires a delta time (in seconds) for
      // its damping/physics simulation — omitting it causes NaN state corruption,
      // which manifests as jitter and a black screen on zoom.
      const delta = this.clock.getDelta();

      if (cinePlaying) {
        this.mixer.update(delta);
      }

      // Update navigation and re-render
      this.controls.update(delta);
      this.renderScene();
    }
  }

  async componentDidMount() {
    // Initialize Three.js container and components
    const { modelType } = this.props;

    // Create clock and renderer, add canvas element to the component, set initial size
    this.clock = this.initClock();
    this.renderer = this.initRenderer();
    this.container.current.append(this.renderer.domElement);

    //  Create scene and camera
    this.generator = this.initGenerator(this.renderer);
    this.scene = this.initScene(this.renderer, this.generator);

    // Load model data from file
    await this.loadModelData();

    // Initialize mixer
    if (
      this.sceneData &&
      this.sceneData.animations &&
      this.sceneData.animations.length
    ) {
      this.mixer = this.initMixer(this.model);
    }

    // Create scene and controls
    this.camera = this.initCamera(this.model);
    this.controls = this.initControls(this.renderer, this.camera, this.model);

    // Add lights to scene
    this.lightScene(this.model, this.scene);

    // Render scene
    this.resize();
    this.renderScene();

    // Trigger component callback and pass API reference
    const _component = this;
    if (this.props.onCreated) {
      const api = {
        container: this.container.current,
        renderer: this.renderer,
        scene: this.scene,
        model: this.model,
        sceneData: this.sceneData,
        resize: this.resize.bind(this),
        render: this.renderScene.bind(this),
        startAnimationPlayback: this.startAnimationPlayback.bind(this),
        stopAnimationPlayback: this.stopAnimationPlayback.bind(this),
        setAnimationFrameRate: this.setAnimationFrameRate.bind(this),
        getModelInstance: this.getModelInstance.bind(this),
        setModelVisibility: this.setModelVisibility.bind(this),
        setModelWireframe: this.setModelWireframe.bind(this),
        setModelColor: this.setModelColor.bind(this),
        getModelPresentation: this.getModelPresentation.bind(this),
        _component: _component,
      };

      this.props.onCreated(api);

      // Begin interaction loop
      this.animate();
    }
  }

  componentWillUnmount() {
    // Component is set to unmount, disable animation loop and undefine model
    this.model = undefined;
  }

  render() {
    const style = { width: '100%', height: '100%', position: 'relative' };
    const { getStaticUrl } = this.props;

    return (
      <div style={style}>
        <div ref={this.container} style={style} />
      </div>
    );
  }
}
