// Builds src/ into an IIFE bundle for the Hermes dashboard.
// React comes from window.__HERMES_PLUGIN_SDK__ at runtime (shims in src/shims/),
// so React is NOT bundled — only @xyflow/react, dagre and our own code.
import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const shim = (f) => path.join(root, "src", "shims", f);
const watch = process.argv.includes("--watch");

const options = {
  entryPoints: [path.join(root, "src", "index.tsx")],
  bundle: true,
  format: "iife",
  target: "es2020",
  outfile: path.join(root, "plugin", "dashboard", "dist", "index.js"),
  jsx: "automatic",
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
  alias: {
    "react": shim("react.cjs"),
    "react/jsx-runtime": shim("jsx-runtime.cjs"),
    "react/jsx-dev-runtime": shim("jsx-runtime.cjs"),
    "react-dom": shim("react-dom.cjs"),
    "react-dom/client": shim("react-dom.cjs"),
  },
  loader: { ".css": "empty" },
};

// CSS separately: concatenate the React Flow base styles and our own styles into one file.
function buildCss() {
  const parts = [
    fs.readFileSync(path.join(root, "node_modules", "@xyflow", "react", "dist", "style.css"), "utf8"),
    fs.readFileSync(path.join(root, "src", "style.css"), "utf8"),
  ];
  fs.writeFileSync(path.join(root, "plugin", "dashboard", "dist", "style.css"), parts.join("\n\n"));
  console.log("style.css written");
}

if (watch) {
  const ctx = await esbuild.context(options);
  buildCss();
  await ctx.watch();
  console.log("watch running — load UI changes via plugin rescan");
} else {
  await esbuild.build(options);
  buildCss();
}
