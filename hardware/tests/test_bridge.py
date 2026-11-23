"""Tests for trackstar_hw.bridge and the build.py script."""

from __future__ import annotations

import copy
import importlib.util
import itertools
import subprocess
import sys
from pathlib import Path
from typing import Any

HARDWARE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HARDWARE_DIR))

import pytest  # noqa: E402
import yaml  # noqa: E402
from build123d import Align, Box, Cylinder, Part, Pos  # noqa: E402

from trackstar_hw.bridge import (  # noqa: E402
    build_bridge,
    controller_envelope,
    crossbar_segment_count,
)
from trackstar_hw.params import (  # noqa: E402
    PARAMS_DIR,
    Controller,
    Display,
    load_controller,
    load_display,
)

# The design values are written out here on purpose: importing them from the
# module would let a changed constant pass its own test.
SIDE_CLEARANCE = 2.0
TOP_CLEARANCE = 10.0
TONGUE_CLEARANCE = 0.5
MAX_TONGUE = 3.0
FOOT_T = 6.0
LAP = 24.0
BAR_Z = 16.0
TONGUE_LEN = 45.0
BASE_KEYS = ['foot_left', 'upright_left', 'foot_right', 'upright_right']
FULL_CONTROLLER_MEASURED: dict[str, Any] = {
    'rear_gap_mm': 3.2,
    'foot_height_mm': 5.5,
    'foot_positions_mm': [[20.0, 20.0], [360.0, 20.0], [20.0, 190.0], [360.0, 190.0]],
    'top_panel_height_mm': 40.0,
    'tallest_control_height_mm': 46.5,
    'usb_c_port_mm': {'x': 100.0, 'z': 10.0, 'width': 9.0, 'height': 3.5},
    'kensington_slot_mm': {'x': 300.0, 'z': 10.0, 'width': 7.0, 'height': 3.0},
    'left_jacks_mm': [{'y': 50.0, 'z': 20.0, 'diameter': 6.0}],
    'corner_radius_mm': 9.5,
}
FULL_DISPLAY_MEASURED: dict[str, Any] = {
    'outer_width_mm': 295.0,
    'outer_height_mm': 78.0,
    'thickness_mm': 11.0,
    'active_width_mm': 278.8,
    'active_height_mm': 63.9,
    'connector_positions_mm': [{'name': 'usb-c', 'x': 10.0, 'z': 5.0}],
    'mounting_holes_mm': [[10.0, 10.0], [280.0, 10.0]],
}


def shipped(name: str) -> dict[str, Any]:
    return yaml.safe_load((PARAMS_DIR / (name + '.yaml')).read_text(encoding='utf-8'))


def write(tmp_path: Path, data: dict[str, Any], name: str) -> Path:
    path = tmp_path / name
    path.write_text(yaml.safe_dump(data, sort_keys=False), encoding='utf-8')
    return path


def controller_with(tmp_path: Path, **measured: Any) -> Controller:
    data = shipped('flx2')
    data['measured'].update(measured)
    return load_controller(write(tmp_path, data, 'c.yaml'), draft=True)


def box(x0: float, x1: float, y0: float, y1: float, z0: float, z1: float) -> Part:
    return Pos(x0, y0, z0) * Box(x1 - x0, y1 - y0, z1 - z0, align=(Align.MIN, Align.MIN, Align.MIN))


def vcyl(x: float, y: float, z0: float, z1: float, d: float) -> Part:
    return Pos(x, y, z0) * Cylinder(d / 2, z1 - z0, align=(Align.CENTER, Align.CENTER, Align.MIN))


def longest(part: Part) -> float:
    size = part.bounding_box().size
    return max(size.X, size.Y, size.Z)


@pytest.fixture(scope='module')
def display() -> Display:
    return load_display('display_bar_11in', draft=True)


@pytest.fixture(scope='module')
def flx2() -> Controller:
    return load_controller('flx2', draft=True)


@pytest.fixture(scope='module')
def flx4() -> Controller:
    return load_controller('flx4', draft=True)


@pytest.fixture(scope='module')
def bridge2(flx2: Controller, display: Display) -> dict[str, Part]:
    return build_bridge(flx2, display)


