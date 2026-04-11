function isPsdFilename(name) {
  return /\.psd$/i.test(name || "");
}

export function createAppActions(deps) {
  const {
    THREE,
    scene,
    renderState,
    elements,
    shaders,
    defaults,
    disposeMeshDepthTexture,
    clearSceneVisuals,
    buildPsdLayerMeshes,
    refreshStatusCounts,
    buildMaskedPlaneGeometry,
    buildRenderedBoundaryPointGeometry,
    loadPsdPair,
    syncViewerModeUi,
    syncThumbs,
    revokeObjectUrl,
    loadTexture,
    loadDepthPixels,
    loadRgbPixels,
    rebuildSegments,
    rebuildSegmentList,
    createSegmentThumbDataUrl,
    disposeGeneratedDepthTexture,
    disposeAdjustedDepthTexture,
    disposeRepairedBaseDepthTexture,
    createSegmentedGridDepthResources,
    rebuildRepairedBaseDepth,
    meshEditRuntime,
  } = deps;

  const {
    depthScaleEl,
    invertDepthEl,
    meshDetailEl,
    surfaceSmoothEl,
    sourceModeEl,
    statusEl,
    depthModeEl,
    gridSpecModeEl,
    gridXEl,
    gridYEl,
    kernelSizeEl,
    interpModeEl,
  } = elements;

  const {
    vertexShader,
    fragmentShader,
    staticVertexShader,
    staticFragmentShader,
    pointVertexShader,
    pointFragmentShader,
    staticPointVertexShader,
  } = shaders;

  function buildMesh() {
    disposeMeshDepthTexture();
    clearSceneVisuals();

    if (renderState.sourceMode === "psd") {
      buildPsdLayerMeshes();
      rebuildSegmentList();
      refreshStatusCounts();
      return;
    }

    const step = Number(meshDetailEl.value);
    renderState.meshDepthTexture = renderState.activeDepthTexture;
    renderState.meshDepthPixels = renderState.activeDepthPixels;
    renderState.meshGapMask = renderState.repairedBaseGapMask || new Uint8Array(
      renderState.imageWidth * renderState.imageHeight,
    );
    const useSurfaceSmooth = surfaceSmoothEl.checked;
    const geometry = buildMaskedPlaneGeometry(
      renderState.imageWidth,
      renderState.imageHeight,
      renderState.meshDepthPixels,
      renderState.segmentMap,
      renderState.segmentDepthMeans,
      renderState.meshGapMask,
      step,
      {
        bakeDepth: useSurfaceSmooth,
        depthScale: Number(depthScaleEl.value),
        invertDepth: invertDepthEl.checked,
        surfaceSmooth: useSurfaceSmooth,
      },
    );

    geometry.computeVertexNormals();

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColorTexture: { value: renderState.colorTexture },
        uSegmentMaskTexture: { value: renderState.segmentMaskTexture },
        ...(useSurfaceSmooth ? {} : {
          uDepthTexture: { value: renderState.meshDepthTexture },
          uDepthScale: { value: Number(depthScaleEl.value) },
          uInvertDepth: { value: invertDepthEl.checked ? 1 : 0 },
        }),
      },
      vertexShader: useSurfaceSmooth ? staticVertexShader : vertexShader,
      fragmentShader: useSurfaceSmooth ? staticFragmentShader : fragmentShader,
      side: THREE.DoubleSide,
      transparent: true,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.targetKey = "raster:base";
    scene.add(mesh);

    const edgeGeometry = buildRenderedBoundaryPointGeometry(
      renderState.imageWidth,
      renderState.imageHeight,
      renderState.meshDepthPixels,
      renderState.segmentMap,
      renderState.meshGapMask,
      step,
    );
    const edgePointMaterial = new THREE.ShaderMaterial({
      uniforms: useSurfaceSmooth
        ? {
          uSegmentMaskTexture: { value: renderState.segmentMaskTexture },
          uPointSize: { value: 2.2 },
        }
        : {
          uDepthTexture: { value: renderState.meshDepthTexture },
          uSegmentMaskTexture: { value: renderState.segmentMaskTexture },
          uDepthScale: { value: Number(depthScaleEl.value) },
          uInvertDepth: { value: invertDepthEl.checked ? 1 : 0 },
          uPointSize: { value: 2.2 },
        },
      vertexShader: useSurfaceSmooth ? staticPointVertexShader : pointVertexShader,
      fragmentShader: pointFragmentShader,
      transparent: true,
      depthWrite: false,
    });
    const edgePoints = new THREE.Points(edgeGeometry, edgePointMaterial);
    scene.add(edgePoints);

    renderState.mesh = mesh;
    renderState.material = material;
    renderState.edgePoints = edgePoints;
    renderState.edgePointMaterial = edgePointMaterial;
    meshEditRuntime?.applyToEntries([{ mesh, targetKey: "raster:base" }]);
    meshEditRuntime?.sync([{ mesh, targetKey: "raster:base" }]);

    refreshStatusCounts();
  }

  async function replaceImage(kind, file) {
    statusEl.textContent = `Loading ${kind}...`;

    if (kind === "color" && isPsdFilename(file.name)) {
      const buffer = await file.arrayBuffer();
      renderState.pendingPsdColorBuffer = buffer;
      await loadPsdPair(renderState.pendingPsdColorBuffer);
      renderState.sourceMode = "psd";
      sourceModeEl.value = "psd";
      syncViewerModeUi();
      buildMesh();
      syncThumbs();
      statusEl.textContent = "Loaded PSD.";
      return;
    }

    const objectUrl = URL.createObjectURL(file);

    try {
      renderState.sourceMode = "raster";
      sourceModeEl.value = "raster";
      renderState.imageWidth = renderState.rasterImageWidth;
      renderState.imageHeight = renderState.rasterImageHeight;
      syncViewerModeUi();

      if (kind === "color") {
        const texture = await loadTexture(objectUrl);

        if (
          texture.image.width !== renderState.imageWidth ||
          texture.image.height !== renderState.imageHeight
        ) {
          throw new Error("Color image size must match the current depth image.");
        }

        texture.encoding = THREE.sRGBEncoding;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;

        if (renderState.colorTexture) {
          renderState.colorTexture.dispose();
        }

        revokeObjectUrl("color");
        renderState.colorTexture = texture;
        renderState.colorObjectUrl = objectUrl;
        renderState.rasterImageWidth = texture.image.width;
        renderState.rasterImageHeight = texture.image.height;
        if (renderState.material) {
          renderState.material.uniforms.uColorTexture.value = texture;
        }
        syncThumbs();
        refreshStatusCounts();
        return;
      }

      if (kind === "depth") {
        const [texture, depthPixels] = await Promise.all([
          loadTexture(objectUrl),
          loadDepthPixels(objectUrl),
        ]);

        if (
          texture.image.width !== renderState.imageWidth ||
          texture.image.height !== renderState.imageHeight
        ) {
          throw new Error("Depth image size must match the current color image.");
        }

        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;

        if (renderState.sourceDepthTexture) {
          renderState.sourceDepthTexture.dispose();
        }

        revokeObjectUrl("depth");
        renderState.sourceDepthTexture = texture;
        renderState.sourceDepthPixels = depthPixels;
        renderState.depthObjectUrl = objectUrl;
        renderState.rasterImageWidth = texture.image.width;
        renderState.rasterImageHeight = texture.image.height;
        rebuildSegments();
        rebuildDepthModeResources();
        buildMesh();
        syncThumbs();
        return;
      }

      const segmentImage = await loadRgbPixels(objectUrl);
      if (
        segmentImage.width !== renderState.imageWidth ||
        segmentImage.height !== renderState.imageHeight
      ) {
        throw new Error("Segment image size must match the current color/depth image.");
      }

      revokeObjectUrl("segment");
      renderState.segmentSourcePixels = segmentImage.pixels;
      renderState.segmentObjectUrl = objectUrl;
      renderState.rasterImageWidth = segmentImage.width;
      renderState.rasterImageHeight = segmentImage.height;
      renderState.segmentThumbUrl = createSegmentThumbDataUrl(
        renderState.segmentSourcePixels,
        renderState.imageWidth,
        renderState.imageHeight,
      );
      rebuildSegments();
      rebuildDepthModeResources();
      buildMesh();
      syncThumbs();
      rebuildSegmentList();
    } catch (error) {
      URL.revokeObjectURL(objectUrl);
      statusEl.textContent = `Failed: ${error.message}`;
      console.error(error);
    }
  }

  function rebuildDepthModeResources() {
    disposeGeneratedDepthTexture();
    disposeAdjustedDepthTexture();
    disposeRepairedBaseDepthTexture();

    if (depthModeEl.value === "raw") {
      renderState.baseDepthTexture = renderState.rawDepthTexture;
      renderState.baseDepthPixels = renderState.rawDepthPixels;
      rebuildRepairedBaseDepth();
      return;
    }

    const generated = createSegmentedGridDepthResources(
      renderState.imageWidth,
      renderState.imageHeight,
      renderState.rawSegmentData,
      gridSpecModeEl.value,
      Number(gridXEl.value),
      Number(gridYEl.value),
      Number(kernelSizeEl.value),
      interpModeEl.value,
    );

    renderState.generatedDepthTexture = generated.texture;
    renderState.baseDepthTexture = generated.texture;
    renderState.baseDepthPixels = generated.pixels;
    rebuildRepairedBaseDepth();
  }

  return {
    buildMesh,
    replaceImage,
    rebuildDepthModeResources,
    defaults,
  };
}
