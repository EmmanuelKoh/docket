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

`LICENSE` in this folder holds the licenses of the code the binaries
include, as far as it can be identified: TensorFlow.js (Apache-2.0),
XNNPACK and pthreadpool (BSD), FXdiv and FP16 (MIT), and Emscripten
3.1.23 with the musl and LLVM libraries it bundles. The binaries carry no
symbol names, so the list may not be complete. It was made on 2026-10-13
from:

- TensorFlow.js 3.21.0's `WORKSPACE` (the XNNPACK, pthreadpool, FXdiv
  and FP16 commits, and emsdk 3.1.23) and `tfjs-backend-wasm/src/cc/BUILD`
  (`-s MALLOC=emmalloc`).
- The `BUILD.bazel` files of XNNPACK and pthreadpool at those commits.
  Under Emscripten, XNNPACK links no cpuinfo and pthreadpool builds its
  single-thread shim. XNNPACK's convolution setup (`src/indirection.c`)
  uses FXdiv.
- The binaries. They export `malloc`, `free` and `__errno_location`,
  import Emscripten's `emscripten_resize_heap` and WASI's `fd_write`, and
  contain libc++'s "__next_prime overflow" and musl printf's "(null)".

FP16's notice is included although the only FP16 use found (in
`src/operators/convolution-nhwc.c`) is in an f16 operator, which
TensorFlow.js does not call. clog is an XNNPACK dependency too. Its
notice is left out because its log text is absent from the binaries.

After a re-copy, update `LICENSE` from the new version's sources, and
update `THIRD_PARTY_NOTICES.md` at the repo root.

The threaded-simd variant is deliberately not shipped: it needs site-wide
cross-origin-isolation headers, and the loader never requests it on a
non-isolated page.
