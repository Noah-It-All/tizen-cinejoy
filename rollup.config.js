import { string } from 'rollup-plugin-string';
import terser from '@rollup/plugin-terser';
import getBabelOutputPlugin from '@rollup/plugin-babel';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import json from '@rollup/plugin-json';

// Mirrors TizenTube's build: transpile down to Chrome 47 (Tizen 3.0, 2017+)
// so the injected script runs on old Samsung TVs.
export default {
    input: "src/userScript.js",
    output: { file: "dist/cinejoy.js", format: "iife" },
    plugins: [
        json(),
        string({
            include: "**/*.css",
        }),
        nodeResolve({
            browser: true,
            preferBuiltins: false,
        }),
        commonjs({
            include: [/node_modules/, /src/],
            transformMixedEsModules: true,
        }),
        getBabelOutputPlugin({
            babelHelpers: 'bundled',
            presets: [
                ['@babel/preset-env', {
                    targets: 'Chrome 47',
                }],
            ],
        }),
        terser({
            ecma: '5',
            mangle: true,
        }),
        replace({
            '\uFFFF': '\u0000',
        })
    ]
};
