export function createShaders(invalidDepthThreshold) {
  const invalidDepthThresholdValue = invalidDepthThreshold.toFixed(8);

  return {
    vertexShader: `
      uniform sampler2D uDepthTexture;
      uniform float uDepthScale;
      uniform float uInvertDepth;
      varying vec2 vUv;
      varying float vDepthMask;

      void main() {
        vUv = uv;

        float rawDepth = texture2D(uDepthTexture, uv).r;
        vDepthMask = step(${invalidDepthThresholdValue}, rawDepth);

        float depthValue = mix(rawDepth, 1.0 - rawDepth, uInvertDepth);
        vec3 displaced = position;
        displaced.z += depthValue * uDepthScale * vDepthMask;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D uColorTexture;
      uniform sampler2D uSegmentMaskTexture;
      varying vec2 vUv;
      varying float vDepthMask;

      void main() {
        if (vDepthMask < 0.5 || texture2D(uSegmentMaskTexture, vUv).r < 0.5) {
          discard;
        }

        vec4 color = texture2D(uColorTexture, vUv);
        gl_FragColor = color;
      }
    `,
    staticVertexShader: `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    staticFragmentShader: `
      uniform sampler2D uColorTexture;
      uniform sampler2D uSegmentMaskTexture;
      varying vec2 vUv;

      void main() {
        if (texture2D(uSegmentMaskTexture, vUv).r < 0.5) {
          discard;
        }
        vec4 color = texture2D(uColorTexture, vUv);
        gl_FragColor = color;
      }
    `,
    pointVertexShader: `
      uniform sampler2D uDepthTexture;
      uniform float uDepthScale;
      uniform float uInvertDepth;
      uniform float uPointSize;
      varying vec2 vUv;
      varying float vDepthMask;

      void main() {
        vUv = uv;

        float rawDepth = texture2D(uDepthTexture, uv).r;
        vDepthMask = step(${invalidDepthThresholdValue}, rawDepth);

        float depthValue = mix(rawDepth, 1.0 - rawDepth, uInvertDepth);
        vec3 displaced = position;
        displaced.z += depthValue * uDepthScale * vDepthMask;

        vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = uPointSize;
      }
    `,
    pointFragmentShader: `
      uniform sampler2D uSegmentMaskTexture;
      varying vec2 vUv;
      varying float vDepthMask;

      void main() {
        if (vDepthMask < 0.5 || texture2D(uSegmentMaskTexture, vUv).r < 0.5) {
          discard;
        }

        vec2 centered = gl_PointCoord - vec2(0.5);
        if (dot(centered, centered) > 0.25) {
          discard;
        }

        gl_FragColor = vec4(1.0, 0.1, 0.1, 1.0);
      }
    `,
    staticPointVertexShader: `
      varying vec2 vUv;
      uniform float uPointSize;

      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uPointSize;
      }
    `,
    psdLayerVertexShader: `
      uniform sampler2D uDepthTexture;
      uniform float uDepthScale;
      uniform float uInvertDepth;
      varying vec2 vUv;
      varying float vDepthMask;

      void main() {
        vUv = uv;
        float rawDepth = texture2D(uDepthTexture, uv).r;
        vDepthMask = step(${invalidDepthThresholdValue}, rawDepth);
        float depthValue = mix(rawDepth, 1.0 - rawDepth, uInvertDepth);
        vec3 displaced = position;
        displaced.z += depthValue * uDepthScale * vDepthMask;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
      }
    `,
    psdLayerFragmentShader: `
      uniform sampler2D uColorTexture;
      uniform sampler2D uMaskTexture;
      varying vec2 vUv;
      varying float vDepthMask;

      void main() {
        if (vDepthMask < 0.5 || texture2D(uMaskTexture, vUv).r < 0.5) {
          discard;
        }
        vec4 color = texture2D(uColorTexture, vUv);
        if (color.a < 0.01) {
          discard;
        }
        gl_FragColor = color;
      }
    `,
    staticPsdLayerFragmentShader: `
      uniform sampler2D uColorTexture;
      uniform sampler2D uMaskTexture;
      varying vec2 vUv;

      void main() {
        if (texture2D(uMaskTexture, vUv).r < 0.5) {
          discard;
        }
        vec4 color = texture2D(uColorTexture, vUv);
        if (color.a < 0.01) {
          discard;
        }
        gl_FragColor = color;
      }
    `,
  };
}
