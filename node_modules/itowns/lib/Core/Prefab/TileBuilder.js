import * as THREE from 'three';
import { TileGeometry } from "../TileGeometry.js";
import { LRUCache } from 'lru-cache';
import { computeBuffers } from "./computeBufferTileGeometry.js";
import OBB from "../../Renderer/OBB.js";
const cacheBuffer = new Map();
const cacheTile = new LRUCache({
  max: 500
});

/**
 * Reference to a tile's extent with rigid transformations.
 * Enables reuse of geometry, saving a bit of memory.
 */

export function newTileGeometry(builder, params) {
  const {
    shareableExtent,
    quaternion,
    position
  } = builder.computeShareableExtent(params.extent);
  const south = shareableExtent.south.toFixed(6);
  const bufferKey = `${builder.crs}_${params.disableSkirt ? 0 : 1}_${params.segments}`;
  const key = `s${south}l${params.level}bK${bufferKey}`;
  let promiseGeometry = cacheTile.get(key);

  // build geometry if doesn't exist
  if (!promiseGeometry) {
    let resolve;
    promiseGeometry = new Promise(r => {
      resolve = r;
    });
    cacheTile.set(key, promiseGeometry);
    params.extent = shareableExtent;
    params.center = builder.center(params.extent).clone();
    // Read previously cached values (index and uv.wgs84 only
    // depend on the # of triangles)
    let cachedBuffers = cacheBuffer.get(bufferKey);
    let buffers;
    try {
      buffers = computeBuffers(builder, params, cachedBuffers !== undefined ? {
        index: cachedBuffers.index.array,
        uv: cachedBuffers.uv.array
      } : undefined);
    } catch (e) {
      return Promise.reject(e);
    }
    if (!cachedBuffers) {
      // We know the fields will exist due to the condition
      // matching with the one for buildIndexAndUv_0.
      // TODO: Make this brain-based check compiler-based.

      cachedBuffers = {
        index: new THREE.BufferAttribute(buffers.index, 1),
        uv: new THREE.BufferAttribute(buffers.uvs[0], 2)
      };

      // Update cacheBuffer
      cacheBuffer.set(bufferKey, cachedBuffers);
    }
    const gpuBuffers = {
      index: cachedBuffers.index,
      uvs: [cachedBuffers.uv, ...(buffers.uvs[1] !== undefined ? [new THREE.BufferAttribute(buffers.uvs[1], 1)] : [])],
      position: new THREE.BufferAttribute(buffers.position, 3),
      normal: new THREE.BufferAttribute(buffers.normal, 3)
    };
    const geometry = new TileGeometry(builder, params, gpuBuffers);
    geometry.OBB = new OBB(geometry.boundingBox.min, geometry.boundingBox.max);
    geometry.initRefCount(cacheTile, key);
    resolve(geometry);
    return Promise.resolve({
      geometry,
      quaternion,
      position
    });
  }
  return promiseGeometry.then(geometry => ({
    geometry,
    quaternion,
    position
  }));
}