# Third-party notices

Docket's own code is under the MIT license in [LICENSE](LICENSE). The
files below come from other projects. They keep their own licenses, which
this file lists with each one's copyright lines.

## DejaVu fonts

- Files: `render/fonts/DejaVuSans.ttf`, `render/fonts/DejaVuSans-Bold.ttf`,
  `render/fonts/DejaVuSansMono.ttf`, `render/fonts/DejaVuSansMono-Bold.ttf`.
- Source: DejaVu fonts 2.37, unmodified.
  <https://github.com/dejavu-fonts/dejavu-fonts>
- Copyright (c) 2003 by Bitstream, Inc. All Rights Reserved. Bitstream Vera
  is a trademark of Bitstream, Inc.
- Copyright (c) 2006 by Tavmjong Bah. All Rights Reserved. (Arev glyphs in
  DejaVu Sans and DejaVu Sans Bold.)
- DejaVu changes are in public domain.
- License: the Bitstream Vera and Arev font licenses. Full text in
  [render/fonts/LICENSE](render/fonts/LICENSE).

## Bravura glyph bitmaps

- Files: the `GLYPHS_PACKED` bitmaps (G clef, sharp, flat, natural, breath
  mark) in `components/tape-renderer.js`.
- Source: rasterized from the Bravura font by
  `scripts/tape-glyphs/gen-glyphs.mjs`. The font file is not in this
  repository. <https://github.com/steinbergmedia/bravura>
- Copyright © 2019, Steinberg Media Technologies GmbH
  (http://www.steinberg.net/), with Reserved Font Name "Bravura".
- License: SIL Open Font License 1.1. Full text
  [below](#sil-open-font-license-11).

## Basic Pitch model

- Files: `public/basic-pitch/model.json`,
  `public/basic-pitch/group1-shard1of1.bin`.
- Source: the `model/` folder of `@spotify/basic-pitch` 1.0.1, unmodified.
  <https://github.com/spotify/basic-pitch-ts>
- Copyright 2022 Spotify AB.
- License: Apache License 2.0. Full text in
  [public/basic-pitch/LICENSE](public/basic-pitch/LICENSE).

## TensorFlow.js WebAssembly backend

- Files: `public/tf-wasm/tfjs-backend-wasm.wasm`,
  `public/tf-wasm/tfjs-backend-wasm-simd.wasm`.
- Source: the `dist/` folder of `@tensorflow/tfjs-backend-wasm` 3.21.0,
  unmodified. <https://github.com/tensorflow/tfjs>
- TensorFlow.js: Copyright 2022 Google LLC. All Rights Reserved. Apache
  License 2.0.
- The binaries include code from at least these other projects. The
  list may not be complete, since the binaries carry no symbol names.
  - XNNPACK (<https://github.com/google/XNNPACK>): Copyright (c)
    Facebook, Inc. and its affiliates. All rights reserved. Copyright
    2019 Google LLC. BSD 3-Clause License.
  - pthreadpool (<https://github.com/Maratyszcza/pthreadpool>):
    Copyright 2019 Google LLC. Copyright (c) 2017 Facebook Inc.
    Copyright (c) 2015-2017 Georgia Institute of Technology. BSD
    2-Clause License.
  - FXdiv (<https://github.com/Maratyszcza/FXdiv>): Copyright (c) 2017
    Facebook Inc. Copyright (c) 2016-2017 Marat Dukhan. MIT License.
  - FP16 (<https://github.com/Maratyszcza/FP16>): Copyright (c) 2017
    Facebook Inc. Copyright (c) 2017 Georgia Institute of Technology.
    Copyright 2019 Google LLC. MIT License.
  - Emscripten 3.1.23 (<https://github.com/emscripten-core/emscripten>),
    its runtime code and allocator: Copyright (c) 2010-2014 Emscripten
    authors. MIT License, or University of Illinois/NCSA Open Source
    License.
  - musl libc, as bundled in Emscripten: Copyright © 2005-2020 Rich
    Felker, et al. MIT License.
  - LLVM libc++, libc++abi and compiler-rt, as bundled in Emscripten:
    Apache License 2.0 with LLVM Exceptions, or the legacy University of
    Illinois/NCSA and MIT licenses.
- Full text of each license, and how the list was made, in
  [public/tf-wasm/LICENSE](public/tf-wasm/LICENSE) and
  [public/tf-wasm/README.md](public/tf-wasm/README.md).

## shadcn/ui helper

- Files: the `cn` helper in `components/utils.ts`.
- Source: added with the shadcn CLI.
  <https://github.com/shadcn-ui/ui>
- Copyright (c) 2023 shadcn.
- License: MIT. Full text [below](#mit-license-shadcnui).

## npm packages

Packages installed from npm are not part of this repository. Each keeps
its own license, including the ones built into the dashboard's browser
code. Among those, the Tape page loads TensorFlow.js (`@tensorflow/tfjs`,
Google LLC) and Basic Pitch (`@spotify/basic-pitch`, Spotify AB), both
under the Apache License 2.0.

## License texts

### SIL Open Font License 1.1

Bravura's `LICENSE.txt` (<https://github.com/steinbergmedia/bravura>) as
it read in July 2026, when the bitmaps were made.

```text
Copyright © 2019, Steinberg Media Technologies GmbH (http://www.steinberg.net/),
with Reserved Font Name "Bravura".

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL

-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION AND CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

### MIT License (shadcn/ui)

The `LICENSE.md` of <https://github.com/shadcn-ui/ui>.

```text
MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
