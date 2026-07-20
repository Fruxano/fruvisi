// Adapter: automatic JSX runtime -> React.createElement of the SDK React instance.
var React = window.__HERMES_PLUGIN_SDK__.React;

function jsxAdapter(type, props, key) {
  props = props || {};
  var children = props.children;
  var rest = {};
  for (var k in props) {
    if (k !== "children") rest[k] = props[k];
  }
  if (key !== undefined) rest.key = key;
  if (children === undefined) return React.createElement(type, rest);
  if (Array.isArray(children)) return React.createElement.apply(React, [type, rest].concat(children));
  return React.createElement(type, rest, children);
}

module.exports = {
  Fragment: React.Fragment,
  jsx: jsxAdapter,
  jsxs: jsxAdapter,
  jsxDEV: function (type, props, key) { return jsxAdapter(type, props, key); },
};