@pytest.fixture(scope='module')
def bridge4(flx4: Controller, display: Display) -> dict[str, Part]:
    return build_bridge(flx4, display)


@pytest.fixture(scope='module')
def cases(flx2, flx4, bridge2, bridge4) -> list[tuple[Controller, dict[str, Part]]]:
    return [(flx2, bridge2), (flx4, bridge4)]


def crossbars(parts: dict[str, Part]) -> list[Part]:
    return [p for k, p in parts.items() if k.startswith('crossbar_')]


# 1 -------------------------------------------------------------------------
def test_keys_and_order(bridge2, bridge4) -> None:
    assert list(bridge2) == BASE_KEYS + ['crossbar_1', 'crossbar_2']
    assert list(bridge4) == BASE_KEYS + ['crossbar_1', 'crossbar_2', 'crossbar_3']


# 2 -------------------------------------------------------------------------
def test_parts_are_valid_single_solids(cases) -> None:
    for _, parts in cases:
        for name, part in parts.items():
            assert part.is_valid, name
            assert len(part.solids()) == 1, name
            assert part.volume > 0, name


# 3 -------------------------------------------------------------------------
def test_parts_fit_the_bed(cases, flx2, flx4, display) -> None:
    for _, parts in cases:
        for name, part in parts.items():
            assert longest(part) <= 250, name
    small = build_bridge(flx2, display, bed_mm=180)
    assert len(crossbars(small)) == 3
    for name, part in small.items():
        assert longest(part) <= 180, name
    tiny = build_bridge(flx2, display, bed_mm=120)
    for name, part in tiny.items():
        assert longest(part) <= 120, name
    # The joint allowance matters here: a plain half span of 257 would be too long.
    mid = build_bridge(flx4, display, bed_mm=262)
    assert len(crossbars(mid)) == 3
    for name, part in mid.items():
        assert longest(part) <= 262, name
    with pytest.raises(ValueError):
        build_bridge(flx2, display, bed_mm=80)


# 4 -------------------------------------------------------------------------
def test_span_and_crossbar_height(cases) -> None:
    for c, parts in cases:
        gap = parts['upright_right'].bounding_box().min.X - parts['upright_left'].bounding_box().max.X
        assert gap == pytest.approx(c.width_mm + 2 * SIDE_CLEARANCE, abs=1e-6)
        for bar in crossbars(parts):
            assert bar.bounding_box().min.Z == pytest.approx(c.tallest_control_height_mm + TOP_CLEARANCE, abs=1e-6)


# 5 -------------------------------------------------------------------------
def under_controller(foot: Part, c: Controller) -> Part:
    return foot & box(0, c.width_mm, 0, c.depth_mm, 0, 100)


def test_tongue_thickness_and_reach(cases) -> None:
    for c, parts in cases:
        for key in ('foot_left', 'foot_right'):
            tongue = under_controller(parts[key], c)
            assert tongue.volume > 0
            top = tongue.bounding_box().max.Z
            assert top <= c.rear_gap_mm - TONGUE_CLEARANCE + 1e-9
            assert top <= MAX_TONGUE + 1e-9
            assert tongue.bounding_box().size.X == pytest.approx(TONGUE_LEN, abs=1e-6)


def test_tongue_follows_measured_gap(tmp_path, display) -> None:
    c = controller_with(tmp_path, rear_gap_mm=2.5)
    parts = build_bridge(c, display)
    for key in ('foot_left', 'foot_right'):
        assert under_controller(parts[key], c).bounding_box().max.Z == pytest.approx(2.0, abs=1e-6)
    thin = controller_with(tmp_path, rear_gap_mm=1.5)
    with pytest.raises(ValueError, match='gap'):
        build_bridge(thin, display)


# 6 -------------------------------------------------------------------------
def test_no_parts_intersect(cases) -> None:
    for _, parts in cases:
        for (na, a), (nb, b) in itertools.combinations(parts.items(), 2):
            assert (a & b).volume < 1e-6, (na, nb)


# 7 -------------------------------------------------------------------------
def test_envelope_limits(cases) -> None:
    for c, _ in cases:
        bb = controller_envelope(c).bounding_box()
        assert (bb.min.X, bb.max.X) == pytest.approx((0, c.width_mm), abs=1e-6)
        assert (bb.min.Y, bb.max.Y) == pytest.approx((0, c.depth_mm), abs=1e-6)
        assert bb.min.Z == pytest.approx(c.rear_gap_mm, abs=1e-6)
        assert bb.max.Z == pytest.approx(max(c.height_mm, c.tallest_control_height_mm), abs=1e-6)


