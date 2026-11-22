"""Draft model of the bridge that carries a bar display above a DJ controller.

The bridge has two feet that stand on the desk beside the controller, with a
thin tongue that slides under each side of the controller, two uprights bolted
to the feet, and a crossbar that spans the uprights above the rear edge of the
controller. The crossbar is split into segments with half-lap joints so that
every part fits on a printer bed.

Coordinate frame, in millimetres: the controller sits on the desk, ``x`` runs
from 0 (left side) to ``controller.width_mm`` (right side), ``y`` from 0 (front
edge, where the DJ stands) to ``controller.depth_mm`` (rear edge), and ``z`` up
from the desk at 0. Parts are returned in their assembled positions.

This is a DRAFT. The dimensions of the bridge are placeholders, and the
controller and display values may be placeholders too. Nothing built here is
meant to be printed until the real measurements are in (task H7).
"""

from __future__ import annotations

from build123d import Align, Box, Cylinder, Part, Pos

from .params import Controller, Display

SIDE_CLEARANCE = 2.0  # gap between a controller side and the upright next to it
TOP_CLEARANCE = 10.0  # gap between the tallest control and the underside of the crossbar
TONGUE_CLEARANCE = 0.5  # the tongue is this much thinner than the gap under the controller
MAX_TONGUE = 3.0  # the tongue is never thicker than this
MIN_TONGUE = 1.2  # thinner than this cannot be printed usefully
UPRIGHT_X = 14.0  # upright thickness across the bridge
UPRIGHT_Y = 24.0  # upright depth, front to back (also the crossbar depth)
FOOT_T = 6.0  # thickness of the foot plate on the desk
FOOT_OUT = 30.0  # how far the foot plate reaches outward beyond the upright
FOOT_Y = 70.0  # foot plate depth, front to back
TONGUE_LEN = 45.0  # how far the tongue reaches under the controller
BAR_Z = 16.0  # crossbar height
LAP = 24.0  # length of the half-lap joint between two crossbar segments
REAR_INSET = 6.0  # the rear face of the uprights is this far in front of the controller's rear edge
BOLT_D = 3.4  # clearance hole for an M3 bolt
INSERT_D = 4.0  # hole for an M3 heat-set insert (PROJECT.md 4.5)
INSERT_DEPTH = 6.0  # insert length 5 plus 1
PIN_D = 3.3  # hole for a 3 mm alignment pin, sliding fit
PIN_DEPTH = 4.0  # depth of a blind alignment pin hole
HOLE_EDGE = 6.0  # distance of a bolt hole from the front or rear face of an upright
BED_MARGIN = 5.0  # parts stay this much smaller than the printer bed
DISPLAY_MARGIN = 20.0  # the crossbar must be at least this much longer than the display is wide

_MIN = (Align.MIN, Align.MIN, Align.MIN)
_EPS = 1e-6


def _box(x0: float, x1: float, y0: float, y1: float, z0: float, z1: float) -> Part:
    """Return an axis-aligned box from its six limits."""
    return Pos(x0, y0, z0) * Box(x1 - x0, y1 - y0, z1 - z0, align=_MIN)


def _zhole(x: float, y: float, z0: float, z1: float, d: float) -> Part:
    """Return a vertical cylinder of diameter ``d``, for cutting a hole."""
    return Pos(x, y, z0) * Cylinder(d / 2, z1 - z0, align=(Align.CENTER, Align.CENTER, Align.MIN))


def crossbar_segment_count(length_mm: float, bed_mm: float) -> int:
    """Return the fewest crossbar segments that all fit on a bed of ``bed_mm``.

    A segment is ``length / n`` long plus its joint halves: none for a single
    piece, half a lap for each of the two end pieces, a full lap for a middle
    piece. Raises ``ValueError`` when the bed is too small for any segment.
    """
    usable = bed_mm - BED_MARGIN
    if usable <= LAP:
        raise ValueError(f'a bed of {bed_mm} mm is too small: no crossbar segment can fit')
    n = 1
    while True:
        extra = 0.0 if n == 1 else LAP / 2 if n == 2 else LAP
        if length_mm / n + extra <= usable:
            return n
        n += 1


def controller_envelope(controller: Controller) -> Part:
    """Return the box the bridge must stay out of: the controller body and its controls."""
    top = max(controller.height_mm, controller.tallest_control_height_mm)
    return _box(0, controller.width_mm, 0, controller.depth_mm, controller.rear_gap_mm, top)


def _placeholder_names(controller: Controller, display: Display) -> list[str]:
    return list(controller.placeholders) + list(display.placeholders)


def _side(
    ux0: float,
    ux1: float,
    plate: tuple[float, float],
    tongue: tuple[float, float],
    yu0: float,
    yu1: float,
    yf0: float,
    yf1: float,
    depth: float,
    tongue_t: float,
    zbar: float,
) -> tuple[Part, Part]:
    """Build the foot and the upright of one side."""
    uxc = (ux0 + ux1) / 2
    yc = (yu0 + yu1) / 2
    foot = _box(plate[0], plate[1], yf0, yf1, 0, FOOT_T) + _box(
        tongue[0], tongue[1], yf0, min(yf1, depth), 0, tongue_t
    )
    upright = _box(ux0, ux1, yu0, yu1, FOOT_T, zbar)
    for y in (yu0 + HOLE_EDGE, yu1 - HOLE_EDGE):
        foot = foot - _zhole(uxc, y, 0, FOOT_T, BOLT_D)
        upright = upright - _zhole(uxc, y, FOOT_T, FOOT_T + INSERT_DEPTH, INSERT_D)
        upright = upright - _zhole(uxc, y, zbar - INSERT_DEPTH, zbar, INSERT_D)
    foot = foot - _zhole(uxc, yc, FOOT_T - PIN_DEPTH, FOOT_T, PIN_D)
    upright = upright - _zhole(uxc, yc, FOOT_T, FOOT_T + PIN_DEPTH, PIN_D)
    upright = upright - _zhole(uxc, yc, zbar - PIN_DEPTH, zbar, PIN_D)
    return foot, upright


