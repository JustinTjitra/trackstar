# Code-CAD, automated verification and 3D-printed enclosure/mount design for a DDJ-FLX2 / DDJ-FLX4 display add-on

Research date: 2026-11-20. Scope: CAD tool choice, headless scripting/export/checks, design-for-FDM rules, controller dimensions and mounting.

Conventions used in these notes:
- "Tested here" = I ran it in this session's container (Ubuntu 24.04.5, Python 3.13.18, Node 22.23.4, no GPU). The link next to it is the package page for the tool tested. Scratch files are in `/tmp/claude-0/-home-user-trackstar/a9b90b71-75b0-571a-a38e-1295c2f04ea5/scratchpad/cadtest/` (temporary).
- "(bk)" = background knowledge that I did not re-verify against a source in this session. Treat as likely-true but unconfirmed.
- Network caveat: WebFetch could not resolve many hosts from this environment (pioneerdj.com, docs.pioneerdj.com, alphatheta.com, support.serato.com, virtualdj.com, cnckitchen.com, arxiv.org, cdn.teufelaudio.com, buildcad.ai, grandpacad.com, forgent3d.com). For those, findings come from search-result summaries of the page, not from a full read. github.com and pypi.org were reachable and read directly. If the writer needs primary confirmation, those hosts would have to be allowed in the session's network settings.

## 1. Code-CAD tools: which one should an AI agent drive headlessly?

### Takeaway
For this project the best fit is a Python library on the OpenCascade (OCCT) B-rep kernel: **build123d 0.13.0** (first choice) or **CadQuery 2.8.0**. Both pip-install cleanly on headless Linux with Python 3.11-3.14, export STEP/STL/3MF, do real fillets/chamfers/shells, and let the agent measure and test geometry in the same Python process. OpenSCAD is the simplest language for an LLM but has no STEP export, no native fillets, and its last stable release is still 2021.01.

### Cited Findings