def test_parts_stay_out_of_the_controller(cases) -> None:
    for c, parts in cases:
        envelope = controller_envelope(c)
        for name, part in parts.items():
            assert (part & envelope).volume < 1e-6, name


# 8 -------------------------------------------------------------------------
def test_left_right_mirror(cases) -> None:
    for _, parts in cases:
        for a, b in (('foot_left', 'foot_right'), ('upright_left', 'upright_right')):
            assert parts[a].volume == pytest.approx(parts[b].volume, rel=1e-6)
        bars = crossbars(parts)
        assert bars[0].bounding_box().min.X == pytest.approx(parts['upright_left'].bounding_box().min.X, abs=1e-6)
        assert bars[-1].bounding_box().max.X == pytest.approx(parts['upright_right'].bounding_box().max.X, abs=1e-6)


def test_feet_are_mirror_images_in_position(cases) -> None:
    for c, parts in cases:
        left = parts['foot_left'].bounding_box()
        right = parts['foot_right'].bounding_box()
        assert left.min.X + right.max.X == pytest.approx(c.width_mm, abs=1e-6)
        assert (left.min.Y, left.max.Y) == pytest.approx((right.min.Y, right.max.Y), abs=1e-6)


# 9 -------------------------------------------------------------------------
def test_joints(cases) -> None:
    for _, parts in cases:
        bars = crossbars(parts)
        for left, right in zip(bars, bars[1:]):
            bl, bright = left.bounding_box(), right.bounding_box()
            assert bl.max.X - bright.min.X == pytest.approx(LAP, abs=1e-6)
            assert (left & right).volume < 1e-6
            xj = (bl.max.X + bright.min.X) / 2
            y = (bl.min.Y + bl.max.Y) / 2
            z0 = bl.min.Z - 1
            for x in (xj - LAP / 4, xj + LAP / 4):
                probe = vcyl(x, y, z0, z0 + BAR_Z + 2, 3.0)
                assert (probe & left).volume == 0
                assert (probe & right).volume == 0
                moved = vcyl(x, y + 8, z0, z0 + BAR_Z + 2, 3.0)
                assert (moved & left).volume > 0
                assert (moved & right).volume > 0


# 10 ------------------------------------------------------------------------
def test_uprights_stand_on_feet_and_carry_crossbar(cases) -> None:
    for _, parts in cases:
        bar_z = min(b.bounding_box().min.Z for b in crossbars(parts))
        for side in ('left', 'right'):
            up = parts['upright_' + side].bounding_box()
            foot = parts['foot_' + side].bounding_box()
            assert up.min.Z == pytest.approx(FOOT_T, abs=1e-6)
            assert up.max.Z == pytest.approx(bar_z, abs=1e-6)
            assert foot.min.X <= up.min.X + 1e-9 and up.max.X <= foot.max.X + 1e-9
            assert foot.min.Y <= up.min.Y + 1e-9 and up.max.Y <= foot.max.Y + 1e-9


# 11 ------------------------------------------------------------------------
def test_segment_count() -> None:
    assert crossbar_segment_count(415.2, 250) == 2
    assert crossbar_segment_count(514.0, 250) == 3
    assert crossbar_segment_count(200, 250) == 1
    assert crossbar_segment_count(415.2, 180) == 3
    # Half a joint on each side of a pair: 240 + 12 does not fit 245.
    assert crossbar_segment_count(480, 250) == 3
    assert crossbar_segment_count(514.0, 262) == 3
    with pytest.raises(ValueError):
        crossbar_segment_count(100, 29)


