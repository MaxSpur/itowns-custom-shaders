import { t as te, L as se } from "./LoaderBase-CfTLVHyZ.js";
const V = "https://tile.googleapis.com/v1/createSession";
class oe {
  get isMapTilesSession() {
    return this.authURL === V;
  }
  constructor(o = {}) {
    const { apiToken: t, sessionOptions: e = null, autoRefreshToken: n = !1 } = o;
    this.apiToken = t, this.autoRefreshToken = n, this.authURL = V, this.sessionToken = null, this.sessionOptions = e, this._tokenRefreshPromise = null;
  }
  async fetch(o, t) {
    this.sessionToken === null && this.isMapTilesSession && this.refreshToken(t), await this._tokenRefreshPromise;
    const e = new URL(o);
    e.searchParams.set("key", this.apiToken), this.sessionToken && e.searchParams.set("session", this.sessionToken);
    let n = await fetch(e, t);
    return n.status >= 400 && n.status <= 499 && this.autoRefreshToken && (await this.refreshToken(t), this.sessionToken && e.searchParams.set("session", this.sessionToken), n = await fetch(e, t)), this.sessionToken === null && !this.isMapTilesSession ? n.json().then((T) => (this.sessionToken = q(T), T)) : n;
  }
  refreshToken(o) {
    if (this._tokenRefreshPromise === null) {
      const t = new URL(this.authURL);
      t.searchParams.set("key", this.apiToken);
      const e = { ...o };
      this.isMapTilesSession && (e.method = "POST", e.body = JSON.stringify(this.sessionOptions), e.headers = e.headers || {}, e.headers = {
        ...e.headers,
        "Content-Type": "application/json"
      }), this._tokenRefreshPromise = fetch(t, e).then((n) => {
        if (!n.ok)
          throw new Error(`GoogleCloudAuth: Failed to load data with error code ${n.status}`);
        return n.json();
      }).then((n) => (this.sessionToken = q(n), this._tokenRefreshPromise = null, n));
    }
    return this._tokenRefreshPromise;
  }
}
function q(i) {
  if ("session" in i)
    return i.session;
  {
    let o = null;
    const t = i.root;
    return te(t, (e) => {
      if (e.content && e.content.uri) {
        const [, n] = e.content.uri.split("?");
        return o = new URLSearchParams(n).get("session"), !0;
      }
      return !1;
    }), o;
  }
}
class re {
  constructor(o = {}) {
    const { apiToken: t, autoRefreshToken: e = !1 } = o;
    this.apiToken = t, this.autoRefreshToken = e, this.authURL = null, this._tokenRefreshPromise = null, this._bearerToken = null;
  }
  async fetch(o, t) {
    await this._tokenRefreshPromise;
    const e = { ...t };
    e.headers = e.headers || {}, e.headers = {
      ...e.headers,
      Authorization: this._bearerToken
    };
    const n = await fetch(o, e);
    return n.status >= 400 && n.status <= 499 && this.autoRefreshToken ? (await this.refreshToken(t), e.headers.Authorization = this._bearerToken, fetch(o, e)) : n;
  }
  refreshToken(o) {
    if (this._tokenRefreshPromise === null) {
      const t = new URL(this.authURL);
      t.searchParams.set("access_token", this.apiToken), this._tokenRefreshPromise = fetch(t, o).then((e) => {
        if (!e.ok)
          throw new Error(`CesiumIonAuthPlugin: Failed to load data with error code ${e.status}`);
        return e.json();
      }).then((e) => (this._bearerToken = `Bearer ${e.accessToken}`, this._tokenRefreshPromise = null, e));
    }
    return this._tokenRefreshPromise;
  }
}
function _(i) {
  return i >> 1 ^ -(i & 1);
}
class ie extends se {
  constructor(...o) {
    super(...o), this.fetchOptions.header = {
      Accept: "application/vnd.quantized-mesh,application/octet-stream;q=0.9"
    };
  }
  loadAsync(...o) {
    const { fetchOptions: t } = this;
    return t.header = t.header || {}, t.header.Accept = "application/vnd.quantized-mesh,application/octet-stream;q=0.9", t.header.Accept += ";extensions=octvertexnormals-watermask-metadata", super.loadAsync(...o);
  }
  parse(o) {
    let t = 0;
    const e = new DataView(o), n = () => {
      const s = e.getFloat64(t, !0);
      return t += 8, s;
    }, T = () => {
      const s = e.getFloat32(t, !0);
      return t += 4, s;
    }, l = () => {
      const s = e.getUint32(t, !0);
      return t += 4, s;
    }, N = () => {
      const s = e.getUint8(t);
      return t += 1, s;
    }, a = (s, r) => {
      const c = new r(o, t, s);
      return t += s * r.BYTES_PER_ELEMENT, c;
    }, j = {
      center: [n(), n(), n()],
      minHeight: T(),
      maxHeight: T(),
      sphereCenter: [n(), n(), n()],
      sphereRadius: n(),
      horizonOcclusionPoint: [n(), n(), n()]
    }, h = l(), G = a(h, Uint16Array), $ = a(h, Uint16Array), H = a(h, Uint16Array), m = new Float32Array(h), R = new Float32Array(h), L = new Float32Array(h);
    let x = 0, v = 0, S = 0;
    const P = 32767;
    for (let s = 0; s < h; ++s)
      x += _(G[s]), v += _($[s]), S += _(H[s]), m[s] = x / P, R[s] = v / P, L[s] = S / P;
    const M = h > 65536, p = M ? Uint32Array : Uint16Array;
    M ? t = Math.ceil(t / 4) * 4 : t = Math.ceil(t / 2) * 2;
    const J = l(), w = a(J * 3, p);
    let C = 0;
    for (var g = 0; g < w.length; ++g) {
      const s = w[g];
      w[g] = C - s, s === 0 && ++C;
    }
    const O = (s, r) => R[r] - R[s], Q = (s, r) => -O(s, r), b = (s, r) => m[s] - m[r], X = (s, r) => -b(s, r), Z = l(), z = a(Z, p);
    z.sort(O);
    const Y = l(), B = a(Y, p);
    B.sort(b);
    const K = l(), F = a(K, p);
    F.sort(Q);
    const W = l(), I = a(W, p);
    I.sort(X);
    const ee = {
      westIndices: z,
      southIndices: B,
      eastIndices: F,
      northIndices: I
    }, A = {};
    for (; t < e.byteLength; ) {
      const s = N(), r = l();
      if (s === 1) {
        const c = a(h * 2, Uint8Array), f = new Float32Array(h * 3);
        for (let u = 0; u < h; u++) {
          let k = c[2 * u + 0] / 255 * 2 - 1, d = c[2 * u + 1] / 255 * 2 - 1;
          const y = 1 - (Math.abs(k) + Math.abs(d));
          if (y < 0) {
            const E = k;
            k = (1 - Math.abs(d)) * D(E), d = (1 - Math.abs(E)) * D(d);
          }
          const U = Math.sqrt(k * k + d * d + y * y);
          f[3 * u + 0] = k / U, f[3 * u + 1] = d / U, f[3 * u + 2] = y / U;
        }
        A.octvertexnormals = {
          extensionId: s,
          normals: f
        };
      } else if (s === 2) {
        const c = r === 1 ? 1 : 256, f = a(c * c, Uint8Array);
        A.watermask = {
          extensionId: s,
          mask: f,
          size: c
        };
      } else if (s === 4) {
        const c = l(), f = a(c, Uint8Array), u = new TextDecoder().decode(f);
        A.metadata = {
          extensionId: s,
          json: JSON.parse(u)
        };
      }
    }
    return {
      header: j,
      indices: w,
      vertexData: {
        u: m,
        v: R,
        height: L
      },
      edgeIndices: ee,
      extensions: A
    };
  }
}
function D(i) {
  return i < 0 ? -1 : 1;
}
export {
  re as C,
  oe as G,
  ie as Q,
  _ as z
};
//# sourceMappingURL=QuantizedMeshLoaderBase-018lzCXI.js.map
