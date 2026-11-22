"""Build the draft bridge for one or both controllers and write STEP, STL and SVG files.

Run from the ``hardware`` folder::

    .venv/bin/python build.py --draft [--controller flx2|flx4|all]
        [--display display_bar_11in] [--bed 250] [--out out]

Without ``--draft`` the script needs fully measured parameter files and exits
with code 2 (writing nothing) while any measurement is missing.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from build123d import (  # noqa: E402
    Align,
    Box,
    Compound,
    ExportSVG,
    LineType,
    Part,
    Pos,
    export_step,
    export_stl,
)

from trackstar_hw import (  # noqa: E402
    MissingMeasurements,
    build_bridge,
    load_controller,
    load_display,
)
from trackstar_hw.params import Controller  # noqa: E402

CONTROLLERS = ('flx2', 'flx4')


def _controller_body(controller: Controller) -> Part:
    """Return a plain box for the controller body, for the preview drawing."""
    z0 = controller.rear_gap_mm
    height = controller.top_panel_height_mm - z0
    return Pos(0, 0, z0) * Box(
        controller.width_mm,
        controller.depth_mm,
        height,
        align=(Align.MIN, Align.MIN, Align.MIN),
    )


def _write_preview(controller: Controller, parts: dict[str, Part], path: Path) -> None:
    """Write a line drawing of the bridge together with the controller body."""
    scene = Compound(children=[*parts.values(), _controller_body(controller)])
    look_at = (controller.width_mm / 2, controller.depth_mm / 2, 20)
    visible, hidden = scene.project_to_viewport((-420, -620, 430), viewport_up=(0, 0, 1), look_at=look_at)
    svg = ExportSVG(scale=1.6, margin=10)
    svg.add_layer('visible', line_weight=0.5)
    svg.add_layer('hidden', line_weight=0.2, line_type=LineType.ISO_DOT)
    svg.add_shape(visible, layer='visible')
    svg.add_shape(hidden, layer='hidden')
    svg.write(str(path))


def main(argv: list[str] | None = None) -> int:
    """Run the build. Returns 0 on success and 2 when measurements are missing."""
    parser = argparse.ArgumentParser(description='Build the draft controller bridge.')
    parser.add_argument('--draft', action='store_true', help='allow placeholder dimensions (never print the result)')
    parser.add_argument('--controller', choices=(*CONTROLLERS, 'all'), default='all')
    parser.add_argument('--display', default='display_bar_11in')
    parser.add_argument('--bed', type=float, default=250, help='printer bed size in mm')
    parser.add_argument('--out', default='out', help='output folder, relative to the hardware folder')
    args = parser.parse_args(argv)

    out = Path(args.out)
    if not out.is_absolute():
        out = HERE / out
    names = CONTROLLERS if args.controller == 'all' else (args.controller,)

    try:
        display = load_display(args.display, draft=args.draft)
        controllers = [load_controller(name, draft=args.draft) for name in names]
    except MissingMeasurements as error:
        print(error, file=sys.stderr)
        return 2

    out.mkdir(parents=True, exist_ok=True)
    placeholders: list[str] = []
    for name, controller in zip(names, controllers):
        parts = build_bridge(controller, display, bed_mm=args.bed, draft=args.draft)
        for part_name, part in parts.items():
            export_step(part, str(out / f'{name}_{part_name}.step'))
            export_stl(part, str(out / f'{name}_{part_name}.stl'))
            size = part.bounding_box().size
            print(
                f'{name} {part_name}: {size.X:.1f} x {size.Y:.1f} x {size.Z:.1f} mm, '
                f'{part.volume / 1000:.1f} cm3'
            )
        _write_preview(controller, parts, out / f'{name}_preview.svg')
        for field in (*controller.placeholders, *display.placeholders):
            if field not in placeholders:
                placeholders.append(field)
    if placeholders:
        print(
            f'DRAFT: built from placeholder dimensions ({", ".join(placeholders)}). '
            'Do not print these parts.'
        )
    elif args.draft:
        print('DRAFT: every dimension in the parameter files is measured, but the bridge design itself is a first draft.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
