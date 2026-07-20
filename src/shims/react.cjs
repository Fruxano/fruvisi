// React comes from the Hermes plugin SDK — never bundle it (a second React
// instance would break hooks in the host tree).
module.exports = window.__HERMES_PLUGIN_SDK__.React;
