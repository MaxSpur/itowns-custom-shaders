import * as THREE from 'three';
import { Coordinates, Extent } from '@itowns/geographic';
const PI_OV_FOUR = Math.PI / 4;
const INV_TWO_PI = 1.0 / (Math.PI * 2);
const axisZ = new THREE.Vector3(0, 0, 1);
const axisY = new THREE.Vector3(0, 1, 0);
const quatToAlignLongitude = new THREE.Quaternion();
const quatToAlignLatitude = new THREE.Quaternion();
const quatNormalToZ = new THREE.Quaternion();

/** Transforms a WGS84 latitude into a usable texture offset. */
function WGS84ToOneSubY(latitude) {
  return 1.0 - (0.5 - Math.log(Math.tan(PI_OV_FOUR + THREE.MathUtils.degToRad(latitude) * 0.5)) * INV_TWO_PI);
}

/** Specialized parameters for the [GlobeTileBuilder]. */

/**
 * TileBuilder implementation for the purpose of generating globe (or more
 * precisely ellipsoidal) tile arrangements.
 */
export class GlobeTileBuilder {
  static _crs = 'EPSG:4978';
  static _computeExtraOffset(params) {
    const t = WGS84ToOneSubY(params.coordinates.latitude) * params.nbRow;
    return (!isFinite(t) ? 0 : t) - params.deltaUV1;
  }

  /**
   * Buffer holding information about the tile/vertex currently being
   * processed.
   */

  get crs() {
    return GlobeTileBuilder._crs;
  }
  constructor(options) {
    this._transform = {
      coords: [new Coordinates('EPSG:4326', 0, 0), new Coordinates('EPSG:4326', 0, 0)],
      position: new THREE.Vector3(),
      dimension: new THREE.Vector2()
    };

    // UV: Normalized coordinates (from degree) on the entire tile
    // EPSG:4326
    // Offset: Float row coordinate from Pseudo mercator coordinates
    // EPSG:3857
    if (options.uvCount > 1) {
      this.computeExtraOffset = GlobeTileBuilder._computeExtraOffset;
    }
  }
  prepare(params) {
    const nbRow = 2 ** (params.level + 1.0);
    let st1 = WGS84ToOneSubY(params.extent.south);
    if (!isFinite(st1)) {
      st1 = 0;
    }
    const start = st1 % (1.0 / nbRow);
    const newParams = {
      nbRow,
      deltaUV1: (st1 - start) * nbRow,
      // transformation to align tile's normal to z axis
      quatNormalToZ: quatNormalToZ.setFromAxisAngle(axisY, -(Math.PI * 0.5 - THREE.MathUtils.degToRad(params.extent.center().latitude))),
      // let's avoid building too much temp objects
      coordinates: new Coordinates(this.crs)
    };
    params.extent.planarDimensions(this._transform.dimension);
    return {
      ...params,
      ...newParams
    };
  }
  center(extent) {
    return extent.center(this._transform.coords[0]).as(this.crs, this._transform.coords[1]).toVector3();
  }
  vertexPosition(coordinates) {
    return this._transform.coords[0].setFromValues(coordinates.x, coordinates.y).as(this.crs, this._transform.coords[1]).toVector3(this._transform.position);
  }
  vertexNormal() {
    return this._transform.coords[1].geodesicNormal;
  }
  uProject(u, extent) {
    return extent.west + u * this._transform.dimension.x;
  }
  vProject(v, extent) {
    return extent.south + v * this._transform.dimension.y;
  }
  computeShareableExtent(extent) {
    // NOTE: It should be possible to take advantage of equatorial plane
    // symmetry, for which we'd have to reverse the tile's UVs.
    // This would halve the memory requirement when viewing a full globe,
    // but that case is not that relevant for iTowns' usual use cases and
    // the globe mesh memory usage is already inconsequential.
    const sizeLongitude = Math.abs(extent.west - extent.east) / 2;
    const shareableExtent = new Extent(extent.crs, -sizeLongitude, sizeLongitude, extent.south, extent.north);

    // Compute rotation to transform the tile to position on the ellispoid.
    // This transformation takes the parents' transformation into account.
    const rotLon = THREE.MathUtils.degToRad(extent.west - shareableExtent.west);
    const rotLat = THREE.MathUtils.degToRad(90 - extent.center(this._transform.coords[0]).latitude);
    quatToAlignLongitude.setFromAxisAngle(axisZ, rotLon);
    quatToAlignLatitude.setFromAxisAngle(axisY, rotLat);
    quatToAlignLongitude.multiply(quatToAlignLatitude);
    return {
      shareableExtent,
      quaternion: quatToAlignLongitude.clone(),
      position: this.center(extent)
    };
  }
}