# 12 ------------------------------------------------------------------------
def test_draft_flag(flx2, display, tmp_path) -> None:
    with pytest.raises(ValueError, match='rear_gap_mm'):
        build_bridge(flx2, display, draft=False)
    cdata = shipped('flx2')
    cdata['measured'] = copy.deepcopy(FULL_CONTROLLER_MEASURED)
    ddata = shipped('display_bar_11in')
    ddata['measured'] = copy.deepcopy(FULL_DISPLAY_MEASURED)
    c = load_controller(write(tmp_path, cdata, 'c.yaml'))
    d = load_display(write(tmp_path, ddata, 'd.yaml'))
    assert not c.is_draft and not d.is_draft
    parts = build_bridge(c, d, draft=False)
    assert len(parts) == 6
    # A draft display alone is enough to refuse.
    with pytest.raises(ValueError, match='outer_width_mm'):
        build_bridge(c, display, draft=False)


# 13 ------------------------------------------------------------------------
def test_display_must_fit(flx2, tmp_path) -> None:
    ddata = shipped('display_bar_11in')
    ddata['measured']['outer_width_mm'] = 600
    wide = load_display(write(tmp_path, ddata, 'd.yaml'), draft=True)
    with pytest.raises(ValueError, match='display'):
        build_bridge(flx2, wide)


