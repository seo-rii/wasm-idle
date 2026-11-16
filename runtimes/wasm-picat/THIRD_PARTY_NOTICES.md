# Picat official browser snapshot

The runtime assets are obtained unchanged from https://picat-lang.org/playground/
and pinned by SHA-256, apart from appending an ES-module export to the loader.
The upstream bundle reports experimental Picat based on 3.9#12. Its exact producer
revision is unrecorded. The source and notices are published at
https://github.com/picat-lang/Picat and https://picat-lang.org/download.html.

Picat is copyright picat-lang.org and its C files are under MPL-2.0 (see LICENSE).
The bundled SAT solver is Kissat (MIT): https://github.com/arminbiere/kissat .
The source notices are retained locally in `NOTICE.KISSAT`, `NOTICE.ESPRESSO`
and `COPYING.FANN` and copied into the delivered bundle. These notices were obtained
from the public Picat source revision 13b573cceb5c6fcddb4f5d1adacc1c66b89629de;
this is a notice-source pin, not a claim that the deployed bundle was built from it.
Those components retain their original license terms. This consumer does not
relicense them under wasm-idle's MIT license.
