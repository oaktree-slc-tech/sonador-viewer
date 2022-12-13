import _ from 'lodash';

import React, { Component } from 'react';
import PropTypes from 'prop-types';

import OHIF, { utils, redux } from '@ohif/core';

const { TypedArrayProp } = OHIF.classes;

import {
  Clock,
  BoxBufferGeometry,
  AnimationMixer,
  Color,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  PMREMGenerator,
  Box3,
  Vector3,
} from 'three';

import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export default class M3DModelView extends Component {
  // OHIF model view class (wraps a Three.js scene)

  constructor(props) {
    super(props);

    this.container = React.createRef();
  }

  static propTypes = {
    modelFileUrl: PropTypes.string.isRequired,
    modelType: PropTypes.string.isRequired,
    onCreated: PropTypes.func,
    onDestroyed: PropTypes.func,
    cameraOptions: PropTypes.object.isRequired,
    cameraStart: PropTypes.array.isRequired,
    renderOptions: PropTypes.object.isRequired,
    interactionControlOptions: PropTypes.object.isRequired,
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
    cameraStart: [0, 0, 10],
    renderOptions: { antialias: true },
    env: { sigma: 0 },
    interactionControlOptions: {
      target: [0, 0.5, 0],
      enablePan: true,
      enableDamping: true,
    },
    cine: {},
    deviceRenderDefault: 60,
  };

  initGlbLoader() {
    // Initialize model loader
    // @returns model loader instance
    const { modelType, getStaticUrl } = this.props;

    // Initialize GLTF loader
    const loader = new GLTFLoader();

    // Add Draco loader if static URL specified
    if (getStaticUrl && _.isFunction(getStaticUrl) && getStaticUrl()) {
      // Initialize DRACO loader and retrieve decoder from OHIF static URL.
      // The DRACO loader encoders/decoders must be staged from a static server.
      // If a static URL is not provided, the loader will be initialized without DRACO
      // which may prevent some GLB assets from loading.
      const dracoLoader = new DRACOLoader();
      dracoLoader.setDecoderPath(getStaticUrl() + '/threejs/lib/draco/gltf/');

      // Add support for DRACO to the GLB loader.
      loader.setDRACOLoader(dracoLoader);
    }

    return loader;
  }

  initRenderer() {
    // Initialize renderer
    // @returns render instance
    const { renderOptions: roptions } = this.props;

    const renderer = new WebGLRenderer(roptions);
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
    _.defaults(
      options,
      _.pick(
        defaultCameraOptions,
        'fov',
        'near',
        'far',
        'offset',
        'farEdgeBuffer'
      )
    );

    // Camera aspect ratio
    const aspect =
      this.container.current.clientWidth / this.container.current.clientHeight;

    // Placeholder variables for calculating the camera settings based on
    let fov, near, far, cstart;

    // Create a box to (attempt) to calculate the model start position.
    // Refer to https://wejn.org/2020/12/cracking-the-threejs-object-fitting-nut/ and
    // https://discourse.threejs.org/t/find-the-size-of-a-loaded-gltf-model/38515/2 and
    // https://stackoverflow.com/questions/14614252/how-to-fit-camera-to-object
    // for background on sizing a Three.js scene, calculating a bounding volume,
    // and determining camera parameters.
    if (model) {
      // Create a scene model and calculate size of scene
      const box = new Box3().setFromObject(this.sceneData.scene);
      const size = box.getSize(new Vector3());

      // Figure out how to fit the box in the view:
      // Refer to https://wejn.org/2020/12/cracking-the-threejs-object-fitting-nut/.
      //
      // 1. figure out horizontal FOV (on non-1.0 aspects)
      // 2. figure out distance from the object in X and Y planes
      // 3. select the max distance (to fit both sides in)
      //
      // The reason is as follows:
      //
      // Imagine a bounding box (BB) is centered at (0,0,0).
      // Camera has vertical FOV (camera.fov) and horizontal FOV
      // (camera.fov scaled by aspect, see fovh below)
      //
      // Therefore if you want to put the entire object into the field of view,
      // you have to compute the distance as: z/2 (half of Z size of the BB
      // protruding towards us) plus for both X and Y size of BB you have to
      // figure out the distance created by the appropriate FOV.
      //
      // The FOV is always a triangle:
      //
      //  (size/2)
      // +--------+
      // |       /
      // |      /
      // |     /
      // | F° /
      // |   /
      // |  /
      // | /
      // |/
      //
      // F° is half of respective FOV, so to compute the distance (the length
      // of the straight line) one has to: `size/2 / Math.tan(F)`.
      //
      // FTR, from https://threejs.org/docs/#api/en/cameras/PerspectiveCamera
      // the camera.fov is the vertical FOV.

      fov = options.fov * (Math.PI / 180);
      const fovh = 2 * Math.atan(Math.tan(fov / 2) * aspect);
      let dx = size.z / 2 + Math.abs(size.x / 2 / Math.tan(fovh / 2));
      let dy = size.y / 2 + Math.abs(size.y / 2 / Math.tan(fov / 2));
      let cameraZ = Math.max(dx, dy);

      // Offset the camera to avoid filling the whole canvas
      if (_.isNumber(options.offset) && options.offset != 0) {
        cameraZ *= options.offset;
      }

      // Camera start position
      cstart = [defaultCameraStart[0], defaultCameraStart[1], cameraZ];

      // Set the far plane of the camera so that it encompasses the whole object
      const minZ = box.min.z;
      let cameraFarEdge = minZ < 0 ? -minZ + cameraZ : cameraZ - minZ;
      far = cameraFarEdge * options.farEdgeBuffer;
    }

    // Create camera instance and set start position. Use calculated positions (if available)
    // with fallbacks to default values.
    const camera = new PerspectiveCamera(
      options.fov,
      aspect,
      near || options.near,
      far || options.far
    );
    camera.position.set(...(cstart || defaultCameraStart));

    return camera;
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
    if (generator) {
      scene.environment = generator.fromScene(
        new RoomEnvironment(),
        env.sigma || 0
      ).texture;
    }

    // Initialize environment
    return scene;
  }

  initControls(renderer, camera) {
    // Initialize interactive controls for the scene
    const {
      interactionControlOptions: coptions,
      onInteractionChange,
      onInteractionStart,
      onInteractionEnd,
    } = this.props;

    const controls = new OrbitControls(camera, renderer.domElement);
    if (coptions.target) {
      controls.target.set(...coptions.target);
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
    _.extend(controls, _.pick(coptions, 'enablePan', 'enableDamping'));
    return controls;
  }

  initMixer(model) {
    // Initialize mixer for animations
    const mixer = new AnimationMixer(model);
    return mixer;
  }

  async fetchModelData(murl) {
    // Fetch model data from the provided URL
    // @returns array of model instances
    const [sceneData] = await Promise.all([this.loader.loadAsync(murl)]);

    return sceneData;
  }

  async loadModelData() {
    // Load model data from file
    const { modelType, modelFileUrl } = this.props;

    // Retriete model file and add to scene
    this.sceneData = await this.fetchModelData(modelFileUrl);
    this.model = this.sceneData ? this.sceneData.scene : undefined;

    if (this.model) {
      // Add model to the scene
      this.scene.add(this.model);
    }
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

      if (cinePlaying) {
        const mixerUpdateDelta = this.clock.getDelta();
        this.mixer.update(mixerUpdateDelta);
      }

      // Update navigation and re-render
      this.controls.update();
      this.renderScene();
    }
  }

  async componentDidMount() {
    // Initialize Three.js container and components

    // Initialize model loader
    this.loader = this.initGlbLoader();

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
    this.controls = this.initControls(this.renderer, this.camera);

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
        _component: _component,
      };

      this.props.onCreated(api);

      // Begin interaction loop
      this.animate();

      console.log('Scene data: ', this.sceneData);
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
