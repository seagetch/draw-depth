export const invalidDepthThreshold = 1 / 255;
export const segmentAnchorDistance = 36;
export const segmentMinAnchorPixels = 24;
export const segmentMinAnchorRatio = 0.00003;
export const segmentMergeThresholdRatio = 0.0008;
export const relativeDepthFactor = 0.12;
export const relativeDepthFloor = 24;
export const segmentDepthOffsetStep = 6;
export const segmentDepthScaleStep = 0.1;

function withCacheBust(url, cacheBustToken) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${cacheBustToken}`;
}

export function createDefaultAssetUrls(cacheBustToken = `${Date.now()}`) {
  const colorUrl = "./data/Midori-color.jpg";
  const depthUrl = "./data/Midori-depth.jpg";
  const segmentUrl = "./data/Midori-segment.jpg";
  const psdColorUrl = "./data/Midori-full.psd";
  const psdDepthPsdUrl = "./data/Midori-full-depth.psd";
  const psdStableDepthUrl = "./data/Midori-depth-st.png";

  return {
    colorUrl,
    depthUrl,
    segmentUrl,
    psdColorUrl,
    psdDepthPsdUrl,
    psdStableDepthUrl,
    defaultColorUrl: withCacheBust(colorUrl, cacheBustToken),
    defaultDepthUrl: withCacheBust(depthUrl, cacheBustToken),
    defaultSegmentUrl: withCacheBust(segmentUrl, cacheBustToken),
    defaultPsdColorUrl: withCacheBust(psdColorUrl, cacheBustToken),
    defaultPsdDepthPsdUrl: withCacheBust(psdDepthPsdUrl, cacheBustToken),
    defaultPsdStableDepthUrl: withCacheBust(psdStableDepthUrl, cacheBustToken),
  };
}