Versions, licences and install status (all read from the package registries on 2026-11-20):
- build123d 0.13.0, released 2026-09-21, requires Python >=3.11,<3.15, Apache-2.0 — [PyPI build123d](https://pypi.org/project/build123d/)
- build123d is "derived from portions of CadQuery, but is extensively refactored and restructured into an independent framework over Open Cascade"; install is `pip install build123d`; README badges list Python 3.11-3.14; 3.8k GitHub stars — [gumyr/build123d](https://github.com/gumyr/build123d)
- CadQuery 2.8.0, released 2026-06-21, requires Python >=3.11, Apache 2.0 — [PyPI cadquery](https://pypi.org/project/cadquery/)
- The OCCT Python bindings both libraries use: cadquery-ocp 8.0.1.1.0 (2026-10-05), Python >=3.11,<3.15, Apache-2.0; a `cadquery-ocp-novtk` variant of the same version exists — [PyPI cadquery-ocp](https://pypi.org/project/cadquery-ocp/), [PyPI cadquery-ocp-novtk](https://pypi.org/project/cadquery-ocp-novtk/)
- SolidPython2 2.1.3, released 2025-08-16 (no release for 15 months), Python >=3.7, LGPL-2.1 — [PyPI solidpython2](https://pypi.org/project/solidpython2/)
- Zoo Python SDK `kittycad` 1.13.0, released 2026-11-20, Python >=3.11 — [PyPI kittycad](https://pypi.org/project/kittycad/)
- manifold3d (Python bindings for the Manifold mesh-CSG kernel) 3.5.5, released 2026-11-13 — [PyPI manifold3d](https://pypi.org/project/manifold3d/)
- JSCAD: `@jscad/modeling` 2.13.0 and `@jscad/cli` 2.3.8, both published 2026-02-22, MIT — [npm @jscad/modeling](https://www.npmjs.com/package/@jscad/modeling), [npm @jscad/cli](https://www.npmjs.com/package/@jscad/cli)
- Replicad 1.2.1, published 2026-11-06, MIT; its kernel package `replicad-opencascadejs` 1.2.1 is LGPL-2.1-only — [npm replicad](https://www.npmjs.com/package/replicad), [npm replicad-opencascadejs](https://www.npmjs.com/package/replicad-opencascadejs)
- Replicad's engine is OpenCascade compiled to WebAssembly; it exports STL or STEP and is "intended to be integrated into web applications"; its docs show filleted shapes — [npm replicad](https://npmjs.org/package/replicad)
- OpenSCAD: latest stable is still 2021.01 (a January 2026 mailing-list thread notes the website still lists 2021.01 as latest stable). Manifold stopped being experimental in snapshots from 2024.09.28 and was later made the default backend for development snapshots — [OpenSCAD mailing list](https://lists.openscad.org/empathy/thread/KB6GS2JJ7H6A3FGAB7UWRFJLOOERD663), [openscad.org news](https://openscad.org/news.html)
- OpenSCAD repo: 10.7k stars; README documents headless WebAssembly builds (browser, standalone Node.js, Node module) and shows `--backend=manifold` being passed in the Node example — [openscad/openscad](https://github.com/openscad/openscad)
- An `openscad-wasm` npm package exists (0.0.4, 2025-07-18, GPL-2.0) — [npm openscad-wasm](https://www.npmjs.com/package/openscad-wasm)
- Ubuntu 24.04 apt ships OpenSCAD 2021.01-6build4 (no Manifold). Tested here: `apt-get install openscad` gave "OpenSCAD version 2021.01" — [Ubuntu package openscad](https://packages.ubuntu.com/noble/openscad)
- FreeCAD 1.1 was released 24 March 2026; 1.1.1 on 14 April 2026; 1.1.2 (bug-fix only) on 23 July 2026 — [FreeCAD blog 1.1](https://blog.freecad.org/2026/03/25/freecad-version-1-1-released/), [FreeCAD blog 1.1.2](https://blog.freecad.org/2026/07/23/freecad-1-1-2-released/)
- FreeCAD is moving to CalVer and three releases a year; the release formerly called 1.2 is named 26.3 and was listed as a preview release — [FreeCAD release notes 1.2](https://wiki.freecad.org/Release_notes_1.2), [Wikipedia FreeCAD](https://en.wikipedia.org/wiki/FreeCAD)
- FreeCAD headless: launched with `FreeCAD -c` or `FreeCADCmd`; `FreeCADCmd script.py` runs and exits; "API usage that directly accesses or manipulates GUI components is very limited and generally not supported in a headless context" — [FreeCAD wiki: Headless FreeCAD](https://wiki.freecad.org/Headless_FreeCAD)
- Tested here: `apt-cache policy freecad` on Ubuntu 24.04 returned "Candidate: (none)", so FreeCAD is not a plain `apt install` on this base image (needs AppImage/conda/snap/PPA) — [FreeCAD-Bundle releases](https://github.com/FreeCAD/FreeCAD-Bundle/releases)
- ImplicitCAD: Haskell plus an OpenSCAD-like "extopenscad" language; AGPL-3.0; 1.6k stars; README points to 0.4.1.0 on Hackage as the latest release; outputs STL/OBJ/PNG (3D) and SVG/DXF/PNG (2D); no STEP; rounded unions (`union(r=14)`) are a core feature; install via `cabal install implicit` (needs GHC) — [Haskell-Things/ImplicitCAD](https://github.com/Haskell-Things/ImplicitCAD)
- JSCAD is mesh/CSG based; a discussion in the JSCAD repository reported cutting a 256-segment sphere from a cube took 35 s in JSCAD versus 0.07 s in Manifold, and that JSCAD produced non-manifold 3MF — [jscad/OpenJSCAD.org discussion 1158](https://github.com/jscad/OpenJSCAD.org/discussions/1158)
- Zoo (KittyCAD): Zoo Design Studio desktop is free to download; the free plan includes 40 Text-to-CAD credits per month; KCL execution through Zoo's MCP server calls Zoo's cloud API (`https://api.zoo.dev`) and needs an account/API token — [zoo.dev Design Studio](https://zoo.dev/modeling-app), [KittyCAD/zoo-mcp](https://github.com/KittyCAD/zoo-mcp)
- Zoo API pricing is unclear: an older Zoo post says 20 free API minutes per month then $0.50/minute; a third-party listing says $10 free credit and $0.0083/second (the two are roughly consistent) — [Zoo blog: billing for Text-to-CAD](https://zoo.dev/blog/turning-on-billing-for-text-to-cad)

Tested here (what actually works on this machine):
- `pip install build123d trimesh manifold3d pytest` succeeded on Python 3.13.18 in under a minute and pulled build123d 0.13.0 + cadquery-ocp-novtk 8.0.1.1.0. So claims that OCP has "no wheels for Python 3.13+" (repeated by the flowful-ai cad-skill README and an older build123d-mcp page) are out of date — [PyPI build123d](https://pypi.org/project/build123d/), [flowful-ai/cad-skill](https://github.com/flowful-ai/cad-skill)
- A filleted, shelled 120x80x30 mm box with a port cut-out and a lipped lid built in 0.17 s and exported STEP (77 kB), STL and a two-part 3MF — [PyPI build123d](https://pypi.org/project/build123d/)
- `pip install cadquery` into the SAME virtualenv then broke build123d: CadQuery 2.8.0 pulled `cadquery-ocp 7.9.3.1.1`, which overwrote the shared `OCP` module from `cadquery-ocp-novtk 8.0.1.1.0`; build123d then failed with `ModuleNotFoundError: No module named 'OCP.OCP.collections'`. CadQuery itself still worked. A fresh venv with only build123d worked again — [PyPI cadquery](https://pypi.org/project/cadquery/), [PyPI cadquery-ocp-novtk](https://pypi.org/project/cadquery-ocp-novtk/)

What people report about LLM-generated CAD code:
- CADGenBench (Hugging Face): tool-agnostic benchmark (submit one STEP per sample) with generation-from-drawing and STEP-editing tasks. Its reference baseline is an iterative agent that writes build123d Python, renders the STEP, reviews the renders and refines; it "defaults to build123d and can also target CadQuery". Metrics: validity (well-formed, watertight B-rep; failure zeroes the score), surface-distance F1 and volume IoU, interface match, topology (Betti numbers). It publishes no build123d-vs-CadQuery comparison — [huggingface/cadgenbench](https://github.com/huggingface/cadgenbench)
- build123d-mcp's own page claims that on the CADGenBench leaderboard (June 2026) driving the same model (GPT-5.5) through the MCP tool loop raised the score from 0.360 to 0.457 and CAD validity from 88% to 100%. This is self-reported by the tool author — [PyPI build123d-mcp](https://pypi.org/project/build123d-mcp/)
- CAD-Coder (Doris et al., MIT): an open-source vision-language model that outputs editable CadQuery code from an image; trained on GenCAD-Code (163k image/code pairs); reports a 100% valid-syntax rate and beats GPT-4.5 and Qwen2.5-VL-72B — [arXiv 2505.14646](https://arxiv.org/abs/2505.14646)
- CAD-Coder (Guan et al., NeurIPS 2025): reformulates text-to-CAD as CadQuery script generation with chain-of-thought and a geometric reward; dataset of 110K verified text/CadQuery/3D triplets plus 1.5K CoT samples — [arXiv 2505.19713](https://arxiv.org/html/2505.19713v3)
- "Text-to-CadQuery: A New Paradigm for CAD Generation with Scalable Large Model Capabilities" argues for generating CadQuery directly rather than command sequences — [arXiv 2505.06507](https://arxiv.org/html/2505.06507v1)
- BenchCAD: 17,900 execution-verified CadQuery programs across 106 industrial part families; finding that models often get the global part family right but miss local parametric details — [BenchCAD repo](https://github.com/BenchCAD/BenchCAD-main), [arXiv 2605.10865](https://arxiv.org/pdf/2605.10865)
- Text2CAD-Bench adopts CadQuery partly because generated code is immediately executable for validation; P3D-Bench compares four output formats (JSON, OpenSCAD, CadQuery, Three.js); MUSE checks executability of LLM CadQuery and then manufacturability/assemblability — [arXiv 2605.18430](https://arxiv.org/html/2605.18430v1), [arXiv 2606.11152](https://arxiv.org/html/2606.11152v2), [MUSE](https://www.alphaxiv.org/abs/2605.28579)
- Practitioner/vendor write-ups disagree. One finds build123d "the most balanced choice for mechanical parts" and OpenSCAD "the least effort for small printed parts", noting OpenSCAD "can certify broken parts as clean" — [grandpacad comparison](https://grandpacad.com/en/blog/openscad-vs-cadquery-vs-build123d)
- Another says simple prismatic work went to OpenSCAD while two parts that must mate went to CadQuery, and that LLMs write correct OpenSCAD more reliably than CadQuery for basic geometry — [modelrift: CadQuery vs OpenSCAD](https://modelrift.com/blog/cadquery-vs-openscad/), [getleo.ai open-source text-to-CAD](https://www.getleo.ai/blog/open-source-text-to-cad-tools-free)
- A third notes the contradiction explicitly: vendor blogs say OpenSCAD fails less, yet CADGenBench's leaders all use build123d; and build123d's younger API moves between versions, which trips models trained on older examples — [druckworks guide](https://druckworks.eu/guides/openscad-or-build123d-with-ai), [forgent3d: which CAD code should AI write](https://www.forgent3d.com/en/blog/ai-cad-languages)
- A Claude Code skill author chose CadQuery because it "sits on a real CAD kernel (OpenCASCADE) so fillets, chamfers, booleans, and shells actually work" — [flowful-ai/cad-skill](https://github.com/flowful-ai/cad-skill)

Comparison table (cells marked (bk) are background knowledge not re-verified this session):

| Tool | Language | Kernel | STEP export | STL / 3MF | Fillets / chamfers | Assemblies | Headless Linux install | Licence | Latest (Nov 2026) |
|---|---|---|---|---|---|---|---|---|---|
| build123d | Python | OCCT B-rep | Yes (tested) | Yes / Yes via `Mesher` (tested) | Kernel-exact (tested `fillet`, `offset` shell) | Joints + compounds (bk) | `pip install build123d` (tested, py3.13) | Apache-2.0 | 0.13.0 (2026-09-21) |
| CadQuery | Python | OCCT B-rep | Yes (tested) | Yes / Yes (bk for 3MF) | Kernel-exact (tested) | `cq.Assembly` with constraints (bk) | `pip install cadquery` (tested, py3.13) | Apache-2.0 | 2.8.0 (2026-06-21) |
| OpenSCAD (+Manifold, BOSL2) | OpenSCAD DSL | Mesh CSG (CGAL; Manifold in snapshots) | No (bk) | Yes / Yes | None native; via `minkowski`/`hull` or BOSL2 rounding (bk) | None formal; modules/includes (bk) | `apt install openscad` gives 2021.01 (tested); snapshots via AppImage (bk) | GPL-2.0 | Stable 2021.01; dev snapshots only since |
| FreeCAD Python API | Python | OCCT B-rep | Yes (bk) | Yes / Yes (bk) | Kernel-exact; fragile in scripted PartDesign (bk) | Built-in Assembly workbench since 1.0 (bk) | Not in Ubuntu 24.04 apt (tested); AppImage/conda | LGPL-2.1+ (bk) | 1.1.2 (2026-07-23); 26.3 pending |
| Zoo / KittyCAD (KCL) | KCL DSL; Python/TS SDKs | Proprietary cloud engine | Yes (bk) | Yes (bk) | Yes (bk) | Limited (bk) | `pip install kittycad`, but needs API token + network to api.zoo.dev | SDK/MCP MIT; engine closed | kittycad 1.13.0 (2026-11-20) |
| JSCAD | JavaScript | Own mesh CSG | No (bk) | Yes / Yes | Limited (expand/offset, hull) (bk) | None formal | `npm i @jscad/modeling @jscad/cli` | MIT | 2.13.0 (2026-02-22) |
| Replicad | TypeScript/JS | OCCT via WASM | Yes | Yes / (unverified) | Kernel-exact | Basic compounds (bk) | `npm i replicad replicad-opencascadejs` | MIT + LGPL kernel | 1.2.1 (2026-11-06) |
| SolidPython2 | Python -> emits OpenSCAD | OpenSCAD's | No | Via OpenSCAD binary | As OpenSCAD/BOSL2 | As OpenSCAD | `pip install solidpython2` + openscad binary | LGPL-2.1 | 2.1.3 (2025-08-16) |
| ImplicitCAD | Haskell / extopenscad | Implicit (SDF) | No | STL, OBJ / No | Rounded unions built in | None | `cabal install implicit` (GHC toolchain) | AGPL-3.0 | 0.4.1.0 (Hackage; date not found) |

### Inferences
- Recommend build123d as the primary tool: it is the default backend of the one neutral 2026 benchmark that tests agent loops (CADGenBench), has the most active agent tooling (build123d-mcp, earthtojake/text-to-cad), installs with one pip command on the target Python, and gives STEP for outsourcing plus STL/3MF for slicing. CadQuery is the safe fallback because nearly all published LLM datasets and fine-tunes target it (Text-to-CadQuery, both CAD-Coders, BenchCAD), so base models have seen far more of it.
- Never install CadQuery and build123d in the same virtualenv (as of cadquery 2.8.0 / build123d 0.13.0 they pin different OCP wheels that collide). Use one venv per library, or pick one.
- The academic numbers (100% valid syntax, exact-match rates) are for fine-tuned models on simple sketch-extrude datasets; they do not show that a general LLM will get a multi-part enclosure right first time. The benchmark evidence that matters for this project is the agent-loop result: giving the model tools to execute, render, measure and validate raised validity to 100% in the self-reported build123d-mcp run. Design the workflow around a verify loop, not around one-shot generation.
- OpenSCAD remains a reasonable choice only if the part stays a simple prismatic box and STEP is not needed. Its weak points for this project are real: no STEP, no native fillets, stable release five years old, and on Ubuntu 24.04 the apt build has no Manifold backend and needs a virtual display for PNG output.
- Zoo/KCL and FreeCAD are poor fits for an unattended container agent: Zoo needs a paid cloud API and outbound access; FreeCAD is heavy to install on 24.04 and its scripted PartDesign workflow is more brittle than a pure library. JSCAD lacks STEP and fillets. Replicad is the only credible Node 22 option (OCCT kernel, STEP), but it is aimed at browser apps and has little LLM track record. ImplicitCAD and SolidPython2 are niche and slow-moving.
- Because build123d's API has changed across versions, pin `build123d==0.13.0` in requirements and give the agent the current docs or the build123d-mcp skill, rather than relying on training data.

### Gaps
- I could not open the arXiv pages, so headline metrics for Text-to-CadQuery are not confirmed here. From memory of the abstract (unverified): roughly 170k CadQuery annotations added to the Text2CAD dataset, six open-source LLMs fine-tuned, top-1 exact match improved from 58.8% to 69.3% and Chamfer distance reduced by 48.6%. Check before quoting.
- No independent head-to-head of Claude writing OpenSCAD vs CadQuery vs build123d for enclosures was found; the comparison blogs are mostly vendor-authored and I could not read them in full.
- No Hackaday article specifically on LLM + code-CAD was surfaced by search.
- OpenSCAD dev-snapshot version numbers for late 2026 and whether a new stable was tagged after May 2026 are unconfirmed. BOSL2's current release and licence were not checked (BSD-2-Clause from memory).
- Zoo's current API price and whether KCL/engine code is open source were not confirmed against zoo.dev's pricing page.
- Table cells marked (bk) were not re-verified.

## 2. Claude Code / agent skills, MCP servers and plugins for CAD (2026)

### Takeaway
There is now a real ecosystem. The most relevant for a headless container are **build123d-mcp** (execute/render/measure/validate/export, ships Claude skills), **earthtojake/text-to-cad** (27k-star skill pack on build123d with OrcaSlicer slicing and printability checks), **flowful-ai/cad-skill** (CadQuery skill with headless previews and bed-fit checks) and **RobertCoop/openscad-mcp**. GUI-CAD servers (Fusion, FreeCAD, Onshape, Blender) need the application or a cloud account and suit a human-in-the-loop on macOS, not CI.

### Cited Findings
- build123d-mcp (pzfreo/build123d-mcp, Apache-2.0): latest stable 0.3.91 (2026-10-15), pre-releases 0.4.0a1/rc1 (15-16 Nov 2026), Python >=3.11,<3.15. Capabilities: `execute` build123d code in a persistent session; render PNG/SVG/DXF previews and 2D drawings; measure volume, area, bounding box, topology, centre of mass; `find_candidates`/`interface_features` for holes and bosses; printability checks; `compare`; `validate` that gates export; import STEP/STL; export STEP/STL/DXF/SVG; session snapshots; `last_error` for repair. `install_skill` installs `modeling`, `drawing` and `repair` skills for targets `claude`, `agents-md`, `cursor`, `windsurf` — [PyPI build123d-mcp](https://pypi.org/project/build123d-mcp/), [pzfreo/build123d-mcp](https://github.com/pzfreo/build123d-mcp)
- build123d-mcp Claude Code setup: add to `.mcp.json` `{"mcpServers":{"build123d-mcp":{"command":"uv","args":["tool","run","--python","3.12","build123d-mcp@latest"]}}}`; default stdio transport gives each client its own session; HTTP mode has no built-in auth — [PyPI build123d-mcp](https://pypi.org/project/build123d-mcp/)
- earthtojake/text-to-cad (MIT, about 27.0k stars, 1,523 commits): agent skills built on build123d/OpenCascade. Skills cover parts and assemblies (STEP/STL/3MF/GLB), manufacturing checks (machinable, sheet-metal, mouldable, 3D printable), stress checks via CalculiX, engineering drawings, Blender renders, fabrication (DXF/STEP vs SendCutSend rules, "3D print slicing with OrcaSlicer"), KiCad PCB with ERC/DRC, URDF. One-line installer sets up a `cad` CLI and the plugin in each agent app found; `cad doctor` for diagnostics — [earthtojake/text-to-cad](https://github.com/earthtojake/text-to-cad)
- flowful-ai/cad-skill (734 stars, PolyForm Noncommercial 1.0.0): Claude Code skill for parametric 3D-printable models in CadQuery. `preview.py` renders an STL to six PNG views headlessly with trimesh + pyrender and has `--strict` to fail non-watertight meshes; `run_cadquery_model.py` runs a script, captures errors, checks parts against a printer build volume (e.g. `--bed a1`) and returns JSON; `mating.py` checks assembled parts do not collide and joints locate; `stl_to_3mf.py`. Install: clone into `~/.claude/skills/parametric-3d-printing`, make a venv, `pip install -r requirements.txt`; invoked by keywords or `/parametric-3d-printing` — [flowful-ai/cad-skill](https://github.com/flowful-ai/cad-skill)
- A fork of the same skill exists at jpurzner/cad-skill, and rohittp0/ClaudeCAD is a Claude Code plugin that generates parametric `.scad` files with automatic mesh validation — [jpurzner/cad-skill](https://github.com/jpurzner/cad-skill), [rohittp0/ClaudeCAD](https://github.com/rohittp0/ClaudeCAD)
- RobertCoop/openscad-mcp (MIT, 174 stars; PyPI 0.6.1, 2026-09-10): 12 tools — `render` (multi-view, cross-sections, per-part colour, before/after), `check` (interference/clearance/contact between named parts), `export_model` (STL, 3MF, AMF, OFF, DXF, SVG, PDF, CSG), `measure` (bbox, volume, mass, holes, printability, orientation candidates), `validate`, `scad_eval`, `reference` (fits, fasteners, inserts, design rules), `get_libraries`, `check_openscad`, and others. Install: `claude mcp add openscad --transport stdio -- uvx openscad-mcp`, or as a plugin: `/plugin marketplace add robertcoop/openscad-mcp` then `/plugin install openscad-mcp@openscad-mcp`. About 1,500 tests; author notes lint/type checks are not clean; no OS-level sandbox. "OpenSCAD 2021.01 needs a display for PNG export, even headless. Run the server with `xvfb-run -a`"; BOSL2 is not bundled — [RobertCoop/openscad-mcp](https://github.com/RobertCoop/openscad-mcp), [PyPI openscad-mcp](https://pypi.org/project/openscad-mcp/)
- Other OpenSCAD servers: jhacksman/OpenSCAD-MCP-Server (prompt to SCAD, STL and four PNG previews) and petrijr/openscad-mcp (wraps the OpenSCAD CLI for validate/render/export) — [jhacksman/OpenSCAD-MCP-Server](https://github.com/jhacksman/OpenSCAD-MCP-Server), [petrijr/openscad-mcp](https://github.com/petrijr/openscad-mcp)
- FreeCAD: neka-nat/freecad-mcp (MIT, 3.4k stars) is the most used. It requires the FreeCAD GUI: you install the `FreeCADMCP` addon, pick the "MCP Addon" workbench and click "Start RPC Server", and "keep FreeCAD open with its RPC server running"; the MCP side is `uvx freecad-mcp`. Alternatives: contextform/freecad-mcp, spkane/freecad-addon-robust-mcp-server, ghbalf/freecad-ai (workbench) — [neka-nat/freecad-mcp](https://github.com/neka-nat/freecad-mcp), [awesome-cad-agent](https://github.com/mlightcad/awesome-cad-agent)
- Autodesk Fusion: Autodesk ships official MCP servers. The local Fusion MCP server is hosted by Fusion at `http://127.0.0.1:27182/mcp` and is only available while Fusion is open; Fusion Data MCP is remote and does not need Fusion running. Community servers also exist (ArchimedesCrypto/fusion360-mcp-server, mycelia1/fusion360-mcp-server) — [Autodesk MCP Server Help](https://help.autodesk.com/view/ADSKMCP/ENU/?guid=ADSKMCP_FusionDesktopMcp_connecting_to_the_fusion_mcp_server_html), [Autodesk MCP Servers](https://www.autodesk.com/solutions/autodesk-ai/autodesk-mcp-servers), [Snyk: 9 CAD MCP servers](https://snyk.io/articles/9-mcp-servers-for-computer-aided-drafting-cad-with-ai/)
- Onshape: an official FeatureScript MCP Server is in Onshape Labs early access (writes FeatureScript for custom features rather than drawing geometry directly); the community Jarvis Onshape MCP (ReshefElisha/jarvis-onshape-mcp) includes a Claude Code plugin manifest and vision-guided modelling skill — [getleo.ai CAD MCP comparison 2026](https://www.getleo.ai/blog/cad-mcp-server-comparison-2026), [awesome-cad-agent](https://github.com/mlightcad/awesome-cad-agent)
- Blender: an official Blender Lab MCP server exists (one review dates its launch to 28 April 2026); the widely used ahujasid/blender-mcp is community-built. Blender skill packs for Claude Code: EL4CTEO/blender-skills (28 skills) and arjun988/blender-skills (94 skills) — [ChatForest CAD MCP review](https://chatforest.com/reviews/cad-3d-modeling-mcp-servers/), [awesome-cad-agent](https://github.com/mlightcad/awesome-cad-agent)
- Zoo: official `zoo-mcp` (KittyCAD, MIT, 12 stars; PyPI 0.36.0 released 2026-11-20). Tools include `execute_kcl`, `mock_execute_kcl`, `import_cad_file`, `snapshot`, `start_modeling_session`/`stop_modeling_session`, `get_kcl_sample`. Runs locally over stdio but calls Zoo's cloud API; needs a Zoo account/token (`uvx zoo-mcp auth login`) — [KittyCAD/zoo-mcp](https://github.com/KittyCAD/zoo-mcp), [PyPI zoo-mcp](https://pypi.org/project/zoo-mcp/)
- Other agent projects on build123d: Forgent3D (desktop repo in maintenance; newer "Forgent3D Skills"), MAC Multi-Agent-CAD (Tsinghua; build123d + LangGraph + Aider); OpenSCAD-based CADAM text-to-CAD app — [awesome-cad-agent](https://github.com/mlightcad/awesome-cad-agent)
- Curated indexes: mlightcad/awesome-cad-agent and zhuyansen/awesome-3d-skills (the latter security-grades each entry) — [awesome-cad-agent](https://github.com/mlightcad/awesome-cad-agent), [awesome-3d-skills](https://github.com/zhuyansen/awesome-3d-skills)

### Inferences
- For an agent in a Linux container, an MCP server is optional: the same loop (write script, run, measure, render PNG, read the PNG, fix) can be done with plain Bash plus the snippets in section 3. The value of build123d-mcp is the persistent session, the export-gating `validate`, and the bundled skills that encode current API usage.
- Maturity ranking for this use case: build123d-mcp (frequent releases, near 0.4, benchmark-tested, but single maintainer) and text-to-cad (very large user base) are the most mature; openscad-mcp is well tested but young (174 stars, author flags unclean lint/types); cad-skill is useful but its licence is non-commercial; zoo-mcp is official but tiny in adoption and cloud-bound.
- Fusion/Onshape/FreeCAD/Blender MCP servers all need a running GUI app or cloud document. They matter only if the student wants Claude Desktop to drive a GUI CAD on the Mac.
- Any third-party skill or MCP server executes generated code; run it in the container, not on the student's Mac, and review a skill's scripts before installing.

### Gaps
- buildcad.ai's "CAD MCP Servers Compared (2026)" guide and techdrawai.com's review could not be opened; star counts quoted by secondary sources conflict (freecad-mcp: 1,709 in Aug 2026 vs about 2,900 in Oct 2026 vs 3.4k read directly today).
- No dedicated, well-known "CadQuery MCP server" was found; CadQuery support appears mainly as skills (cad-skill) rather than MCP.
- I did not install or run any of these MCP servers; capability lists are from their own READMEs.
- Last-commit dates were not visible on the fetched GitHub pages (the gh API was not enabled for these repos in this session).

## 3. Automated verification an agent can run without a GUI

### Takeaway
Everything needed works headlessly, and I ran most of it in this container: build123d/OCP for bounding box, volume, centre of mass, validity and interference; trimesh and admesh for watertightness; PrusaSlicer CLI for slicing, print time and filament; pytest for parametric assertions; PyVista or f3d under `xvfb-run` for PNG previews. Rendering is the only part that needs a virtual display (or EGL/OSMesa libraries).

### Cited Findings

Geometry facts from the B-rep (tested here; output shown is real):
- build123d script, checked with build123d 0.13.0 — [PyPI build123d](https://pypi.org/project/build123d/)

```python
from build123d import *
W, D, H, WALL, TOL = 120.0, 80.0, 30.0, 2.4, 0.3
with BuildPart() as body:
    Box(W, D, H)
    fillet(body.edges().filter_by(Axis.Z), radius=4)
    offset(amount=-WALL, openings=body.faces().sort_by(Axis.Z)[-1])   # shell, open top
    with Locations(body.faces().sort_by(Axis.Y)[0]):
        Box(12, 6, WALL*3, mode=Mode.SUBTRACT)                        # USB-C cut-out
with BuildPart() as lid:
    with Locations((0, 0, H/2 + 1)):
        Box(W, D, 2); fillet(lid.edges().filter_by(Axis.Z), radius=4)
    with Locations((0, 0, H/2 - 1)):
        Box(W - 2*WALL - 2*TOL, D - 2*WALL - 2*TOL, 2)                # locating lip
body, lid = body.part, lid.part
bb = body.bounding_box()
print(bb.size.X, bb.size.Y, bb.size.Z)            # 120.0 80.0 30.0
print(body.volume, body.volume/1000*1.27)         # 48375.9 mm3 -> 61.4 g of PETG
print(body.center(CenterOf.MASS))                 # (0.0, 0.14, -5.93)
print(body.is_valid, body.is_manifold, len(body.solids()))   # True True 1
inter = body & lid                                 # boolean intersection = interference
print(inter.volume if inter else 0.0)              # 0.4807 mm3  <- real clash found
export_step(body, "body.step")
export_stl(body, "body.stl", tolerance=0.01, angular_tolerance=0.1)
m = Mesher(); m.add_shape(body); m.add_shape(lid); m.write("assembly.3mf")
```

- The interference check caught a genuine design error in that toy model: the lid's square-cornered lip collides with the body's rounded inner corners (0.48 mm3 overlap) even with 0.3 mm clearance; pushing the lid 1.5 mm down gave 1,388.6 mm3. This is the kind of mating bug the check exists for — [PyPI build123d](https://pypi.org/project/build123d/)
- CadQuery equivalent, tested with CadQuery 2.8.0, including the low-level OCP validity check — [PyPI cadquery](https://pypi.org/project/cadquery/)

```python
import cadquery as cq
from OCP.BRepCheck import BRepCheck_Analyzer
r = cq.Workplane("XY").box(120, 80, 30).edges("|Z").fillet(4).faces(">Z").shell(-2.4)
s = r.val(); bb = s.BoundingBox()
print(bb.xlen, bb.ylen, bb.zlen, s.Volume(), s.isValid(), s.Center().toTuple())
# 120.0 80.0 30.0 48548.7 True (~0, ~0, -5.908)
print(BRepCheck_Analyzer(s.wrapped).IsValid())    # True
cq.exporters.export(r, "cq_body.step"); cq.exporters.export(r, "cq_body.stl")
```

Mesh checks (tested here):
- trimesh 5.2.1 (MIT, Python >=3.10) on the exported STL — [PyPI trimesh](https://pypi.org/project/trimesh/)

```python
import trimesh
m = trimesh.load_mesh("body.stl")
print(m.is_watertight, m.is_winding_consistent, m.is_volume, m.euler_number, m.body_count)
# True True True 0 1
print(m.extents, m.volume, m.center_mass)   # [120. 80. 30.] 48375.4 [-0. 0.14 -5.93]
```

- admesh 0.98.5 from Ubuntu apt: `admesh body.stl` reported "Number of parts: 1, Volume: 48375.308594, Total disconnected facets: 0, Backwards edges: 0, Normals fixed: 0" — [Ubuntu package admesh](https://packages.ubuntu.com/noble/admesh)

Slicing as a printability test (tested here with PrusaSlicer 2.7.2 from Ubuntu apt; no display needed):
- `prusa-slicer --info body.stl` printed `size_x/y/z`, `number_of_facets = 1072`, `manifold = yes`, `number_of_parts = 1`, `volume = 48375.308594` — [PrusaSlicer](https://github.com/prusa3d/PrusaSlicer)
- `prusa-slicer --export-gcode --layer-height 0.2 --fill-density 15% --filament-type PETG --nozzle-diameter 0.4 --filament-diameter 1.75 --temperature 240 --bed-temperature 80 -o body.gcode body.stl` succeeded; then `grep -E "^; (estimated printing time|filament used)" body.gcode` gave `; filament used [mm] = 16886.97`, `; filament used [cm3] = 40.62`, `; estimated printing time (normal mode) = 3h 49m 52s`. Grams came out as 0.00 because no filament density was set (add `--filament-density 1.27`) — [PrusaSlicer](https://github.com/prusa3d/PrusaSlicer)
- OrcaSlicer "can run headless from the command line to load, transform, and slice models without opening the GUI"; the documented pattern chains `--load-settings`, `--load-filaments`, `--arrange`, `--slice 0` (0 = all plates) and `--export-3mf`; setting keys map to flags by replacing underscores with hyphens — [OrcaSlicer wiki: CLI mode](https://www.orcaslicer.com/wiki/cli/cli_mode), [OrcaSlicer wiki: CLI actions](https://www.orcaslicer.com/wiki/cli/cli_actions)
- Bambu Studio documents a similar command-line mode — [BambuStudio wiki: Command Line Usage](https://github.com/bambulab/BambuStudio/wiki/Command-Line-Usage)
- A PyPI package `fabprint` describes itself as a "headless 3D print pipeline: arrange, orient, slice, and send to printer from a TOML config" — [PyPI fabprint](https://pypi.org/project/fabprint/0.1.70/)

Headless PNG previews (tested here):
- PyVista 0.49.2 + VTK 9.7.2 from pip: without a display it failed (VTK warned "Failed to load EGL" and "libOSMesa not found"); under `xvfb-run -a` it wrote the PNG — [PyPI pyvista](https://pypi.org/project/pyvista/)

```python
# xvfb-run -a python render_pv.py body.stl out.png
import pyvista as pv, sys
pv.OFF_SCREEN = True
p = pv.Plotter(off_screen=True, window_size=(800, 600))
p.add_mesh(pv.read(sys.argv[1]), color="lightgrey"); p.view_isometric()
p.screenshot(sys.argv[2])
```

- CADGenBench renders "in-process through PyVista and VTK, so no browser or Chromium is needed", and on headless Linux needs system OpenGL libraries such as Mesa — [huggingface/cadgenbench](https://github.com/huggingface/cadgenbench)
- f3d 4.0.1 (BSD-3) from pip gives a Python module only (no `f3d` executable in the venv). `f3d.Engine.create(True)` failed with "Cannot create a window" without a display, but under `xvfb-run -a` it loaded the STEP file directly and saved a PNG: `e=f3d.Engine.create(True); e.window.size=(800,600); e.scene.add('body.step'); e.window.render_to_image().save('out.png')` — [PyPI f3d](https://pypi.org/project/f3d/)
- OpenSCAD 2021.01 (apt): `openscad -o box.stl --export-format binstl box.scad` worked with no display; `openscad -o box.png --imgsize=800,600 --render --viewall --autocenter box.scad` produced a 0-byte file without a display and a valid PNG under `xvfb-run -a` — [Ubuntu package openscad](https://packages.ubuntu.com/noble/openscad)
- This matches openscad-mcp's note that OpenSCAD 2021.01 needs a display for PNG export while exports, measurements and checks do not — [RobertCoop/openscad-mcp](https://github.com/RobertCoop/openscad-mcp)
- The flowful-ai skill renders six views headlessly with trimesh + pyrender — [flowful-ai/cad-skill](https://github.com/flowful-ai/cad-skill)
- Ubuntu 24.04 apt candidates seen here: `f3d` 2.2.1, `blender` 4.0.2, `libosmesa6` 25.1.7, `prusa-slicer` 2.7.2; `cura-engine` had no candidate — [Ubuntu packages (noble)](https://packages.ubuntu.com/noble/)

Unit tests for parametric dimensions (tested here: "5 passed in 1.50s"):

```python
# pytest -q test_enclosure.py
import pytest, trimesh
from build123d import *
BED = (220, 220, 250)
@pytest.fixture(scope="module")
def body(): return import_step("body.step")
def test_fits_bed(body):
    s = body.bounding_box().size
    assert s.X <= BED[0] and s.Y <= BED[1] and s.Z <= BED[2]
def test_outer_dims(body):
    s = body.bounding_box().size
    assert (s.X, s.Y, s.Z) == pytest.approx((120, 80, 30), abs=0.01)
def test_valid_single_solid(body):
    assert body.is_valid and len(body.solids()) == 1
def test_mesh_watertight():
    m = trimesh.load_mesh("body.stl")
    assert m.is_watertight and m.is_winding_consistent and m.body_count == 1
def test_mass_budget(body):
    assert body.volume / 1000 * 1.27 < 80      # grams of PETG if solid
```
- Source for the libraries used in the test file — [PyPI build123d](https://pypi.org/project/build123d/), [PyPI trimesh](https://pypi.org/project/trimesh/)

### Inferences
- A sensible CI gate, in order of cost: (1) script runs without exception; (2) `is_valid`, single solid, expected bounding box; (3) pairwise interference volume equals zero for mating parts, and a deliberate "push 1 mm" test gives non-zero (proves the check is live); (4) each printed part fits the bed; (5) exported STL is watertight in trimesh/admesh; (6) slicer exits 0 and print time/filament are under budget; (7) PNG views are rendered and looked at by the agent. Steps 1-5 took well under 5 seconds here.
- Model the controller itself as a keep-out solid (a 482 x 272.8 x 59.2 mm box for the FLX4, 383.2 x 208 x 48.2 mm for the FLX2, plus cable keep-out volumes behind the rear ports) and include it in the interference tests. That turns "does it fit the controller" into an automated assertion.
- For a clean container setup: `apt-get install -y xvfb libegl1 libosmesa6 admesh prusa-slicer` plus `pip install build123d trimesh pyvista pytest`. Use `xvfb-run -a` for any step that renders. Installing libEGL/OSMesa may remove the need for xvfb with VTK, but I did not re-test that.
- The apt PrusaSlicer (2.7.2) is old; print-time numbers are indicative only. For Bambu printers use an OrcaSlicer or Bambu Studio AppImage with real machine/process/filament JSON profiles.
- Interference checks need a small tolerance in assertions (e.g. `< 1e-3 mm3`) because touching faces can return slivers.

### Gaps
- OrcaSlicer, CuraEngine, Blender CLI and pyrender were not run here (CuraEngine has no apt candidate on this image; OrcaSlicer needs an AppImage download).
- I did not test CadQuery's own VTK-based image export or the `ocp_vscode`/`yacv-server` viewers.
- The exact OrcaSlicer flag for writing plain G-code (`--export-gcode` is listed by a third-party wiki, not the official one) and how to read time estimates from its CLI are unconfirmed.
- Mass/centre-of-mass here assume a solid homogeneous part; real FDM parts have infill, so use the slicer's filament figure for mass.

## 4. GUI CAD for a human beginner (comparison) and skills needed

### Takeaway
For a budget-conscious university student on macOS, Onshape (free or education plan, runs in a browser) and Fusion for personal use are the two realistic choices for learning parametric enclosure design; FreeCAD 1.1 is the fully free, offline fallback. Tinkercad and Shapr3D's free tier are too limited for a fitted enclosure, and SolidWorks for Makers is cheap but locks files with a watermark.

### Cited Findings
- Fusion for personal use: free for non-commercial, home-based projects; limit of 10 active, editable documents at a time (others become read-only but stay saved); intended for hobbyists generating less than $1,000 USD a year; unlimited active documents is a paid feature — [Autodesk: 10 document limit explained](https://www.autodesk.com/products/fusion-360/blog/the-10-document-limit-for-personal-use-explained-in-7-steps/), [Autodesk: personal vs paid](https://www.autodesk.com/products/fusion-360/personal/compare), [Autodesk: Fusion for personal use](https://www.autodesk.com/products/fusion-360/blog/fusion-for-personal-use-vs-autodesk-fusion/)
- STEP and STL export were kept in Fusion for personal use after Autodesk reversed course in September 2020 — [Autodesk: changes to personal use](https://www.autodesk.com/products/fusion-360/blog/changes-to-fusion-360-for-personal-use/), [Hackaday](https://hackaday.com/2020/09/25/autodesk-blinks-keeps-step-file-export-in-free-version-of-fusion-360)
- Onshape Free: unlimited public documents, no private documents, non-commercial use only; on the free tier "all your designs are publicly viewable and can be copied by anyone" — [Onshape help: managing your account and subscription](https://cad.onshape.com/help/Content/Plans/managing_your_onshape_account_and_subscription.htm), [Onshape tech tips](https://www.onshape.com/en/resource-center/tech-tips/10-ways-onshape-documents-boost-productivity)
- Onshape runs in a browser on any computer (PC, Mac, Chromebook) or through iOS/Android apps; there is a free education programme for qualifying students, and student subscriptions expire after one year and downgrade automatically — [Onshape education blog](https://www.onshape.com/en/blog/insights-engineering-education-faculty-students-cloud-native-cad), [Onshape help](https://cad.onshape.com/help/Content/Plans/managing_your_onshape_account_and_subscription.htm)
- Onshape paid tiers for scale: Standard about $1,500 and Professional about $2,500 per user per year — [checkthat.ai Onshape pricing 2026](https://checkthat.ai/brands/onshape/pricing)
- SolidWorks for Makers: $48 USD per year or $15 per month (promotions to $24/year); personal, non-commercial use under $2,000 USD a year of revenue; files are digitally watermarked and open only with a Makers licence — [SOLIDWORKS for Makers](https://www.solidworks.com/solution/solidworks-makers.md)
- Shapr3D Basic (free): access to modelling tools but only low-resolution STL/3MF export; users complain the low-res export is coarse enough to "count the triangles" — [Shapr3D subscription plans](https://support.shapr3d.com/hc/en-us/articles/7871961422364), [Shapr3D pricing](https://shapr3d.com/pricing), [Shapr3D forum](https://discourse.shapr3d.com/t/basic-subscription-low-res-images/26443)
- Tinkercad has no direct fillet tool for arbitrary edges (workarounds use pre-made fillet shapes), and round shapes are limited to 64 sides — [Instructables: Filleting](https://www.instructables.com/id/Filleting-Taking-the-Edge-Off/), [Bambu Lab forum](https://forum.bambulab.com/t/smooth-circles/62638/5)
- FreeCAD 1.1.2 (July 2026) is the current free, open-source desktop option — [FreeCAD blog 1.1.2](https://blog.freecad.org/2026/07/23/freecad-1-1-2-released/)
- Learning resources surfaced by search: Autodesk's own "Introduction to 3D modeling" course and Fusion tutorials hub; the Onshape Learning Center's "CAD Basics" and "Onshape Fundamentals" pathways; a Udemy "FreeCAD v1.1 Ultimate Beginners Course 2026"; Elektor's "3D modeling tips for enclosures and mechanical parts"; a Class Central-listed YouTube tutorial "How to build your own box for a PCB board using free Fusion 360"; All3DP's "best CAD software for beginners" (updated January 2026) — [Autodesk Learn](https://autodesk.com/learn/ondemand/curated/introduction-to-3d-modeling), [Autodesk Fusion tutorials](https://www.autodesk.com/solutions/design-manufacturing/fusion-tutorials), [Udemy FreeCAD 1.1](https://www.udemy.com/course/freecad-v1-1-ultimate-beginners-course-2026/), [Elektor](https://www.elektormagazine.com/news/3d-modeling-tips-for-enclosures-and-mechanical-parts), [Class Central](https://classcentral.com/course/youtube-how-to-build-your-own-box-for-a-pcb-board-using-free-fusion-360-software-step-by-step-tutorial-130264), [All3DP](https://all3dp.com/1/best-cad-software-for-beginners/)
- DigiKey's Maker.io has an "Intro to FreeCAD" series whose part 4 covers heat-set inserts — [DigiKey Maker.io](https://www.digikey.de/en/maker/tutorials/2025/intro-to-freecad-part-4-how-to-use-heat-set-inserts)

### Inferences
- Fastest path for the student: Onshape. No install on macOS, a free education plan removes the public-document issue, a structured official learning path exists, and a simple shelled box with bosses is reachable in a weekend. Fusion is a close second with the largest body of YouTube enclosure tutorials; its 10-document cap is not a problem for one project.
- The public-document rule on Onshape Free matters little here (a hobby enclosure), but the student should know anything created there is world-readable.
- A hybrid workflow is practical: the agent produces STEP from build123d; the student opens the STEP in Onshape/Fusion to inspect, measure and learn, and uses GUI CAD only for quick experiments. STEP is the interchange format, which is another reason to prefer an OCCT-based code-CAD tool over OpenSCAD.
- Human skills needed overall: (1) basic parametric modelling (sketch, extrude, shell, fillet, pattern) enough to read and sanity-check a model; (2) measuring with calipers and thinking in tolerances/clearances; (3) slicer literacy (orientation, supports, walls/infill, material profiles); (4) FDM printing practice and test coupons; (5) basic electronics and connector handling (USB-C, display ribbon/HDMI, strain relief); (6) soldering and heat-set insert installation with an iron; (7) light assembly skills (M2-M3 fasteners, adhesives). None needs prior CAD expertise if the agent writes the code, but items 2-4 cannot be delegated.

### Gaps
- No current (2026-dated) Autodesk licence document was found confirming STEP export is still in the personal tier; one Autodesk help page is ambiguous. Verify in-product.
- Well-known YouTube series I would normally name (Product Design Online's "Learn Fusion 360 in 30 Days", MangoJelly Solutions for FreeCAD, Too Tall Toby practice models, Teaching Tech / Made with Layers for print design) did not appear in search results, so they are unverified here (bk).
- SolidWorks desktop being Windows-only (so Mac users would be limited to the browser-based xDesign apps in the Makers bundle) is from background knowledge, not confirmed.
- No independent timing study of "fastest to learn for an enclosure" exists in what I found; the ranking above is judgement.
- Whether a university licence (Fusion Education, SolidWorks student) is available depends on the student's institution.

## 5. Design-for-FDM rules for an electronics enclosure

### Takeaway
Use 2.0-2.4 mm walls (a multiple of the 0.4 mm nozzle), 0.2-0.3 mm per-side clearance for parts that should slide together and about 0.5 mm around electronics, M3 heat-set inserts in 4.0 mm holes with at least 1.6-2.0 mm of wall around them, and print in PETG (or ASA if it will sit in a hot car or sun). Both controllers are wider than a 256 mm bed, so any full-width part must be split and joined with pins, dovetails or bolts. Always print a small fit-test coupon first.

### Cited Findings
Walls, ribs, bosses, clearances:
- Hubs recommends a 2 mm minimum wall for enclosures; its FDM example uses 2.4 mm because "using a wall thickness that is a multiple of the nozzle size will result in a much better print"; a 0.5 mm tolerance around internal components and +/-0.25 mm on clearance/bite holes are suggested starting points; bosses are recommended wherever threaded fasteners go; ribs at roughly 75-80% of wall thickness — [Hubs: enclosure design for 3D printing](https://www.hubs.com/knowledge-base/enclosure-design-3d-printing-step-step-guide/)
- Other guides put the FDM wall floor at 0.8 mm or twice the nozzle diameter, ribs at half to two-thirds of the wall, and the wall around a hole at about one hole diameter — [Sculpteo: 3D printed enclosure guidelines](https://www.sculpteo.com/blog/2017/06/14/3d-printed-enclosures-learn-the-basic-design-guidelines/), [FacFox enclosure design guide](https://facfox.com/docs/kb/enclosure-design-guide-for-3d-printing)
- Hackaday has two practical write-ups on printed enclosure design — [Hackaday 2020](https://hackaday.com/2020/11/16/simple-tips-for-better-3d-printed-enclosures), [Hackaday 2017](https://hackaday.com/2017/05/24/practical-enclosure-design-optimized-for-3d-printing)

Fits:
- University of the Arts London fab-lab guide: press fit 0-0.05 mm on Bambu printers (about 0.2 mm per side on Ultimaker); sliding/moving parts 0.15-0.2 mm on Bambu and 0.3 mm+ per side on Ultimaker; 0.2 mm or more if parts must be removable. Clearance is per side: a 10 mm peg with 0.2 mm clearance needs a 10.4 mm hole — [UAL CCI wiki: clearance and tolerance](https://wiki.cci.arts.ac.uk/books/digital-fabrication-lab/page/design-the-clearance-and-tolerance)
- Sovol: press fits 0.05-0.15 mm; warns that a high-shrink material such as ASA can make a nominal 0.1 mm press far tighter; recommends printing a gap-test block and recording which gaps feel press/sliding/loose — [Sovol: FDM tolerances and clearances](https://www.sovol3d.com/blogs/news/fdm-3d-printing-tolerances-clearances-how-to-design-parts-that-fit)
- Snapmaker: clearance fits 0.3-0.5 mm — [Snapmaker: 3D printing tolerances](https://www.snapmaker.com/blog/3d-printing-tolerances)

Heat-set inserts:
- CNC Kitchen's rules: blind hole about 1 mm deeper than the insert length, straight (not tapered) holes, respect minimum wall thickness, normally no chamfer at the hole edge; the bore should be just large enough for the installation tip to enter and avoid a burr under the insert. Exact diameters are in its downloadable "Dimensions & Design Guidelines" poster (M2-M10) — [CNC Kitchen: tips and tricks for heat-set inserts](https://www.cnckitchen.com/blog/tipps-amp-tricks-fr-gewindeeinstze-im-3d-druck-3awey)
- Prusa (which sells the CNC Kitchen inserts) says to set the soldering iron about 10 C above the print temperature — [Prusa: heat-set inserts M3](https://www.prusa3d.com/product/heat-set-inserts-m3-standard-100-pcs/)
- Hole diameters reported for CNC Kitchen's datasheet: M2 3.2 mm, M2.5 4.0 mm, M3 4.0 mm — [Loftsmith: heat-set insert hole sizes](https://loftsmith.com/guides/heat-set-insert-hole-size)
- M3: "most M3 brass heat-set inserts require a 4.0 mm pilot hole in PLA, PETG, or ABS" — [Accu: threaded insert hole size charts](https://accu-components.com/p/488-threaded-insert-hole-size-charts-for-3d-printing-pla-petg-resin)
- Conflicts: for M2.5, other charts give 3.4-3.6 mm or 3.6-3.8 mm rather than 4.0 mm; for M3, one unofficial mirror of a CNC Kitchen listing gives 4.5 mm; some guides suggest modelling 4.1-4.2 mm for M3 because FDM holes print 0.1-0.3 mm undersize — [insertguide.com chart](https://insertguide.com/guides/heat-set-insert-hole-size/), [vertipress chart](https://vertipress.com/guides/heat-set-insert-hole-size-chart/), [meshra guide](https://meshra.ai/blog/heat-set-inserts-3d-printing)
- Wall around the insert hole: minimum 1.6 mm (DigiKey) to 2.0 mm for M3 — [DigiKey Maker.io](https://www.digikey.de/en/maker/tutorials/2025/intro-to-freecad-part-4-how-to-use-heat-set-inserts), [lyramaker guide](https://lyramaker.com/guides/heat-set-inserts/)
- openscad-mcp's `reference` tool serves "sourced engineering data such as fits, fasteners, inserts, bearings, and design rules", i.e. these tables are already packaged for agents — [RobertCoop/openscad-mcp](https://github.com/RobertCoop/openscad-mcp)

Snap fits and orientation:
- For cantilever snap-fits: widen the base and the clip, taper the arm, fillet the root, and consider build direction because "cantilevers built up vertically are inherently weaker" — [Hubs: enclosure design guide](https://hubs.com/knowledge-base/enclosure-design-3d-printing-extensive-guide), [Core77: Enclosure Design 101](https://core77.com/posts/68616/Enclosure-Design-101)

Splitting and joining large parts:
- Options: plain straight cut plus glue (no keying, not separable), dovetails (self-aligning; chamfer the dovetail edges so parts slide together), nuts and bolts ("robust, and easy to disassemble") — [DigiKey: how to split and join large 3D prints](https://www.digikey.com/en/maker/blogs/2024/how-to-split-and-join-large-3d-prints)
- Alignment pins: use square or D-shaped pins to stop rotation; leave about 0.25 mm gap (another source: 0.5 mm for dowels and holes); a zero-clearance pin with adhesive causes hydraulic lock, so add relief channels or chamfered entries; dry-fit first and glue in stages — [Sovol: printing large models in multiple pieces](https://www.sovol3d.com/blogs/news/3d-printing-large-models-in-multiple-pieces-keys-glue-and-assembly-tips), [Sovol: how to split large models](https://www.sovol3d.com/blogs/news/how-to-split-large-3d-models)
- Hackaday has covered large multi-piece prints and small-bed strategies — [Hackaday: giant 3D prints piece by piece](https://hackaday.com/2022/01/16/giant-3d-prints-piece-by-piece), [Hackaday: small print bed no problem](https://hackaday.com/2025/01/24/small-print-bed-no-problem)

Material for a hot gig environment:
- PLA glass transition is about 55-60 C with as-printed heat deflection around 59-61 C; standard PETG Tg is about 75-85 C; ASA has heat performance similar to ABS, around 100 C HDT (about 102 C at 0.45 MPa in one table), plus UV resistance — [All3DP: PLA/PETG glass transition](https://all3dp.com/2/pla-petg-glass-transition-temperature-3d-printing/), [Snapmaker: PETG glass transition](https://www.snapmaker.com/blog/petg-glass-transition-temperature/), [FDM plastics reference](https://queezz.github.io/aklab-howto/lab/fdm_materials), [Prusa material guide](https://help.prusa3d.com/article/material-table_2324)
- "PLA dashboard mounts fail in summer heat; PETG ones typically survive"; for dashboards ABS/ASA is preferred — [stacksheriff: PETG heat resistance](https://stacksheriff.com/3d-printing/petg-heat-resistance/)
- PETG filament averages about EUR 19.38/kg in one 2026 price index — [printer-hub: 3D printing service prices](https://printer-hub.ru/en/posts/3d-printing-service-prices)

### Inferences
- Suggested default parameters for the generator (to be confirmed with a test coupon on the actual printer): wall 2.4 mm; floor/lid 2.0 mm; lid-to-body sliding clearance 0.25 mm per side; PCB/display pocket clearance 0.5 mm per side; M3 insert hole 4.0 mm x (insert length + 1 mm), boss outer diameter at least 8 mm; M2.5 insert hole 3.6-4.0 mm depending on insert brand (measure the insert: hole is roughly the insert's smaller knurl diameter); M3 clearance hole 3.4 mm (bk); corner fillets 2-4 mm outside.
- Make every one of those a named parameter and print a single "coupon" part containing one insert boss per size, a lid-lip section and a connector cut-out. Fit numbers vary by printer, material and orientation, so the coupon is the real calibration.
- Bed limits versus controller width: the FLX4 is 482 mm wide and the FLX2 383.2 mm. A 220 mm bed has a 311 mm diagonal and a 256 mm bed a 362 mm diagonal, so any full-width bridge needs at least two pieces on a 256 mm bed for the FLX2 and two to three for the FLX4 (three on 220 mm). Put the joints away from the display opening, use a bolted lap joint with two D-shaped pins per joint, and let a metal part (M3 threaded rod or a 10 mm aluminium tube running the full width) carry the bending load.
- Print orientation: print the enclosure body open-side-up so the bezel face is on the bed (best surface) or front-face-down if the display window needs a crisp edge; keep snap arms flat in the XY plane; orient the bridge legs so layer lines run along the load path, not across it.
- Material choice: PETG is the pragmatic default (easy to print, about 80 C before softening, tougher than PLA). Use ASA if the unit will be left in a car or under stage lights/sun; PLA is acceptable only for prototypes. Dark colours in sun get hotter.
- Ventilation, VESA and ergonomics (bk, not sourced this session): add slotted vents low and high on the rear for convection if a single-board computer is inside; VESA MIS-D is a 75 x 75 or 100 x 100 mm square pattern with M4 screws, which makes a useful universal interface between display enclosure and bracket; tilt a low-mounted screen back roughly 10-20 degrees for a standing DJ, ideally adjustable; add 3-4 TPU or stick-on silicone feet; capture cables with a printed clamp or zip-tie anchor within 30 mm of each connector and leave room for the plug overmould (about 30-40 mm behind a USB-C plug unless right-angle cables are used); give the bezel a 1-2 mm overlap on the display's inactive border and never clamp the active glass area.

### Gaps
- CNC Kitchen's own poster values could not be read directly (site unreachable); hole sizes above are second-hand and conflict for M2.5. Measure the actual inserts.
- No authoritative source was fetched for VESA dimensions, recommended viewing tilt, vent sizing, strain-relief geometry or anti-slip feet; those items are background knowledge.
- Prusa's material table values (PLA 50-60, PETG 70-90, ASA 90-110 C) appeared in a search summary without the column label, so the exact property they describe is unconfirmed.
- No quantitative snap-fit design numbers (strain limits per material) were collected.

## 6. Controller facts: DDJ-FLX4 and DDJ-FLX2

### Takeaway
DDJ-FLX4: 482 x 272.8 x 59.2 mm (W x D x H), 2.1 kg, with two USB-C ports, RCA master out, a 1/4" mic input and a Kensington slot on the rear. DDJ-FLX2: 383.2 x 208 x 48.2 mm, 1.2 kg, with only a USB-C port and Kensington slot on the rear and its two 3.5 mm audio jacks on the left side. Neither has documented mounting holes, and no dimensioned CAD (STEP) model of either was found, so the add-on should be free-standing and its fit checked against a simple bounding-box model plus caliper measurements.

### Cited Findings
DDJ-FLX4:
- Dimensions 482 mm (W) x 59.2 mm (H) x 272.8 mm (D); weight 2.1 kg (4.63 lb); same for the gold DDJ-FLX4-N — [Pioneer DJ DDJ-FLX4 specifications](https://www.pioneerdj.com/en-us/product/controller/ddj-flx4/black/specifications/)
- Retailer cross-check: 59.2 x 482 x 272.8 mm (H x W x D), 2.1 kg — [Currys](https://www.currys.co.uk/products/pioneer-dj-ddjflx4-2channel-dj-controller-black-10284918.html)
- Two USB Type-C ports: one for PC/Mac connection (and power), one power-only; RCA master outputs and a 1/4" TS mic input on the rear — [Pioneer DJ DDJ-FLX4 specifications](https://www.pioneerdj.com/en-us/product/controller/ddj-flx4/black/specifications/), [B&H](https://www.bhphotovideo.com/c/product/803486822-USE/pioneer_dj_ddj_flx4_portable_2_channel_rekordbox.html)
- The official manual's rear-panel list includes a USB port for power supply, a USB port for device connection, RCA MASTER output terminals, a 1/4" TS MIC input terminal and a Kensington security slot (item 7); the manual has a separate "Front panel" section — [DDJ-FLX4 manual EN (PDF)](https://assets.ctfassets.net/q602vtcuu3w3/2vz7GMLHawLZBK6gWpCP9V/26bd62eef3eca3714ddb1d3396d30f7b/DDJ-FLX4_manual_EN.pdf), [DDJ-FLX4 manual copy](https://djcenter.ee/images/kasutusjuhendid/Pioneer-DDJ-FLX4.pdf)
- Serato's hardware table lists MASTER OUTPUT (RCA), MIC INPUT, MIC ATT., KENSINGTON LOCK and HEADPHONES for the unit — [Serato DDJ-FLX4 guide](https://support.serato.com/hc/en-us/articles/10317764199951)
- Headphone jack position conflict: one source says headphones connect on the front panel; a retailer listing describes a 3.5 mm headphone out among rear outputs — [manuals.plus DDJ-FLX4](https://manuals.plus/asin/B0BLSJZC94), [audio46 listing](https://audio46.com/products/pioneer-dj-ddj-flx4-2-channel-dj-controller-for-multiple-dj-applications-open-box)
- Box/packaging is about 536 x 340 x 124 mm (21.1 x 13.4 x 4.9 in) — [Micro Center](https://microcenter.com/quickView/699622/pioneer-ddj-flx4-deck-dj-controller-graphite)
- Decksaver's LE cover for the FLX4 is polycarbonate, 486 x 270 x 36 mm, about 0.45 kg, and fits "like a second skin... without unplugging cables" — [Thomann: Decksaver DDJ-FLX4](https://www.thomann.co.uk/decksaver_pioneer_dj_ddj_flx4.htm), [Musicstore](https://www.musicstore.de/en_US/USD/Decksaver-Pioneer-DJ-DDJ-FLX4-Cover/art-DJE0008166-000)
- Sibling teardown evidence: the closely related DDJ-400 has a plastic body "held together by about 60 screws in order to keep the plastic body rigid"; on the DDJ-FLX6 the interior is reached by removing bottom screws — [Hackaday.io DDJ-400 mod](https://hackaday.io/project/183348-ddj-400-high-brightness-mod), [JustAnswer FLX6](https://www.justanswer.com/electronics/l9eoj-replace-broken-crossfader-pioneer-ddj.html)

DDJ-FLX2:
- Maximum dimensions (W x D x H) 383.2 x 208 x 48.2 mm (15.09 x 8.19 x 1.90 in); main unit weight 1.2 kg (2.6 lb) — [AlphaTheta DDJ-FLX2 spec sheet (Teufel CDN)](https://cdn.teufelaudio.com/products/AlphaTheta/DDJ-FLX2/DDJ-FLX2-spec-sheet-HR)
- Retailer cross-checks: 383 x 208 x 48 mm and 1,200 g — [Juno](https://www.juno.co.uk/products/alphatheta-ddj-flx2-compact-2-channel-dj-controller/1053680-01), [Conrad](https://www.conrad.com/en/p/alphatheta-ddj-flx2-dj-controller-3342084.html)
- Terminals: USB Type-C x 1; MASTER x 1 (3.5 mm stereo mini jack); PHONES x 1 (3.5 mm stereo mini jack) — [AlphaTheta DDJ-FLX2 product page](https://alphatheta.com/en/product/dj-controller/ddj-flx2/black/)
- Rear panel per the manual: "1 USB port, 2 Kensington security slot" — [DDJ-FLX2 manual copy (PDF)](https://firefront.de/pdf/alphatheta_ddj_flex2_manual.pdf)
- A hands-on review confirms: USB-C on the rear for data and power, the Kensington lock next to the USB-C port, and "two headphone jack-style 1/8-inch TRS connectors on the left side of the unit", one headphone and one master — [DJ Life Mag review](https://djlifemag.com/2025/07/ddj-flx2-doing-a-lot-with-a-little-review/)
- It is bus-powered over the single USB-C cable — [Crossfader: getting started with the FLX2](https://wearecrossfader.co.uk/blog/flx2-getting-started/)
- Shipping box about 17.5 x 12.2 x 4.4 in, 4.47 lb — [B&H DDJ-FLX2](https://www.bhphotovideo.com/c/product/1858876-REG/pioneer_dj_ddj_flx2_dj_controller.html)

Existing 3D models and printable accessories:
- No STEP/dimensioned CAD model of the FLX4 turned up on GrabCAD, Thangs or Sketchfab in search. A Blender-made render model of the FLX4 is sold on RenderHub, and a DDJ-FLX2 model (DAE/OBJ/FBX, no STEP) on CGTrader; both are visual assets, not verified-dimension CAD — [RenderHub DDJ-FLX4](https://www.renderhub.com/madakar25/ddj-flx4-dj-controller), [CGTrader DDJ-FLX2](https://www.cgtrader.com/3d-models/electronics/audio/pioneer-alphatheta-ddj-flx2-dj-controller)
- Printable FLX4 accessories on MakerWorld: feet-style risers (about 2.5-3 h and 120 g per stand), a "Pioneer DDJ FLX 4 Stand" (about 5.5 h; A1 Mini two-part version), an "Inclinator with laptop stand" (18.4 h over four plates), the "Lapt'up" laptop stand that slides under the controller, a phone-mount remix for "standalone" use with a power bank, a riser with keyboard storage, and a cover — [MakerWorld 2455040](https://makerworld.com/models/2455040), [MakerWorld 2443775](https://makerworld.com/models/2443775), [MakerWorld 1835295](https://makerworld.com/models/1835295), [MakerWorld 1398110](https://makerworld.com/models/1398110), [MakerWorld 2930023](https://makerworld.com/models/2930023), [MakerWorld 2069316](https://makerworld.com/en/models/2069316), [MakerWorld 1899262](https://makerworld.com/models/1899262)
- Printables: a wall mount for the DDJ-FLX4 (4 mm screw holes, PLA, 15% infill) and a "ddj" tag listing; Cults3D: an FLX4 stand riser (1- and 2-plate versions) and a slide-out wall mount for DDJ-400/FLX4 with drilling template — [Printables wall mount](https://printables.com/model/663760-wall-mount-for-ddj-flx4), [Printables tag ddj](https://www.printables.com/search/models?q=tag:ddj), [Cults3D 4087812](https://cults3d.com/:4087812), [Cults3D 2641559](https://cults3d.com/:2641559)

### Inferences
- The existing printable stands and wall mounts are the best available fit references: their geometry encodes the FLX4's real underside and edge profile, and the "phone mount for standalone use" remix (MakerWorld 2930023) is the closest existing analogue to a screen add-on. Download and measure them (after checking licences) rather than trusting a render model.
- The published heights (59.2 mm FLX4, 48.2 mm FLX2; the FLX2 sheet calls them "maximum dimensions") are most likely measured to the tallest control, not the chassis top. The Decksaver cover is only 36 mm deep and wraps just the upper part of the FLX4, so it does not settle the chassis-top or knob height. Design rule until measured: the bottom edge of the screen should sit at or above 59.2 mm (FLX4) or 48.2 mm (FLX2) from the desk to be fully visible from a low viewing angle; standing DJs look down, so less is needed.
- Rear keep-out zones differ. On the FLX4 the rear is busy (two USB-C, RCA pair, mic jack, Kensington), so a rear bridge must leave the whole rear face open and allow about 40-60 mm for plugs (RCA plugs are long). On the FLX2 only the USB-C and Kensington slot are at the rear and the audio jacks are on the left side, so a side cheek on the left would block cables; mount from the rear or right instead.
- Both units have a Kensington slot on the rear. A printed or bought T-bar that engages the slot could act as a non-destructive anti-walk tether between controller and bridge, but the slot is not designed to carry load, so use it for location only.
- Case material is plastic for both (the FLX4's predecessor is described as a plastic body; the FLX2 at 1.2 kg is clearly plastic). Do not design clamps that put point loads on the chassis edge; spread load with TPU pads.
- One design can serve both controllers if width and keep-outs are parameters: inner span = controller width + 2 x clearance (e.g. 482 + 6 = 488 mm, or 383.2 + 6 = 389.2 mm).

### Gaps
- I could not open the official spec pages or manuals (pioneerdj.com, docs.pioneerdj.com, alphatheta.com unreachable), so I have no rear-panel drawings: the left-to-right order and millimetre positions of the ports are unknown. These must be measured with calipers on the actual unit.
- FLX4 headphone-jack location is contradictory in secondary sources. The manual having a separate front-panel section suggests the 3.5 mm PHONES jack is on the front, which matches my background knowledge, but confirm on the device.
- Not found: chassis-top height (without knobs), jog-wheel and knob heights, underside layout (feet positions, screw positions), any threaded holes usable for mounting, or an explicit statement of case material for either model. No FLX4- or FLX2-specific teardown was found.
- No FLX2-specific printable stands were surfaced; no GrabCAD/Thangs/Printables STEP model was confirmed for either (search only; the sites themselves were not browsed).
- The firefront.de FLX2 manual is an unofficial copy and should be checked against AlphaTheta's own PDF.

## 7. Mounting concepts that do not modify the controller

### Takeaway
A free-standing rear bridge (goal-post riser) that straddles the controller's rear edge is the most robust non-invasive option and mirrors what commercial laptop stands do; a tray the controller sits in is the most stable but uses the most plastic; a clamp on the rear edge is the smallest but riskiest on a plastic chassis. Commercial stands show the proven pattern: wide feet under or behind the controller, a raised tray, non-slip pads, and flat-folding for transport.

### Cited Findings
- Crane Stand Plus (laptop stand used over DJ gear): folds to about 14 x 14 x 2 in and adjusts from 4 to 13 in high; a sub-tray accessory exists — [zZounds Crane Stand Plus](https://www.zzounds.com/pagearea--61/item--CRNCRNSTDPLUS), [Guitar Center Crane sub-tray](https://www.guitarcenter.com/Crane-Stand/Plus-Subtray-White-1500000484595.gc)
- Headliner Covina two-tier controller + laptop stand: controller tray depth 395 mm, laptop tray depth 295 mm, width adjustable 225-430 mm, non-slip rubber padding; one reviewer found it bulky — [Thomann Headliner Covina](https://ae.thomann.de/headliner_covina_controller_stand.htm), [Best Buy](https://www.bestbuy.com/product/headliner-covina-controller-stand-for-dj-controller-and-laptop-dual-tier-adjustable-stand-with-non-slip-rubber-padding-black/J7LJ567ZJL/sku/11066501), [B&H](https://www.bhphotovideo.com/c/product/1593975-REG/headliner_hl20003_covina_controller_stand.html/overview)
- Pioneer DJ DJC-STS1 stand: folded 340 x 357.3 x 97 mm; minimum height 260 mm with the top panel horizontal — [Woodbrass DJC-STS1](https://www.woodbrass.com/en-it/dj-stands-pioneer-dj-djc-sts1-p259194.html)
- Gator fixed-height desktop laptop/controller stand: 11.75 x 13.25 x 12.25 in, 3 lb — [Musician's Friend Gator stand](https://www.musiciansfriend.com/pro-audio/gator-portable-desktop-laptop-dj-controller-stand-with-fixed-height)
- Auray LTS-TRAY accessory tray for laptop stands: steel, 11.8 x 7.8 in, clamp spacing 32 mm — [PriceCheck Auray LTS-TRAY](https://www.pricecheck.co.za/offers/181955299/Auray+Lts-tray+Accessory+Tray+For+Laptop+Stands)
- Decksaver covers fit over the controller with cables still attached, which constrains anything attached at the rear if the user wants to keep using the cover — [Thomann: Decksaver DDJ-FLX4](https://www.thomann.co.uk/decksaver_pioneer_dj_ddj_flx4.htm)
- Community precedents: a laptop stand that slides under the FLX4 ("Lapt'up"), an angled "inclinator with laptop stand", a phone mount remix, and risers with TPU feet — [MakerWorld 1398110](https://makerworld.com/models/1398110), [MakerWorld 1835295](https://makerworld.com/models/1835295), [MakerWorld 2930023](https://makerworld.com/models/2930023), [MakerWorld 2443775](https://makerworld.com/models/2443775)
- A community-designed printable stand exists for the comparable Traktor Kontrol S3 — [Native Instruments forum](https://community.native-instruments.com/discussion/36092/traktor-kontrol-s3-stand-3d-printable)

### Inferences
Concept comparison (judgement, based on the dimensions in section 6):

| Concept | How it holds | Pros | Cons | Print/bed impact |
|---|---|---|---|---|
| A. Free-standing rear bridge (two feet + cross-beam holding the display above/behind the rear edge) | Own weight; feet extend forward under or beside the controller, optional Kensington-slot tether | Touches nothing sensitive; rear ports stay accessible; works for both controllers by changing span | Needs a stiff beam (488 mm span on FLX4); can tip backward if feet are short | Beam must be split in 2-3 pieces or replaced by an aluminium tube/threaded rod |
| B. Slide-under feet (plate tongues go under the controller so its weight anchors the mount) | Controller's own 2.1 kg / 1.2 kg sits on the tongues | Very stable for little plastic; proven by "Lapt'up" style stands | Raises/tilts controller slightly; must match feet positions | Small parts, fits any bed |
| C. Tray/cradle the controller sits in | Full perimeter location | Most stable; one unit to carry | Largest print (482 x 273 mm footprint), most joints, controller-specific | Four or more pieces |
| D. Clamp on rear edge | Friction/clamp on the chassis lip | Smallest, quick on/off | Loads a plastic edge; risk of marking, blocks rear ports on FLX4; least stable for a 5-7" screen | One small print |
| E. Separate laptop-stand-style arm (or buy a stand and print only a display tray/VESA adapter) | Commercial steel stand carries the load | Least design risk; adjustable height; folds | Costs money; bulkier | Only a small adapter is printed |

- Recommended direction: A + B combined. A rear bridge whose two feet each have a thin (3-4 mm) tongue sliding under the controller's rear corners, so the controller's weight resists tipping, with the display enclosure on a VESA 75 or simple two-bolt tilt bracket on the beam. Fall back to E (print a tray/VESA adapter for a bought stand; the Auray tray's 32 mm clamp spacing is an example of the interface) if stiffness proves hard.
- Stability rule of thumb: keep the display's centre of mass inside the footprint of the feet with margin at the steepest tilt; compute it in code (section 3 gives centre-of-mass calls) and assert the projected CoM lies at least 20 mm inside the support polygon.
- Transport: make the display enclosure detach from the bridge with two thumb screws or a dovetail slide, keep parts under the 14 x 14 x 2 in flat-pack envelope that commercial stands use so it fits a controller bag, and route one captive USB-C/HDMI cable with strain relief. Check whether the user's Decksaver cover still fits with the feet/tongues in place (the cover is only 4 mm wider than the FLX4).
- Vibration: bass and table knocks will shake a tall cantilevered screen. Keep the screen low (just above knob height), use TPU feet, and avoid long thin printed arms.

### Gaps
- No commercial product specifically for mounting a small display on a DDJ-FLX2/FLX4 was found, and no dimensions for the Crane Stand "Elite" model.
- No measured data on how far the FLX4/FLX2 rubber feet sit from the edges or the ground clearance under the chassis, which determines whether slide-under tongues fit; must be measured.
- No source quantifies tipping or stiffness for printed stands; the comparison table is engineering judgement.
- Tablet-holder clamp products were not researched.

## 8. Outsourcing fabrication without a printer

### Takeaway
A university makerspace is almost certainly the cheapest route (material cost for a PETG enclosure of this size is a few euros). Online, JLC3DP and PCBWay are the low-cost Chinese options and Craftcloud is a price-comparison marketplace; expect roughly USD 50-75 for a 300 x 100 x 60 mm shell in MJF PA12 at JLC3DP's published per-gram rate before shipping, with large variation between services, so quote the real file at several.

### Cited Findings
- JLC3DP cut MJF PA12 to $0.275/g (from $0.35/g) effective 13 August 2025, prices excluding tax, applied automatically in the instant quote — [JLC3DP pricing announcement](https://jlc3dp.com/blog/drastic-material-price-cuts-and-adjusted-post-processing-service-fees)
- JLC3DP advertises instant quotes starting at $0.30 (another of its pages says $1.00); final price depends on technology, material, size, quantity and finishing — [JLC3DP](https://jlc3dp.com/)
- PCBWay offers 3D printing with among the largest build sizes of the Chinese platforms (PCBWay and Unionfab up to 2100 x 700 x 800 mm); JLC prices post-processing as a percentage of the part — [Unionfab: JLC vs PCBWay vs RapidDirect vs Unionfab (2026)](https://www.unionfab.com/blog/2026/03/jlc-vs-pcbway-vs-rapiddirect-vs-unionfab)
- Craftcloud is a marketplace that "automatically provides you with quotes, compares prices, materials, technologies, and lead times in real time" across many manufacturers — [All3DP: best cheap 3D printing services (tested)](https://all3dp.com/2/best-cheap-3d-printing-services/)
- All3DP quoted 10 parts across services and found no universal price per gram or per cm3; examples included an FDM PETG cosplay prop at about $119.70 before shipping and an MJF Nylon 12 drone component at about $126.84 total — [All3DP: real 3D printing service costs](https://all3dp.com/1/uncover-real-3d-printing-service-costs/)
- All3DP also publishes MJF price comparisons across five sample projects and a hobbyist-service roundup — [All3DP: MJF price comparison](https://all3dp.com/1/mjf-3d-printing-price-comparison-charts-5-sample-projects/), [All3DP: services for hobbyists](https://all3dp.com/2/best-3d-printing-services-for-hobbyists/)
- Raw PETG filament averages about EUR 19.38/kg; post-processing is about 18% of a polymer part's full cost per the Wohlers Report 2026 — [printer-hub: 3D printing service prices](https://printer-hub.ru/en/posts/3d-printing-service-prices)
- JLC3DP has its own guide to splitting large prints for quality and assembly — [JLC3DP blog: splitting large prints](https://jlc3dp.com/blog/how-to-split-large-3d-prints-for-better-quality-and-asembly)

### Inferences
- Worked estimate for a 300 x 100 x 60 mm enclosure with 2.4 mm walls: closed six-sided shell surface is 108,000 mm2, so about 259 cm3 of material; an open-top tray is about 78,000 mm2, so about 187 cm3. In MJF PA12 (about 1.01 g/cm3, bk) that is roughly 190-260 g, i.e. about USD 52-72 at $0.275/g before shipping, tax and any minimum fees. In PETG (1.27 g/cm3) it is about 240-330 g, i.e. only about EUR 5-6.50 of filament if printed on a makerspace machine. Bosses and ribs add 10-20%.
- For outsourced FDM, services usually price on material volume plus machine time and a bounding-box factor; a 300 mm part also exceeds many hobby-class beds, so splitting it (section 5) can lower both price and shipping. Ask for PETG or ASA explicitly; the cheapest default is often PLA.
- MJF/SLS nylon is a good outsourced choice for the load-bearing bridge: isotropic strength, heat resistance well above PETG, no support marks, and it can be made in one piece because industrial build volumes exceed 300 mm. Use FDM PETG (makerspace) for the cosmetic display shell where iteration matters.
- Upload STEP rather than STL when a service accepts it (better for their quoting and for MJF), which again favours an OCCT-based code-CAD tool.
- Recommended order for the student: (1) university makerspace or library printer; (2) a friend/local maker via a community network; (3) JLC3DP or PCBWay for cheap overseas parts when 1-2 weeks' lead time is acceptable; (4) Craftcloud to compare local vendors when speed matters.

### Gaps
- No current JLC3DP or PCBWay per-gram price for FDM PETG was found, and the MJF figure dates from August 2025.
- No real quote was obtained for a 300 x 100 x 60 mm part from any service; the numbers above are calculated from one published rate and assumed densities, and exclude shipping (not researched).
- Shapeways' current status and pricing were not researched in this session.
- University makerspace availability and pricing depend on the student's institution and were not researched.
