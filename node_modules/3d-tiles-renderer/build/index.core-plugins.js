import { L as m, r as g, c as v } from "./LoaderBase-CfTLVHyZ.js";
import { C as E, G as R, Q as N, z as U } from "./QuantizedMeshLoaderBase-018lzCXI.js";
function _(h) {
  return h.__implicitRoot.implicitTiling.subdivisionScheme === "OCTREE";
}
function d(h) {
  return _(h) ? 8 : 4;
}
function y(h, e) {
  if (!e)
    return [0, 0, 0];
  const i = 2 * e.__x + h.__subtreeIdx % 2, t = 2 * e.__y + Math.floor(h.__subtreeIdx / 2) % 2, r = _(h) ? 2 * e.__z + Math.floor(h.__subtreeIdx / 4) % 2 : 0;
  return [i, t, r];
}
class b {
  constructor(e, i) {
    this.parent = e, this.children = [], this.__level = e.__level + 1, this.__implicitRoot = e.__implicitRoot, this.__subtreeIdx = i, [this.__x, this.__y, this.__z] = y(this, e);
  }
  static copy(e) {
    const i = {};
    return i.children = [], i.__level = e.__level, i.__implicitRoot = e.__implicitRoot, i.__subtreeIdx = e.__subtreeIdx, [i.__x, i.__y, i.__z] = [e.__x, e.__y, e.__z], i.boundingVolume = e.boundingVolume, i.geometricError = e.geometricError, i;
  }
}
class A extends m {
  constructor(e) {
    super(), this.tile = e, this.rootTile = e.__implicitRoot, this.workingPath = null;
  }
  /**
   * A helper object for storing the two parts of the subtree binary
   *
   * @typedef {object} Subtree
   * @property {number} version
   * @property {JSON} subtreeJson
   * @property {ArrayBuffer} subtreeByte
   * @private
   */
  /**
   *
   * @param buffer
   * @return {Subtree}
   */
  parseBuffer(e) {
    const i = new DataView(e);
    let t = 0;
    const r = g(i);
    console.assert(r === "subt", 'SUBTREELoader: The magic bytes equal "subt".'), t += 4;
    const s = i.getUint32(t, !0);
    console.assert(s === 1, 'SUBTREELoader: The version listed in the header is "1".'), t += 4;
    const n = i.getUint32(t, !0);
    t += 8;
    const o = i.getUint32(t, !0);
    t += 8;
    const l = JSON.parse(v(new Uint8Array(e, t, n)));
    t += n;
    const a = e.slice(t, t + o);
    return {
      version: s,
      subtreeJson: l,
      subtreeByte: a
    };
  }
  async parse(e) {
    const i = this.parseBuffer(e), t = i.subtreeJson;
    t.contentAvailabilityHeaders = [].concat(t.contentAvailability);
    const r = this.preprocessBuffers(t.buffers), s = this.preprocessBufferViews(
      t.bufferViews,
      r
    );
    this.markActiveBufferViews(t, s);
    const n = await this.requestActiveBuffers(
      r,
      i.subtreeByte
    ), o = this.parseActiveBufferViews(s, n);
    this.parseAvailability(i, t, o), this.expandSubtree(this.tile, i);
  }
  /**
   * Determine which buffer views need to be loaded into memory. This includes:
   *
   * <ul>
   * <li>The tile availability bitstream (if a bitstream is defined)</li>
   * <li>The content availability bitstream(s) (if a bitstream is defined)</li>
   * <li>The child subtree availability bitstream (if a bitstream is defined)</li>
   * </ul>
   *
   * <p>
   * This function modifies the buffer view headers' isActive flags in place.
   * </p>
   *
   * @param {JSON} subtreeJson The JSON chunk from the subtree
   * @param {BufferViewHeader[]} bufferViewHeaders The preprocessed buffer view headers
   * @private
   */
  markActiveBufferViews(e, i) {
    let t;
    const r = e.tileAvailability;
    isNaN(r.bitstream) ? isNaN(r.bufferView) || (t = i[r.bufferView]) : t = i[r.bitstream], t && (t.isActive = !0, t.bufferHeader.isActive = !0);
    const s = e.contentAvailabilityHeaders;
    for (let o = 0; o < s.length; o++)
      t = void 0, isNaN(s[o].bitstream) ? isNaN(s[o].bufferView) || (t = i[s[o].bufferView]) : t = i[s[o].bitstream], t && (t.isActive = !0, t.bufferHeader.isActive = !0);
    t = void 0;
    const n = e.childSubtreeAvailability;
    isNaN(n.bitstream) ? isNaN(n.bufferView) || (t = i[n.bufferView]) : t = i[n.bitstream], t && (t.isActive = !0, t.bufferHeader.isActive = !0);
  }
  /**
   * Go through the list of buffers and gather all the active ones into
   * a dictionary.
   * <p>
   * The results are put into a dictionary object. The keys are indices of
   * buffers, and the values are Uint8Arrays of the contents. Only buffers
   * marked with the isActive flag are fetched.
   * </p>
   * <p>
   * The internal buffer (the subtree's binary chunk) is also stored in this
   * dictionary if it is marked active.
   * </p>
   * @param {BufferHeader[]} bufferHeaders The preprocessed buffer headers
   * @param {ArrayBuffer} internalBuffer The binary chunk of the subtree file
   * @returns {object} buffersU8 A dictionary of buffer index to a Uint8Array of its contents.
   * @private
   */
  async requestActiveBuffers(e, i) {
    const t = [];
    for (let n = 0; n < e.length; n++) {
      const o = e[n];
      if (!o.isActive)
        t.push(Promise.resolve());
      else if (o.isExternal) {
        const l = this.parseImplicitURIBuffer(
          this.tile,
          this.rootTile.implicitTiling.subtrees.uri,
          o.uri
        ), a = fetch(l, this.fetchOptions).then((c) => {
          if (!c.ok)
            throw new Error(`SUBTREELoader: Failed to load external buffer from ${o.uri} with error code ${c.status}.`);
          return c.arrayBuffer();
        }).then((c) => new Uint8Array(c));
        t.push(a);
      } else
        t.push(Promise.resolve(new Uint8Array(i)));
    }
    const r = await Promise.all(t), s = {};
    for (let n = 0; n < r.length; n++) {
      const o = r[n];
      o && (s[n] = o);
    }
    return s;
  }
  /**
   * Go through the list of buffer views, and if they are marked as active,
   * extract a subarray from one of the active buffers.
   *
   * @param {BufferViewHeader[]} bufferViewHeaders
   * @param {object} buffersU8 A dictionary of buffer index to a Uint8Array of its contents.
   * @returns {object} A dictionary of buffer view index to a Uint8Array of its contents.
   * @private
   */
  parseActiveBufferViews(e, i) {
    const t = {};
    for (let r = 0; r < e.length; r++) {
      const s = e[r];
      if (!s.isActive)
        continue;
      const n = s.byteOffset, o = n + s.byteLength, l = i[s.buffer];
      t[r] = l.slice(n, o);
    }
    return t;
  }
  /**
   * A buffer header is the JSON header from the subtree JSON chunk plus
   * a couple extra boolean flags for easy reference.
   *
   * Buffers are assumed inactive until explicitly marked active. This is used
   * to avoid fetching unneeded buffers.
   *
   * @typedef {object} BufferHeader
   * @property {boolean} isActive Whether this buffer is currently used.
   * @property {string} [uri] The URI of the buffer (external buffers only)
   * @property {number} byteLength The byte length of the buffer, including any padding contained within.
   * @private
   */
  /**
   * Iterate over the list of buffers from the subtree JSON and add the isActive field for easier parsing later.
   * This modifies the objects in place.
   * @param {Object[]} [bufferHeaders=[]] The JSON from subtreeJson.buffers.
   * @returns {BufferHeader[]} The same array of headers with additional fields.
   * @private
   */
  preprocessBuffers(e = []) {
    for (let i = 0; i < e.length; i++) {
      const t = e[i];
      t.isActive = !1, t.isExternal = !!t.uri;
    }
    return e;
  }
  /**
   * A buffer view header is the JSON header from the subtree JSON chunk plus
   * the isActive flag and a reference to the header for the underlying buffer.
   *
   * @typedef {object} BufferViewHeader
   * @property {BufferHeader} bufferHeader A reference to the header for the underlying buffer
   * @property {boolean} isActive Whether this bufferView is currently used.
   * @property {number} buffer The index of the underlying buffer.
   * @property {number} byteOffset The start byte of the bufferView within the buffer.
   * @property {number} byteLength The length of the bufferView. No padding is included in this length.
   * @private
   */
  /**
   * Iterate the list of buffer views from the subtree JSON and add the
   * isActive flag. Also save a reference to the bufferHeader.
   *
   * @param {Object[]} [bufferViewHeaders=[]] The JSON from subtree.bufferViews.
   * @param {BufferHeader[]} bufferHeaders The preprocessed buffer headers.
   * @returns {BufferViewHeader[]} The same array of bufferView headers with additional fields.
   * @private
   */
  preprocessBufferViews(e = [], i) {
    for (let t = 0; t < e.length; t++) {
      const r = e[t];
      r.bufferHeader = i[r.buffer], r.isActive = !1, r.isExternal = r.bufferHeader.isExternal;
    }
    return e;
  }
  /**
   * Parse the three availability bitstreams and store them in the subtree.
   *
   * @param {Subtree} subtree The subtree to modify.
   * @param {Object} subtreeJson The subtree JSON.
   * @param {Object} bufferViewsU8 A dictionary of buffer view index to a Uint8Array of its contents.
   * @private
   */
  parseAvailability(e, i, t) {
    const r = d(this.rootTile), s = this.rootTile.implicitTiling.subtreeLevels, n = (Math.pow(r, s) - 1) / (r - 1), o = Math.pow(r, s);
    e._tileAvailability = this.parseAvailabilityBitstream(
      i.tileAvailability,
      t,
      n
    ), e._contentAvailabilityBitstreams = [];
    for (let l = 0; l < i.contentAvailabilityHeaders.length; l++) {
      const a = this.parseAvailabilityBitstream(
        i.contentAvailabilityHeaders[l],
        t,
        // content availability has the same length as tile availability.
        n
      );
      e._contentAvailabilityBitstreams.push(a);
    }
    e._childSubtreeAvailability = this.parseAvailabilityBitstream(
      i.childSubtreeAvailability,
      t,
      o
    );
  }
  /**
   * Given the JSON describing an availability bitstream, turn it into an
   * in-memory representation using an object. This handles bitstreams from a bufferView.
   *
   * @param {Object} availabilityJson A JSON object representing the availability.
   * @param {Object} bufferViewsU8 A dictionary of buffer view index to its Uint8Array contents.
   * @param {number} lengthBits The length of the availability bitstream in bits.
   * @returns {object}
   * @private
   */
  parseAvailabilityBitstream(e, i, t) {
    if (!isNaN(e.constant))
      return {
        constant: !!e.constant,
        lengthBits: t
      };
    let r;
    return isNaN(e.bitstream) ? isNaN(e.bufferView) || (r = i[e.bufferView]) : r = i[e.bitstream], {
      bitstream: r,
      lengthBits: t
    };
  }
  /**
   * Expand a single subtree tile. This transcodes the subtree into
   * a tree of {@link SubtreeTile}. The root of this tree is stored in
   * the placeholder tile's children array. This method also creates
   * tiles for the child subtrees to be lazily expanded as needed.
   *
   * @param {Object | SubtreeTile} subtreeRoot The first node of the subtree.
   * @param {Subtree} subtree The parsed subtree.
   * @private
   */
  expandSubtree(e, i) {
    const t = b.copy(e);
    for (let n = 0; i && n < i._contentAvailabilityBitstreams.length; n++)
      if (i && this.getBit(i._contentAvailabilityBitstreams[n], 0)) {
        t.content = { uri: this.parseImplicitURI(e, this.rootTile.content.uri) };
        break;
      }
    e.children.push(t);
    const r = this.transcodeSubtreeTiles(
      t,
      i
    ), s = this.listChildSubtrees(i, r);
    for (let n = 0; n < s.length; n++) {
      const o = s[n], l = o.tile, a = this.deriveChildTile(
        null,
        l,
        null,
        o.childMortonIndex
      );
      a.content = { uri: this.parseImplicitURI(a, this.rootTile.implicitTiling.subtrees.uri) }, l.children.push(a);
    }
  }
  /**
   * Transcode the implicitly defined tiles within this subtree and generate
   * explicit {@link SubtreeTile} objects. This function only transcodes tiles,
   * child subtrees are handled separately.
   *
   * @param {Object | SubtreeTile} subtreeRoot The root of the current subtree.
   * @param {Subtree} subtree The subtree to get availability information.
   * @returns {Array} The bottom row of transcoded tiles. This is helpful for processing child subtrees.
   * @private
   */
  transcodeSubtreeTiles(e, i) {
    let t = [e], r = [];
    for (let s = 1; s < this.rootTile.implicitTiling.subtreeLevels; s++) {
      const n = d(this.rootTile), o = (Math.pow(n, s) - 1) / (n - 1), l = n * t.length;
      for (let a = 0; a < l; a++) {
        const c = o + a, u = a >> Math.log2(n), f = t[u];
        if (!this.getBit(i._tileAvailability, c)) {
          r.push(void 0);
          continue;
        }
        const p = this.deriveChildTile(
          i,
          f,
          c,
          a
        );
        f.children.push(p), r.push(p);
      }
      t = r, r = [];
    }
    return t;
  }
  /**
   * Given a parent tile and information about which child to create, derive
   * the properties of the child tile implicitly.
   * <p>
   * This creates a real tile for rendering.
   * </p>
   *
   * @param {Subtree} subtree The subtree the child tile belongs to.
   * @param {Object | SubtreeTile} parentTile The parent of the new child tile.
   * @param {number} childBitIndex The index of the child tile within the tile's availability information.
   * @param {number} childMortonIndex The morton index of the child tile relative to its parent.
   * @returns {SubtreeTile} The new child tile.
   * @private
   */
  deriveChildTile(e, i, t, r) {
    const s = new b(i, r);
    s.boundingVolume = this.getTileBoundingVolume(s), s.geometricError = this.getGeometricError(s);
    for (let n = 0; e && n < e._contentAvailabilityBitstreams.length; n++)
      if (e && this.getBit(e._contentAvailabilityBitstreams[n], t)) {
        s.content = { uri: this.parseImplicitURI(s, this.rootTile.content.uri) };
        break;
      }
    return s;
  }
  /**
   * Get a bit from the bitstream as a Boolean. If the bitstream
   * is a constant, the constant value is returned instead.
   *
   * @param {ParsedBitstream} object
   * @param {number} index The integer index of the bit.
   * @returns {boolean} The value of the bit.
   * @private
   */
  getBit(e, i) {
    if (i < 0 || i >= e.lengthBits)
      throw new Error("Bit index out of bounds.");
    if (e.constant !== void 0)
      return e.constant;
    const t = i >> 3, r = i % 8;
    return (new Uint8Array(e.bitstream)[t] >> r & 1) === 1;
  }
  /**
   * //TODO Adapt for Sphere
   * To maintain numerical stability during this subdivision process,
   * the actual bounding volumes should not be computed progressively by subdividing a non-root tile volume.
   * Instead, the exact bounding volumes are computed directly for a given level.
   * @param {Object | SubtreeTile} tile
   * @return {Object} object containing the bounding volume.
   */
  getTileBoundingVolume(e) {
    const i = {};
    if (this.rootTile.boundingVolume.region) {
      const t = [...this.rootTile.boundingVolume.region], r = t[0], s = t[2], n = t[1], o = t[3], l = (s - r) / Math.pow(2, e.__level), a = (o - n) / Math.pow(2, e.__level);
      t[0] = r + l * e.__x, t[2] = r + l * (e.__x + 1), t[1] = n + a * e.__y, t[3] = n + a * (e.__y + 1);
      for (let c = 0; c < 4; c++) {
        const u = t[c];
        u < -Math.PI ? t[c] += 2 * Math.PI : u > Math.PI && (t[c] -= 2 * Math.PI);
      }
      if (_(e)) {
        const c = t[4], f = (t[5] - c) / Math.pow(2, e.__level);
        t[4] = c + f * e.__z, t[5] = c + f * (e.__z + 1);
      }
      i.region = t;
    }
    if (this.rootTile.boundingVolume.box) {
      const t = [...this.rootTile.boundingVolume.box], r = 2 ** e.__level - 1, s = Math.pow(2, -e.__level), n = _(e) ? 3 : 2;
      for (let o = 0; o < n; o++) {
        t[3 + o * 3 + 0] *= s, t[3 + o * 3 + 1] *= s, t[3 + o * 3 + 2] *= s;
        const l = t[3 + o * 3 + 0], a = t[3 + o * 3 + 1], c = t[3 + o * 3 + 2], u = o === 0 ? e.__x : o === 1 ? e.__y : e.__z;
        t[0] += 2 * l * (-0.5 * r + u), t[1] += 2 * a * (-0.5 * r + u), t[2] += 2 * c * (-0.5 * r + u);
      }
      i.box = t;
    }
    return i;
  }
  /**
   * Each child’s geometricError is half of its parent’s geometricError.
   * @param {Object | SubtreeTile} tile
   * @return {number}
   */
  getGeometricError(e) {
    return this.rootTile.geometricError / Math.pow(2, e.__level);
  }
  /**
   * Determine what child subtrees exist and return a list of information.
   *
   * @param {Object} subtree The subtree for looking up availability.
   * @param {Array} bottomRow The bottom row of tiles in a transcoded subtree.
   * @returns {[]} A list of identifiers for the child subtrees.
   * @private
   */
  listChildSubtrees(e, i) {
    const t = [], r = d(this.rootTile);
    for (let s = 0; s < i.length; s++) {
      const n = i[s];
      if (n !== void 0)
        for (let o = 0; o < r; o++) {
          const l = s * r + o;
          this.getBit(e._childSubtreeAvailability, l) && t.push({
            tile: n,
            childMortonIndex: l
          });
        }
    }
    return t;
  }
  /**
   * Replaces placeholder tokens in a URI template with the corresponding tile properties.
   *
   * The URI template should contain the tokens:
   * - `{level}` for the tile's subdivision level.
   * - `{x}` for the tile's x-coordinate.
   * - `{y}` for the tile's y-coordinate.
   * - `{z}` for the tile's z-coordinate.
   *
   * @param {Object} tile - The tile object containing properties __level, __x, __y, and __z.
   * @param {string} uri - The URI template string with placeholders.
   * @returns {string} The URI with placeholders replaced by the tile's properties.
   */
  parseImplicitURI(e, i) {
    return i = i.replace("{level}", e.__level), i = i.replace("{x}", e.__x), i = i.replace("{y}", e.__y), i = i.replace("{z}", e.__z), i;
  }
  /**
   * Generates the full external buffer URI for a tile by combining an implicit URI with a buffer URI.
   *
   * First, it parses the implicit URI using the tile properties and the provided template. Then, it creates a new URL
   * relative to the tile's base path, removes the last path segment, and appends the buffer URI.
   *
   * @param {Object} tile - The tile object that contains properties:
   *   - __level: the subdivision level,
   *   - __x, __y, __z: the tile coordinates,
   * @param {string} uri - The URI template string with placeholders for the tile (e.g., `{level}`, `{x}`, `{y}`, `{z}`).
   * @param {string} bufUri - The buffer file name to append (e.g., "0_1.bin").
   * @returns {string} The full external buffer URI.
   */
  parseImplicitURIBuffer(e, i, t) {
    const r = this.parseImplicitURI(e, i), s = new URL(r, this.workingPath + "/");
    return s.pathname = s.pathname.substring(0, s.pathname.lastIndexOf("/")), new URL(s.pathname + "/" + t, this.workingPath + "/").toString();
  }
}
class x {
  constructor() {
    this.name = "IMPLICIT_TILING_PLUGIN";
  }
  init(e) {
    this.tiles = e;
  }
  preprocessNode(e, i, t) {
    var r;
    e.implicitTiling ? (e.__hasUnrenderableContent = !0, e.__hasRenderableContent = !1, e.__subtreeIdx = 0, e.__implicitRoot = e, e.__x = 0, e.__y = 0, e.__z = 0, e.__level = 0) : /.subtree$/i.test((r = e.content) == null ? void 0 : r.uri) && (e.__hasUnrenderableContent = !0, e.__hasRenderableContent = !1);
  }
  parseTile(e, i, t) {
    if (/^subtree$/i.test(t)) {
      const r = new A(i);
      return r.workingPath = i.__basePath, r.fetchOptions = this.tiles.fetchOptions, r.parse(e);
    }
  }
  preprocessURL(e, i) {
    if (i && i.implicitTiling) {
      const t = i.implicitTiling.subtrees.uri.replace("{level}", i.__level).replace("{x}", i.__x).replace("{y}", i.__y).replace("{z}", i.__z);
      return new URL(t, i.__basePath + "/").toString();
    }
    return e;
  }
  disposeTile(e) {
    var i;
    /.subtree$/i.test((i = e.content) == null ? void 0 : i.uri) && (e.children.forEach((t) => {
      this.tiles.processNodeQueue.remove(t);
    }), e.children.length = 0, e.__childrenProcessed = 0);
  }
}
class T {
  constructor() {
    this.name = "ENFORCE_NONZERO_ERROR", this.priority = -1 / 0, this.originalError = /* @__PURE__ */ new Map();
  }
  preprocessNode(e) {
    if (e.geometricError === 0) {
      let i = e.parent, t = 1, r = -1, s = 1 / 0;
      for (; i !== null; )
        i.geometricError !== 0 && i.geometricError < s && (s = i.geometricError, r = t), i = i.parent, t++;
      r !== -1 && (e.geometricError = s * 2 ** -t);
    }
  }
}
export {
  E as CesiumIonAuth,
  T as EnforceNonZeroErrorPlugin,
  R as GoogleCloudAuth,
  x as ImplicitTilingPlugin,
  N as QuantizedMeshLoaderBase,
  U as zigZagDecode
};
//# sourceMappingURL=index.core-plugins.js.map
