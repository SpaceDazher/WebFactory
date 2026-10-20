import assert from 'node:assert/strict';
import { gpuName } from '../src/client/perfbench';
import { GLBatch } from '../src/render/batch';

let requestedAttributes: WebGLContextAttributes | null = null;
GLBatch.create({
  getContext(kind: string, attributes: WebGLContextAttributes) {
    assert.equal(kind, 'webgl2');
    requestedAttributes = attributes;
    return null;
  },
} as unknown as HTMLCanvasElement);
const capturedAttributes = () => requestedAttributes;
assert.equal(capturedAttributes()?.powerPreference, 'high-performance', 'request the high-performance WebGL adapter');

function fakeGl(name: string, debugExtension = true, lost = false) {
  let loseCalls = 0;
  const gl = {
    RENDERER: 0x1f01,
    isContextLost: () => lost,
    getExtension(extension: string) {
      if (extension === 'WEBGL_debug_renderer_info' && debugExtension) return { UNMASKED_RENDERER_WEBGL: 0x9246 };
      if (extension === 'WEBGL_lose_context') return { loseContext: () => { loseCalls++; } };
      return null;
    },
    getParameter(parameter: number) { return parameter === 0x9246 ? name : `generic ${name}`; },
  } as unknown as WebGLRenderingContext;
  return { gl, loseCalls: () => loseCalls };
}

const intel = fakeGl('ANGLE (Intel UHD Graphics, Direct3D11)');
assert.equal(gpuName(intel.gl, 'webgl'), 'ANGLE (Intel UHD Graphics, Direct3D11)', 'report the live game GL adapter');
assert.equal(intel.loseCalls(), 0, 'GPU reporting must not destroy the game context');

const generic = fakeGl('WebKit WebGL', false);
assert.equal(gpuName(generic.gl, 'webgl'), 'generic WebKit WebGL', 'fall back to the active context renderer when unmasked info is unavailable');
assert.equal(gpuName(fakeGl('ANGLE (Intel)', true, true).gl, 'webgl'), 'unknown', 'lost context does not report stale adapter data');
assert.equal(gpuName(null, 'canvas'), 'Canvas2D (WebGL not active)', 'Canvas reports no active GPU context instead of probing a spare canvas');
assert.equal(gpuName(null, 'webgl'), 'unknown', 'missing WebGL context is reported honestly');

console.log('GPU reporting follows the active game context without allocating or losing a context.');
