import * as THREE from 'three';
import { Coordinates, Extent } from '@itowns/geographic';
const quaternion = new THREE.Quaternion();
const center = new THREE.Vector3();

/** Specialized parameters for the [PlanarTileBuilder]. */

/**
 * TileBuilder implementation for the purpose of generating planar
 * tile arrangements.
 */
export class PlanarTileBuilder {
  constructor(options) {
    if (options.projection) {
      console.warn('PlanarTileBuilder projection parameter is deprecated,' + ' use crs instead.');
      options.crs ??= options.projection;
    }
    this._crs = options.crs;
    this._transform = {
      coords: new Coordinates('EPSG:4326', 0, 0),
      position: new THREE.Vector3(),
      normal: new THREE.Vector3(0, 0, 1)
    };
    this._uvCount = options.uvCount ?? 1;
  }
  get uvCount() {
    return this._uvCount;
  }
  get crs() {
    return this._crs;
  }
  prepare(params) {
    const newParams = params;
    newParams.nbRow = 2 ** (params.level + 1.0);
    newParams.coordinates = new Coordinates(this.crs);
    return newParams;
  }
  center(extent) {
    extent.center(this._transform.coords);
    center.set(this._transform.coords.x, this._transform.coords.y, 0);
    return center;
  }
  vertexPosition(coordinates) {
    this._transform.position.set(coordinates.x, coordinates.y, 0);
    return this._transform.position;
  }
  vertexNormal() {
    return this._transform.normal;
  }
  uProject(u, extent) {
    return extent.west + u * (extent.east - extent.west);
  }
  vProject(v, extent) {
    return extent.south + v * (extent.north - extent.south);
  }
  computeShareableExtent(extent) {
    // compute shareable extent to pool the geometries
    // the geometry in common extent is identical to the existing input
    // with a translation
    return {
      shareableExtent: new Extent(extent.crs).setFromExtent({
        west: 0,
        east: Math.abs(extent.west - extent.east),
        south: 0,
        north: Math.abs(extent.north - extent.south)
      }),
      quaternion,
      position: this.center(extent).clone()
    };
  }
}