def build_bridge(
    controller: Controller,
    display: Display,
    bed_mm: float = 250,
    draft: bool = True,
) -> dict[str, Part]:
    """Build the bridge parts in their assembled positions.

    Returns ``foot_left``, ``upright_left``, ``foot_right``, ``upright_right``
    and then ``crossbar_1`` to ``crossbar_n``. Raises ``ValueError`` when
    ``draft`` is False and any dimension is a placeholder, when the gap under
    the controller is too small for a tongue, when the display does not fit on
    the crossbar, or when a part is larger than the bed.
    """
    if not draft and (controller.is_draft or display.is_draft):
        names = ', '.join(_placeholder_names(controller, display))
        raise ValueError(
            'print-ready parts cannot be built from placeholder dimensions; '
            f'these fields are placeholders: {names}'
        )
    tongue_t = min(MAX_TONGUE, controller.rear_gap_mm - TONGUE_CLEARANCE)
    if tongue_t < MIN_TONGUE:
        raise ValueError(
            f'the gap under the controller ({controller.rear_gap_mm} mm) is too small for a tongue '
            f'of at least {MIN_TONGUE} mm'
        )
    width, depth = controller.width_mm, controller.depth_mm
    zbar = controller.tallest_control_height_mm + TOP_CLEARANCE
    yu1 = depth - REAR_INSET
    yu0 = yu1 - UPRIGHT_Y
    yc = (yu0 + yu1) / 2
    yf0, yf1 = yc - FOOT_Y / 2, yc + FOOT_Y / 2
    xl0 = -SIDE_CLEARANCE - UPRIGHT_X
    xr1 = width + SIDE_CLEARANCE + UPRIGHT_X
    length = xr1 - xl0
    if length < display.outer_width_mm + DISPLAY_MARGIN:
        raise ValueError(
            f'the display ({display.outer_width_mm} mm wide) does not fit on a crossbar '
            f'of {length} mm: it needs {DISPLAY_MARGIN} mm to spare'
        )

    common = (yu0, yu1, yf0, yf1, depth, tongue_t, zbar)
    lx0, lx1 = xl0, -SIDE_CLEARANCE
    foot_l, up_l = _side(
        lx0, lx1, (lx0 - FOOT_OUT, lx1), (lx1, TONGUE_LEN), *common
    )
    rx0, rx1 = width + SIDE_CLEARANCE, xr1
    foot_r, up_r = _side(
        rx0, rx1, (rx0, rx1 + FOOT_OUT), (width - TONGUE_LEN, rx0), *common
    )
    parts: dict[str, Part] = {
        'foot_left': foot_l,
        'upright_left': up_l,
        'foot_right': foot_r,
        'upright_right': up_r,
    }

    n = crossbar_segment_count(length, bed_mm)
    edges = [xl0 + length * k / n for k in range(n)] + [xr1]
    half, quarter, mid = LAP / 2, LAP / 4, BAR_Z / 2
    centres = (xl0 + UPRIGHT_X / 2, xr1 - UPRIGHT_X / 2)
    for k in range(n):
        a = edges[k] + (half if k > 0 else 0)
        b = edges[k + 1] - (half if k < n - 1 else 0)
        seg = _box(a, b, yu0, yu1, zbar, zbar + BAR_Z)
        if k < n - 1:
            seg = seg + _box(edges[k + 1] - half, edges[k + 1] + half, yu0, yu1, zbar, zbar + mid)
        if k > 0:
            seg = seg + _box(edges[k] - half, edges[k] + half, yu0, yu1, zbar + mid, zbar + BAR_Z)
        joints = ([edges[k + 1]] if k < n - 1 else []) + ([edges[k]] if k > 0 else [])
        for xj in joints:
            for x in (xj - quarter, xj + quarter):
                seg = seg - _zhole(x, yc, zbar, zbar + BAR_Z, BOLT_D)
            seg = seg - _zhole(xj, yu0 + HOLE_EDGE, zbar, zbar + BAR_Z, PIN_D)
        for uxc in centres:
            if a <= uxc <= b:
                for y in (yu0 + HOLE_EDGE, yu1 - HOLE_EDGE):
                    seg = seg - _zhole(uxc, y, zbar, zbar + BAR_Z, BOLT_D)
                seg = seg - _zhole(uxc, yc, zbar, zbar + PIN_DEPTH, PIN_D)
        parts[f'crossbar_{k + 1}'] = seg

    for name, part in parts.items():
        size = part.bounding_box().size
        if max(size.X, size.Y, size.Z) > bed_mm + _EPS:
            raise ValueError(f'part {name} is larger than the {bed_mm} mm bed')
    return parts
