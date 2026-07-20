// Minimal react-dom shim: the SDK ships no ReactDOM. React Flow imports
// createPortal only for features we do not use (EdgeLabelRenderer,
// NodeToolbar, ViewportPortal) — the import must exist but must never be called.
module.exports = {
  createPortal: function () {
    throw new Error("fruvisi: createPortal is not available in the plugin context (avoid portal features)");
  },
  flushSync: function (fn) { return typeof fn === "function" ? fn() : undefined; },
  unstable_batchedUpdates: function (fn) { return typeof fn === "function" ? fn() : undefined; },
  version: window.__HERMES_PLUGIN_SDK__.React.version,
};
