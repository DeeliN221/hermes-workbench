# Third-party notices

Workbench project code is distributed under AGPL-3.0-only; see LICENSE.
Dependencies and any retained third-party notices remain under their original licenses.

The optional Hermes compatibility patch in `integrations/hermes` is distributed
under MIT. Its upstream notice is retained in `integrations/hermes/LICENSE-Hermes.txt`.

The browser bundle uses CodeMirror (MIT), xterm.js (MIT), Pele (MIT),
micromark (MIT) and micromark-extension-gfm (MIT). Transitive dependencies
are recorded in pnpm-lock.yaml. Hermes supplies React through its plugin SDK;
Workbench must not bundle another React runtime.

The themes are Minecraft-inspired. This project is not an official Minecraft
product and is not affiliated with Mojang or Microsoft. Icons are code-defined.

PlantUML 1.2026.8 (GPL-3.0-or-later) is shipped as a separate, lazy browser
module under dashboard/vendor/plantuml. Its upstream release URL and hashes
are recorded in upstream.json; the license is LICENSE-PlantUML.txt.
Viz.js 3.24.0 includes Graphviz, Expat and Emscripten; their notices are
preserved in the header of viz-global.js.
