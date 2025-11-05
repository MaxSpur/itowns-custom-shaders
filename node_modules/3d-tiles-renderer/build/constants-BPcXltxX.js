class E {
  get unloadPriorityCallback() {
    return this._unloadPriorityCallback;
  }
  set unloadPriorityCallback(t) {
    t.length === 1 ? (console.warn('LRUCache: "unloadPriorityCallback" function has been changed to take two arguments.'), this._unloadPriorityCallback = (a, e) => {
      const s = t(a), n = t(e);
      return s < n ? -1 : s > n ? 1 : 0;
    }) : this._unloadPriorityCallback = t;
  }
  constructor() {
    this.minSize = 6e3, this.maxSize = 8e3, this.minBytesSize = 0.3 * 1073741824, this.maxBytesSize = 0.4 * 1073741824, this.unloadPercent = 0.05, this.autoMarkUnused = !0, this.itemSet = /* @__PURE__ */ new Map(), this.itemList = [], this.usedSet = /* @__PURE__ */ new Set(), this.callbacks = /* @__PURE__ */ new Map(), this.unloadingHandle = -1, this.cachedBytes = 0, this.bytesMap = /* @__PURE__ */ new Map(), this.loadedSet = /* @__PURE__ */ new Set(), this._unloadPriorityCallback = null;
    const t = this.itemSet;
    this.defaultPriorityCallback = (a) => t.get(a);
  }
  // Returns whether or not the cache has reached the maximum size
  isFull() {
    return this.itemSet.size >= this.maxSize || this.cachedBytes >= this.maxBytesSize;
  }
  getMemoryUsage(t) {
    return this.bytesMap.get(t) || 0;
  }
  setMemoryUsage(t, a) {
    const { bytesMap: e, itemSet: s } = this;
    s.has(t) && (this.cachedBytes -= e.get(t) || 0, e.set(t, a), this.cachedBytes += a);
  }
  add(t, a) {
    const e = this.itemSet;
    if (e.has(t) || this.isFull())
      return !1;
    const s = this.usedSet, n = this.itemList, l = this.callbacks;
    return n.push(t), s.add(t), e.set(t, Date.now()), l.set(t, a), !0;
  }
  has(t) {
    return this.itemSet.has(t);
  }
  remove(t) {
    const a = this.usedSet, e = this.itemSet, s = this.itemList, n = this.bytesMap, l = this.callbacks, c = this.loadedSet;
    if (e.has(t)) {
      this.cachedBytes -= n.get(t) || 0, n.delete(t), l.get(t)(t);
      const d = s.indexOf(t);
      return s.splice(d, 1), a.delete(t), e.delete(t), l.delete(t), c.delete(t), !0;
    }
    return !1;
  }
  // Marks whether tiles in the cache have been completely loaded or not. Tiles that have not been completely
  // loaded are subject to being disposed early if the cache is full above its max size limits, even if they
  // are marked as used.
  setLoaded(t, a) {
    const { itemSet: e, loadedSet: s } = this;
    e.has(t) && (a === !0 ? s.add(t) : s.delete(t));
  }
  markUsed(t) {
    const a = this.itemSet, e = this.usedSet;
    a.has(t) && !e.has(t) && (a.set(t, Date.now()), e.add(t));
  }
  markUnused(t) {
    this.usedSet.delete(t);
  }
  markAllUnused() {
    this.usedSet.clear();
  }
  // TODO: this should be renamed because it's not necessarily unloading all unused content
  // Maybe call it "cleanup" or "unloadToMinSize"
  unloadUnusedContent() {
    const {
      unloadPercent: t,
      minSize: a,
      maxSize: e,
      itemList: s,
      itemSet: n,
      usedSet: l,
      loadedSet: c,
      callbacks: d,
      bytesMap: u,
      minBytesSize: h,
      maxBytesSize: m
    } = this, y = s.length - l.size, g = s.length - c.size, S = Math.max(Math.min(s.length - a, y), 0), k = this.cachedBytes - h, C = this.unloadPriorityCallback || this.defaultPriorityCallback;
    let f = !1;
    const M = S > 0 && y > 0 || g && s.length > e;
    if (y && this.cachedBytes > h || g && this.cachedBytes > m || M) {
      s.sort((i, r) => {
        const p = l.has(i), L = l.has(r);
        if (p === L) {
          const U = c.has(i), T = c.has(r);
          return U === T ? -C(i, r) : U ? 1 : -1;
        } else
          return p ? 1 : -1;
      });
      const P = Math.max(a * t, S * t), B = Math.ceil(Math.min(P, y, S)), A = Math.max(t * k, t * h), w = Math.min(A, k);
      let o = 0, b = 0;
      for (; this.cachedBytes - b > m || s.length - o > e; ) {
        const i = s[o], r = u.get(i) || 0;
        if (l.has(i) && c.has(i) || this.cachedBytes - b - r < m && s.length - o <= e)
          break;
        b += r, o++;
      }
      for (; b < w || o < B; ) {
        const i = s[o], r = u.get(i) || 0;
        if (l.has(i) || this.cachedBytes - b - r < h && o >= B)
          break;
        b += r, o++;
      }
      s.splice(0, o).forEach((i) => {
        this.cachedBytes -= u.get(i) || 0, d.get(i)(i), u.delete(i), n.delete(i), d.delete(i), c.delete(i), l.delete(i);
      }), f = o < S || b < k && o < y, f = f && o > 0;
    }
    f && (this.unloadingHandle = requestAnimationFrame(() => this.scheduleUnload()));
  }
  scheduleUnload() {
    cancelAnimationFrame(this.unloadingHandle), this.scheduled || (this.scheduled = !0, queueMicrotask(() => {
      this.scheduled = !1, this.unloadUnusedContent();
    }));
  }
}
class G {
  // returns whether tasks are queued or actively running
  get running() {
    return this.items.length !== 0 || this.currJobs !== 0;
  }
  constructor() {
    this.maxJobs = 6, this.items = [], this.callbacks = /* @__PURE__ */ new Map(), this.currJobs = 0, this.scheduled = !1, this.autoUpdate = !0, this.priorityCallback = null, this.schedulingCallback = (t) => {
      requestAnimationFrame(t);
    }, this._runjobs = () => {
      this.scheduled = !1, this.tryRunJobs();
    };
  }
  sort() {
    const t = this.priorityCallback, a = this.items;
    t !== null && a.sort(t);
  }
  has(t) {
    return this.callbacks.has(t);
  }
  add(t, a) {
    const e = {
      callback: a,
      reject: null,
      resolve: null,
      promise: null
    };
    return e.promise = new Promise((s, n) => {
      const l = this.items, c = this.callbacks;
      e.resolve = s, e.reject = n, l.unshift(t), c.set(t, e), this.autoUpdate && this.scheduleJobRun();
    }), e.promise;
  }
  remove(t) {
    const a = this.items, e = this.callbacks, s = a.indexOf(t);
    if (s !== -1) {
      const n = e.get(t);
      n.promise.catch(() => {
      }), n.reject(new Error("PriorityQueue: Item removed.")), a.splice(s, 1), e.delete(t);
    }
  }
  removeByFilter(t) {
    const { items: a } = this;
    for (let e = 0; e < a.length; e++) {
      const s = a[e];
      t(s) && this.remove(s);
    }
  }
  tryRunJobs() {
    this.sort();
    const t = this.items, a = this.callbacks, e = this.maxJobs;
    let s = 0;
    const n = () => {
      this.currJobs--, this.autoUpdate && this.scheduleJobRun();
    };
    for (; e > this.currJobs && t.length > 0 && s < e; ) {
      this.currJobs++, s++;
      const l = t.pop(), { callback: c, resolve: d, reject: u } = a.get(l);
      a.delete(l);
      let h;
      try {
        h = c(l);
      } catch (m) {
        u(m), n();
      }
      h instanceof Promise ? h.then(d).catch(u).finally(n) : (d(h), n());
    }
  }
  scheduleJobRun() {
    this.scheduled || (this.schedulingCallback(this._runjobs), this.scheduled = !0);
  }
}
const J = -1, v = 0, _ = 1, I = 2, R = 3, D = 6378137, F = 1 / 298.257223563, N = 6356752314245179e-9;
export {
  J as F,
  E as L,
  G as P,
  v as U,
  D as W,
  _ as a,
  I as b,
  R as c,
  F as d,
  N as e
};
//# sourceMappingURL=constants-BPcXltxX.js.map