# 14 ------------------------------------------------------------------------
def load_build_script() -> Any:
    spec = importlib.util.spec_from_file_location('trackstar_build', HARDWARE_DIR / 'build.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


PART_NAMES = BASE_KEYS + ['crossbar_1', 'crossbar_2']


def test_build_script_draft(tmp_path, capsys) -> None:
    script = load_build_script()
    assert script.main(['--draft', '--controller', 'flx2', '--out', str(tmp_path)]) == 0
    for name in PART_NAMES:
        for ext in ('step', 'stl'):
            f = tmp_path / f'flx2_{name}.{ext}'
            assert f.is_file() and f.stat().st_size > 0, f
    svg = tmp_path / 'flx2_preview.svg'
    assert '<svg' in svg.read_text(encoding='utf-8')
    out = capsys.readouterr().out
    assert 'DRAFT: built from placeholder dimensions' in out
    assert 'Do not print these parts.' in out
    assert 'crossbar_2' in out


def test_build_script_refuses_without_draft(tmp_path, capsys) -> None:
    script = load_build_script()
    target = tmp_path / 'x'
    assert script.main(['--controller', 'flx2', '--out', str(target)]) == 2
    assert 'H7' in capsys.readouterr().err
    assert not target.exists() or not any(target.iterdir())


def test_build_script_as_process(tmp_path) -> None:
    result = subprocess.run(
        [sys.executable, 'build.py', '--draft', '--controller', 'flx4', '--out', str(tmp_path)],
        cwd=HARDWARE_DIR,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    for name in BASE_KEYS + ['crossbar_1', 'crossbar_2', 'crossbar_3']:
        assert (tmp_path / f'flx4_{name}.step').stat().st_size > 0
        assert (tmp_path / f'flx4_{name}.stl').stat().st_size > 0


# Positions and holes --------------------------------------------------------
# More design values, written out for the same reason as above.
UPRIGHT_X = 14.0
UPRIGHT_Y = 24.0
REAR_INSET = 6.0
FOOT_Y = 70.0
FOOT_OUT = 30.0
HOLE_EDGE = 6.0
INSERT_DEPTH = 6.0
PIN_DEPTH = 4.0


def is_hole(part: Part, x: float, y: float, z0: float, z1: float) -> bool:
    """True when a thin vertical probe along this axis meets no material."""
    return (vcyl(x, y, z0, z1, 2.0) & part).volume < 1e-9


def is_material(part: Part, x: float, y: float, z0: float, z1: float) -> bool:
    """True when a thin vertical probe along this axis lies in material."""
    return (vcyl(x, y, z0, z1, 1.0) & part).volume > 0


def test_bridge_sits_at_the_rear_edge(cases) -> None:
    for controller, parts in cases:
        width, depth = controller.width_mm, controller.depth_mm
        y_rear = depth - REAR_INSET
        y_front = y_rear - UPRIGHT_Y
        for name in ('upright_left', 'upright_right', *[k for k in parts if k.startswith('crossbar_')]):
            bb = parts[name].bounding_box()
            assert bb.max.Y == pytest.approx(y_rear, abs=1e-6), name
            assert bb.min.Y == pytest.approx(y_front, abs=1e-6), name
        for name in ('foot_left', 'foot_right'):
            bb = parts[name].bounding_box()
            assert bb.size.Y == pytest.approx(FOOT_Y, abs=1e-6)
            assert (bb.min.Y + bb.max.Y) / 2 == pytest.approx((y_front + y_rear) / 2, abs=1e-6)
        outer = SIDE_CLEARANCE + UPRIGHT_X + FOOT_OUT
        assert parts['foot_left'].bounding_box().min.X == pytest.approx(-outer, abs=1e-6)
        assert parts['foot_right'].bounding_box().max.X == pytest.approx(width + outer, abs=1e-6)


def test_bolt_insert_and_pin_holes(cases) -> None:
    for controller, parts in cases:
        width, depth = controller.width_mm, controller.depth_mm
        zbar = controller.tallest_control_height_mm + TOP_CLEARANCE
        y_rear = depth - REAR_INSET
        y_front = y_rear - UPRIGHT_Y
        yc = (y_front + y_rear) / 2
        bars = crossbars(parts)
        sides = (
            ('left', -SIDE_CLEARANCE - UPRIGHT_X / 2, bars[0]),
            ('right', width + SIDE_CLEARANCE + UPRIGHT_X / 2, bars[-1]),
        )
        for side, x, bar in sides:
            foot = parts[f'foot_{side}']
            upright = parts[f'upright_{side}']
            for y in (y_front + HOLE_EDGE, y_rear - HOLE_EDGE):
                # a bolt goes up through the foot into an insert in the bottom of the upright
                assert is_hole(foot, x, y, 0.1, FOOT_T - 0.1)
                assert is_hole(upright, x, y, FOOT_T + 0.1, FOOT_T + INSERT_DEPTH - 0.1)
                assert is_material(upright, x, y, FOOT_T + INSERT_DEPTH + 0.5, FOOT_T + INSERT_DEPTH + 2)
                # a bolt goes down through the crossbar into an insert in the top of the upright
                assert is_hole(bar, x, y, zbar + 0.1, zbar + BAR_Z - 0.1)
                assert is_hole(upright, x, y, zbar - INSERT_DEPTH + 0.1, zbar - 0.1)
                assert is_material(upright, x, y, zbar - INSERT_DEPTH - 2, zbar - INSERT_DEPTH - 0.5)
                # and the parts are solid 5 mm to the side of each hole
                assert is_material(foot, x + 5, y, 0.1, FOOT_T - 0.1)
                assert is_material(upright, x + 5, y, FOOT_T + 0.1, FOOT_T + INSERT_DEPTH - 0.1)
                assert is_material(bar, x + 5, y, zbar + 0.1, zbar + BAR_Z - 0.1)
            # alignment pins: blind holes that face each other
            assert is_hole(foot, x, yc, FOOT_T - PIN_DEPTH + 0.1, FOOT_T - 0.1)
            assert is_material(foot, x, yc, 0.1, FOOT_T - PIN_DEPTH - 0.1)
            assert is_hole(upright, x, yc, FOOT_T + 0.1, FOOT_T + PIN_DEPTH - 0.1)
            assert is_material(upright, x, yc, FOOT_T + PIN_DEPTH + 0.5, FOOT_T + PIN_DEPTH + 2)
            assert is_hole(upright, x, yc, zbar - PIN_DEPTH + 0.1, zbar - 0.1)
            assert is_hole(bar, x, yc, zbar + 0.1, zbar + PIN_DEPTH - 0.1)
            assert is_material(bar, x, yc, zbar + PIN_DEPTH + 0.5, zbar + PIN_DEPTH + 2)
        # one alignment pin through each half-lap joint: the lower half belongs to the left segment
        for left, right in zip(bars, bars[1:]):
            xj = (left.bounding_box().max.X + right.bounding_box().min.X) / 2
            y = y_front + HOLE_EDGE
            assert is_hole(left, xj, y, zbar + 0.1, zbar + BAR_Z / 2 - 0.1)
            assert is_hole(right, xj, y, zbar + BAR_Z / 2 + 0.1, zbar + BAR_Z - 0.1)
            assert is_material(left, xj, y + 6, zbar + 0.1, zbar + BAR_Z / 2 - 0.1)
            assert is_material(right, xj, y + 6, zbar + BAR_Z / 2 + 0.1, zbar + BAR_Z - 0.1)
