# tfjs WASM backend binaries

Fallback compute engine for the Tape tool's transcriber (see
components/tape/decode.js). Some mobile GPUs miscompute the Basic Pitch
net in WebGL while advertising full float32 support; when the load-time
canary catches that, tfjs switches to these WebAssembly kernels.

Copied verbatim from `@tensorflow/tfjs-backend-wasm` **3.21.0** (Apache-2.0),
which must stay the exact version of the installed `@tensorflow/tfjs`
core (a transitive dependency of `@spotify/basic-pitch`). If that version
ever changes, re-copy:

    cp node_modules/@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm \
       node_modules/@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-simd.wasm \
       public/tf-wasm/

The threaded-simd variant is deliberately not shipped: it needs site-wide
cross-origin-isolation headers, and the loader never requests it on a
non-isolated page.
