import esbuild from "esbuild";
import { sassPlugin, postcssModules } from "esbuild-sass-plugin";
import builtins from "builtin-modules";
import postcss from "postcss";
import prefixer from "postcss-prefix-selector";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const production = process.argv[2] === "production";

const shim = (f) => path.join(__dirname, "src", "shim", f);

const SCOPE = ".pile-app-root";

/** Prefix Pile's global CSS selectors so nothing leaks into Obsidian. */
async function scopeGlobalCss(css) {
  const out = await postcss([
    prefixer({
      prefix: SCOPE,
      transform(prefix, selector, prefixed) {
        if (selector === "html" || selector === ":root" || selector === "body")
          return prefix;
        if (/^(body|html)\b/.test(selector))
          return selector.replace(/^(body|html)/, prefix);
        return prefixed;
      },
    }),
  ]).process(css, { from: undefined });
  return out.css;
}

/** Rewrite @media (prefers-color-scheme: dark) blocks into .is-dark-gated
 *  rules, so dark mode follows Obsidian's theme setting (the view toggles
 *  .is-dark on the app root) instead of the OS. */
async function classGateDarkMode(css) {
  const result = await postcss([
    {
      postcssPlugin: "pile-dark-class",
      AtRule: {
        media(atRule) {
          if (!/prefers-color-scheme:\s*dark/.test(atRule.params)) return;
          atRule.walkRules((rule) => {
            rule.selectors = rule.selectors.map((sel) =>
              sel.startsWith(SCOPE)
                ? sel.replace(SCOPE, `${SCOPE}.is-dark`)
                : `${SCOPE}.is-dark ${sel}`
            );
          });
          atRule.replaceWith(atRule.nodes);
        },
      },
    },
  ]).process(css, { from: undefined });
  return result.css;
}

/** Appended last so it wins the cascade: fit Pile into Obsidian's pane.
 *  Root clips; inner areas (timeline/editor) scroll, matching Pile's original
 *  body{overflow:hidden}. contain:paint scopes Pile's position:fixed children
 *  (sidebar, background) to the pane instead of the whole window. */
const CONTAINMENT_CSS = `
${SCOPE}{position:relative!important;width:100%!important;height:100%!important;overflow:hidden!important;contain:layout paint style;border-radius:10px;corner-shape:superellipse(2.4);}
${SCOPE}>.pile-host{width:100%!important;height:100%!important;}
${SCOPE}>.pile-host>div{width:100%!important;height:100%!important;}
${SCOPE}>.pile-host>div>div{height:100%!important;display:flex!important;flex-direction:column!important;background:var(--bg);}
${SCOPE}>.pile-host>div>div>div:nth-child(2){flex:1 1 auto!important;min-height:0!important;height:auto!important;}
`;

/** Resolve Pile's Electron imports to our in-process shims. */
const rendererRoot = path.join(__dirname, "src", "vendor", "renderer");
const EXTS = [".tsx", ".ts", ".jsx", ".js", ".json", ".scss", ".css", ".png"];

/** Probe a base path for a real file (extension + directory-index). */
function resolveFile(base) {
  try {
    if (fs.statSync(base).isFile()) return base;
  } catch {}
  for (const e of EXTS) if (fs.existsSync(base + e)) return base + e;
  for (const e of EXTS) {
    const idx = path.join(base, "index" + e);
    if (fs.existsSync(idx)) return idx;
  }
  return base;
}

const aliasPlugin = {
  name: "pile-aliases",
  setup(build) {
    // Pile uses webpack-style absolute imports rooted at src/ (e.g.
    // "renderer/icons", "renderer/context/TagsContext").
    build.onResolve({ filter: /^renderer(\/|$)/ }, (args) => {
      const rest = args.path.replace(/^renderer\/?/, "");
      const base = rest ? path.join(rendererRoot, rest) : rendererRoot;
      return { path: resolveFile(base) };
    });
    build.onResolve({ filter: /^electron$/ }, () => ({
      path: shim("electron.ts"),
    }));
    build.onResolve({ filter: /^electron-settings$/ }, () => ({
      path: shim("electron-settings.ts"),
    }));
    // Main-process-only modules we never invoke — stub to empty.
    build.onResolve(
      { filter: /^(electron-updater|electron-log)$/ },
      () => ({ path: shim("empty.ts") })
    );
  },
};

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  outfile: "main.js",
  format: "cjs",
  platform: "node",
  target: "es2020",
  jsx: "automatic",
  sourcemap: production ? false : "inline",
  minify: production,
  treeShaking: true,
  logLevel: "info",
  external: ["obsidian", ...builtins],
  define: {
    "process.env.NODE_ENV": production ? '"production"' : '"development"',
  },
  loader: {
    ".js": "jsx",
    ".png": "dataurl",
    ".jpg": "dataurl",
    ".jpeg": "dataurl",
    ".gif": "dataurl",
    ".svg": "dataurl",
    ".woff": "dataurl",
    ".woff2": "dataurl",
    ".ttf": "dataurl",
    ".eot": "dataurl",
  },
  plugins: [
    aliasPlugin,
    // CSS-module SCSS → scoped class map (JS) + CSS into the bundle.
    // (module classes are hashed, so no leakage; no prefixing needed.)
    sassPlugin({
      filter: /\.module\.scss$/,
      transform: postcssModules({}),
    }),
    // Global SCSS → prefix every selector under .pile-app-root, into bundle.
    sassPlugin({
      filter: /\.scss$/,
      transform: (css) => scopeGlobalCss(css),
    }),
    // esbuild emits <entry>.css (main.css); Obsidian auto-loads styles.css.
    {
      name: "css-to-styles",
      setup(build) {
        build.onEnd(async () => {
          const from = path.join(__dirname, "main.css");
          const to = path.join(__dirname, "styles.css");
          if (fs.existsSync(from)) {
            // Pile assumes a full Electron window; inside a pane, treat the
            // viewport as 100% of our container.
            let css = fs.readFileSync(from, "utf8");
            css = css.replace(/100vw/g, "100%").replace(/100vh/g, "100%");
            css = await classGateDarkMode(css);
            css += CONTAINMENT_CSS;
            fs.writeFileSync(to, css);
            fs.unlinkSync(from);
          }
        });
      },
    },
  ],
});

if (production) {
  await ctx.rebuild();
  await ctx.dispose();
} else {
  await ctx.watch();
  console.log("[pile] watching…");
}
