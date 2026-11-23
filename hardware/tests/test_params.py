"""Tests for trackstar_hw.params and the hardware environment."""

from __future__ import annotations

import copy
import dataclasses
import importlib.metadata
import importlib.util
import math
import sys
from pathlib import Path
from typing import Any

HARDWARE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HARDWARE_DIR))

import pytest  # noqa: E402
import yaml  # noqa: E402

from trackstar_hw.params import (  # noqa: E402
    PARAMS_DIR,
    Controller,
    Display,
    MissingMeasurements,
    ParamError,
    load_controller,
    load_display,
    nominal_active_area_mm,
)

CONTROLLER_MEASURED = [
    'rear_gap_mm',
    'foot_height_mm',
    'foot_positions_mm',
    'top_panel_height_mm',
    'tallest_control_height_mm',
    'usb_c_port_mm',
    'kensington_slot_mm',
    'left_jacks_mm',
    'corner_radius_mm',
]
DISPLAY_MEASURED = [
    'outer_width_mm',
    'outer_height_mm',
    'thickness_mm',
    'active_width_mm',
    'active_height_mm',
    'connector_positions_mm',
    'mounting_holes_mm',
]

FULL_CONTROLLER_MEASURED: dict[str, Any] = {
    'rear_gap_mm': 3.2,
    'foot_height_mm': 5.5,
    'foot_positions_mm': [[20.0, 20.0], [360.0, 20.0], [20.0, 190.0], [360.0, 190.0]],
    'top_panel_height_mm': 40.0,
    'tallest_control_height_mm': 46.5,
    'usb_c_port_mm': {'x': 100.0, 'z': 10.0, 'width': 9.0, 'height': 3.5},
    'kensington_slot_mm': {'x': 300.0, 'z': 10.0, 'width': 7.0, 'height': 3.0},
    'left_jacks_mm': [
        {'y': 50.0, 'z': 20.0, 'diameter': 6.0},
        {'y': 80.0, 'z': 20.0, 'diameter': 6.0},
    ],
    'corner_radius_mm': 9.5,
}


def shipped(name: str) -> dict[str, Any]:
    return yaml.safe_load((PARAMS_DIR / (name + '.yaml')).read_text(encoding='utf-8'))


def write(tmp_path: Path, data: dict[str, Any], name: str = 'case.yaml') -> Path:
    path = tmp_path / name
    path.write_text(yaml.safe_dump(data, sort_keys=False), encoding='utf-8')
    return path


def controller_data(**measured: Any) -> dict[str, Any]:
    data = shipped('flx2')
    data['measured'].update(measured)
    return data


def full_controller_data() -> dict[str, Any]:
    return controller_data(**copy.deepcopy(FULL_CONTROLLER_MEASURED))


# 1 -------------------------------------------------------------------------
def test_shipped_files_load_as_drafts() -> None:
    flx2 = load_controller('flx2', draft=True)
    assert (flx2.width_mm, flx2.depth_mm, flx2.height_mm, flx2.weight_kg) == (383.2, 208.0, 48.2, 1.2)
    flx4 = load_controller('flx4', draft=True)
    assert (flx4.width_mm, flx4.depth_mm, flx4.height_mm, flx4.weight_kg) == (482.0, 272.8, 59.2, 2.1)
    display = load_display('display_bar_11in', draft=True)
    assert display.diagonal_in == 11.26
    assert display.resolution_px == (1920, 440)
    for item, fields in ((flx2, CONTROLLER_MEASURED), (flx4, CONTROLLER_MEASURED), (display, DISPLAY_MEASURED)):
        assert item.is_draft is True
        assert list(item.placeholders) == fields
    assert flx2.name == 'DDJ-FLX2' and flx4.name == 'DDJ-FLX4'


# 2 -------------------------------------------------------------------------
@pytest.mark.parametrize(
    'loader, name, fields',
    [
        (load_controller, 'flx2', CONTROLLER_MEASURED),
        (load_controller, 'flx4', CONTROLLER_MEASURED),
        (load_display, 'display_bar_11in', DISPLAY_MEASURED),
    ],
)
def test_shipped_files_not_print_ready(loader: Any, name: str, fields: list[str]) -> None:
    with pytest.raises(MissingMeasurements) as info:
        loader(name)
    assert list(info.value.fields) == fields
    assert 'H7' in str(info.value)
    assert str(len(fields)) in str(info.value)
    for field in fields:
        assert field in str(info.value)


# 3 -------------------------------------------------------------------------
def test_controller_placeholder_values() -> None:
    c = load_controller('flx2', draft=True)
    assert c.rear_gap_mm == 4.0
    assert c.foot_height_mm == 4.0
    assert c.top_panel_height_mm == pytest.approx(38.2, abs=1e-9)
    assert c.tallest_control_height_mm == 48.2
    assert c.corner_radius_mm == 8.0
    assert c.foot_positions_mm == ()
    assert c.usb_c_port_mm is None
    assert c.kensington_slot_mm is None
    assert c.left_jacks_mm == ()


def test_display_placeholder_values() -> None:
    d = load_display('display_bar_11in', draft=True)
    assert d.active_width_mm == pytest.approx(278.78, abs=0.01)
    assert d.active_height_mm == pytest.approx(63.89, abs=0.01)
    assert d.outer_width_mm == pytest.approx(d.active_width_mm + 14.0, abs=1e-9)
    assert d.outer_height_mm == pytest.approx(d.active_height_mm + 14.0, abs=1e-9)
    assert d.thickness_mm == 12.0
    assert d.connector_positions_mm == ()
    assert d.mounting_holes_mm == ()


# 4 -------------------------------------------------------------------------
def test_nominal_active_area() -> None:
    w, h = nominal_active_area_mm(11.26, (1920, 440))
    assert w == pytest.approx(278.78, abs=0.01)
    assert h == pytest.approx(63.89, abs=0.01)
    assert w > h
    sq_w, sq_h = nominal_active_area_mm(10.0, (500, 500))
    assert sq_w == pytest.approx(sq_h, abs=1e-12)
    for diagonal, res in ((11.26, (1920, 440)), (7.0, (800, 480)), (15.6, (1080, 1920))):
        a, b = nominal_active_area_mm(diagonal, res)
        assert math.hypot(a, b) == pytest.approx(diagonal * 25.4, abs=1e-9)
        assert a / b == pytest.approx(res[0] / res[1], abs=1e-9)


# 5 -------------------------------------------------------------------------
@pytest.mark.parametrize('draft', [False, True])
def test_fully_measured_controller(tmp_path: Path, draft: bool) -> None:
    path = write(tmp_path, full_controller_data())
    c = load_controller(path, draft=draft)
    assert c.is_draft is False
    assert c.placeholders == ()
    m = FULL_CONTROLLER_MEASURED
    assert c.rear_gap_mm == m['rear_gap_mm']
    assert c.foot_height_mm == m['foot_height_mm']
    assert c.top_panel_height_mm == m['top_panel_height_mm']
    assert c.tallest_control_height_mm == m['tallest_control_height_mm']
    assert c.corner_radius_mm == m['corner_radius_mm']
    assert c.foot_positions_mm == tuple(tuple(p) for p in m['foot_positions_mm'])
    assert dict(c.usb_c_port_mm or {}) == m['usb_c_port_mm']
    assert dict(c.kensington_slot_mm or {}) == m['kensington_slot_mm']
    assert [dict(j) for j in c.left_jacks_mm] == m['left_jacks_mm']
    assert (c.width_mm, c.depth_mm, c.height_mm, c.weight_kg) == (383.2, 208.0, 48.2, 1.2)


def test_fully_measured_display(tmp_path: Path) -> None:
    data = shipped('display_bar_11in')
    data['measured'].update(
        outer_width_mm=290.0,
        outer_height_mm=75.0,
        thickness_mm=9.0,
        active_width_mm=279.0,
        active_height_mm=64.0,
        connector_positions_mm=[{'name': 'usb-c', 'x': 10.0, 'y': 5.0, 'width': 9.0, 'height': 3.0}],
        mounting_holes_mm=[[5.0, 5.0], [285.0, 70.0]],
    )
    d = load_display(write(tmp_path, data))
    assert d.is_draft is False and d.placeholders == ()
    assert d.outer_width_mm == 290.0 and d.thickness_mm == 9.0
    assert d.connector_positions_mm[0]['name'] == 'usb-c'
    assert d.mounting_holes_mm == ((5.0, 5.0), (285.0, 70.0))


# 6 -------------------------------------------------------------------------
def test_partly_measured_controller(tmp_path: Path) -> None:
    path = write(tmp_path, controller_data(rear_gap_mm=3.2))
    with pytest.raises(MissingMeasurements) as info:
        load_controller(path)
    assert list(info.value.fields) == [f for f in CONTROLLER_MEASURED if f != 'rear_gap_mm']
    assert len(info.value.fields) == 8
    c = load_controller(path, draft=True)
    assert c.rear_gap_mm == 3.2
    assert 'rear_gap_mm' not in c.placeholders
    assert list(c.placeholders) == [f for f in CONTROLLER_MEASURED if f != 'rear_gap_mm']
    assert c.is_draft is True
    assert c.foot_height_mm == 4.0


# 7 -------------------------------------------------------------------------
def _bad_shape_cases() -> list[tuple[str, dict[str, Any], str]]:
    cases: list[tuple[str, dict[str, Any], str]] = []
    d = shipped('flx2')
    d['measured']['rear_gap_m'] = d['measured'].pop('rear_gap_mm')
    cases.append(('typo-key', d, 'rear_gap_m'))
    d = shipped('flx2')
    d['extra_section'] = 1
    cases.append(('top-level-unknown', d, 'extra_section'))
    d = shipped('flx2')
    del d['published']['weight_kg']
    cases.append(('missing-published-key', d, 'weight_kg'))
    d = shipped('flx2')
    del d['measured']['corner_radius_mm']
    cases.append(('missing-measured-key', d, 'corner_radius_mm'))
    d = shipped('flx2')
    d['published'] = [383.2, 208.0]
    cases.append(('published-list', d, 'published'))
    d = shipped('flx2')
    d['measured'] = None
    cases.append(('measured-none', d, 'measured'))
    d = shipped('flx2')
    d['name'] = ''
    cases.append(('empty-name', d, 'name'))
    d = shipped('flx2')
    d['name'] = 7
    cases.append(('numeric-name', d, 'name'))
    return cases


@pytest.mark.parametrize('label, data, key', _bad_shape_cases(), ids=lambda v: v if isinstance(v, str) and v.islower() else '')
def test_strict_shape(tmp_path: Path, label: str, data: dict[str, Any], key: str) -> None:
    path = write(tmp_path, data)
    for draft in (False, True):
        with pytest.raises(ParamError) as info:
            load_controller(path, draft=draft)
        assert not isinstance(info.value, MissingMeasurements)
        assert key in str(info.value)


def test_wrong_kind_of_file() -> None:
    with pytest.raises(ParamError) as info:
        load_controller('display_bar_11in', draft=True)
    assert not isinstance(info.value, MissingMeasurements)
    assert 'nominal' in str(info.value) or 'published' in str(info.value)
    with pytest.raises(ParamError) as info2:
        load_display('flx2', draft=True)
    assert not isinstance(info2.value, MissingMeasurements)
    assert 'published' in str(info2.value) or 'nominal' in str(info2.value)


def test_display_strict_shape(tmp_path: Path) -> None:
    d = shipped('display_bar_11in')
    d['measured']['thickness'] = 1.0
    with pytest.raises(ParamError, match='thickness'):
        load_display(write(tmp_path, d), draft=True)
    d = shipped('display_bar_11in')
    d['nominal'] = 'big'
    with pytest.raises(ParamError, match='nominal'):
        load_display(write(tmp_path, d), draft=True)


# 8 -------------------------------------------------------------------------
@pytest.mark.parametrize('bad', [0, -5, '383', True, float('nan'), float('inf')])
def test_bad_published_width(tmp_path: Path, bad: Any) -> None:
    d = shipped('flx2')
    d['published']['width_mm'] = bad
    with pytest.raises(ParamError, match='width_mm'):
        load_controller(write(tmp_path, d), draft=True)


@pytest.mark.parametrize('bad', [0, -1, '3', True, float('nan'), float('inf')])
def test_bad_measured_scalar(tmp_path: Path, bad: Any) -> None:
    path = write(tmp_path, controller_data(foot_height_mm=bad))
    with pytest.raises(ParamError, match='foot_height_mm') as info:
        load_controller(path, draft=True)
    assert not isinstance(info.value, MissingMeasurements)


@pytest.mark.parametrize('bad', [[1920], [1920, 0], [1920.5, 440], [1920, 440, 3], '1920x440', [True, 440], None])
def test_bad_resolution(tmp_path: Path, bad: Any) -> None:
    d = shipped('display_bar_11in')
    d['nominal']['resolution_px'] = bad
    with pytest.raises(ParamError, match='resolution_px'):
        load_display(write(tmp_path, d), draft=True)


@pytest.mark.parametrize('bad', [0, -2.0, '11', True, float('nan')])
def test_bad_diagonal(tmp_path: Path, bad: Any) -> None:
    d = shipped('display_bar_11in')
    d['nominal']['diagonal_in'] = bad
    with pytest.raises(ParamError, match='diagonal_in'):
        load_display(write(tmp_path, d), draft=True)


def test_bad_structured_values(tmp_path: Path) -> None:
    cases: list[tuple[str, Any]] = [
        ('foot_positions_mm', [[1.0, 2.0, 3.0]]),
        ('foot_positions_mm', [[1.0]]),
        ('foot_positions_mm', [['a', 2.0]]),
        ('foot_positions_mm', 'none'),
        ('usb_c_port_mm', {'x': 'left', 'z': 1.0}),
        ('usb_c_port_mm', {'x': True, 'z': 1.0}),
        ('usb_c_port_mm', {'x': float('nan')}),
        ('usb_c_port_mm', [1, 2]),
        ('kensington_slot_mm', {'x': 'a'}),
        ('left_jacks_mm', [{'y': 1.0, 'z': 'high'}]),
        ('left_jacks_mm', {'y': 1.0}),
    ]
    for field, bad in cases:
        path = write(tmp_path, controller_data(**{field: bad}))
        with pytest.raises(ParamError, match=field):
            load_controller(path, draft=True)
    d = shipped('display_bar_11in')
    d['measured']['connector_positions_mm'] = [{'name': 5, 'x': 1.0}]
    with pytest.raises(ParamError, match='connector_positions_mm'):
        load_display(write(tmp_path, d), draft=True)
    d['measured']['connector_positions_mm'] = [{'name': 'hdmi', 'x': 'a'}]
    with pytest.raises(ParamError, match='connector_positions_mm'):
        load_display(write(tmp_path, d), draft=True)
    d['measured']['connector_positions_mm'] = None
    d['measured']['mounting_holes_mm'] = [[1.0, 2.0, 3.0]]
    with pytest.raises(ParamError, match='mounting_holes_mm'):
        load_display(write(tmp_path, d), draft=True)


# 9 -------------------------------------------------------------------------
@pytest.mark.parametrize(
    'field, value',
    [
        ('rear_gap_mm', 48.3),
        ('foot_height_mm', 50.0),
        ('top_panel_height_mm', 48.3),
        ('corner_radius_mm', 104.1),
    ],
)
def test_sanity_limits(tmp_path: Path, field: str, value: float) -> None:
    path = write(tmp_path, controller_data(**{field: value}))
    for draft in (False, True):
        with pytest.raises(ParamError, match=field) as info:
            load_controller(path, draft=draft)
        assert not isinstance(info.value, MissingMeasurements)


def test_sanity_limits_allow_boundary(tmp_path: Path) -> None:
    path = write(tmp_path, controller_data(rear_gap_mm=48.2, corner_radius_mm=104.0))
    c = load_controller(path, draft=True)
    assert c.rear_gap_mm == 48.2 and c.corner_radius_mm == 104.0


def test_sanity_corner_radius_uses_smaller_side(tmp_path: Path) -> None:
    # Width 383.2 is larger than depth 208.0, so the limit is 104.0, not 191.6.
    path = write(tmp_path, controller_data(corner_radius_mm=150.0))
    with pytest.raises(ParamError, match='corner_radius_mm'):
        load_controller(path, draft=True)


# 10 ------------------------------------------------------------------------
def test_source_handling() -> None:
    assert load_controller('flx2', draft=True) == load_controller(PARAMS_DIR / 'flx2.yaml', draft=True)
    assert load_controller('flx2', draft=True) != load_controller('flx4', draft=True)
    assert load_display('display_bar_11in', draft=True) == load_display(
        str(PARAMS_DIR / 'display_bar_11in.yaml'), draft=True
    )
    with pytest.raises(FileNotFoundError):
        load_controller('no_such_controller', draft=True)
    with pytest.raises(FileNotFoundError):
        load_display('no_such_display')


# 11 ------------------------------------------------------------------------
def test_immutability(tmp_path: Path) -> None:
    c = load_controller('flx2', draft=True)
    with pytest.raises(dataclasses.FrozenInstanceError):
        c.width_mm = 1.0  # type: ignore[misc]
    with pytest.raises(dataclasses.FrozenInstanceError):
        c.placeholders = ()  # type: ignore[misc]
    d = load_display('display_bar_11in', draft=True)
    with pytest.raises(dataclasses.FrozenInstanceError):
        d.thickness_mm = 1.0  # type: ignore[misc]
    full = load_controller(write(tmp_path, full_controller_data()))
    assert full.usb_c_port_mm is not None
    with pytest.raises(TypeError):
        full.usb_c_port_mm['x'] = 1.0  # type: ignore[index]
    with pytest.raises(TypeError):
        full.kensington_slot_mm['x'] = 1.0  # type: ignore[index]
    with pytest.raises(TypeError):
        full.left_jacks_mm[0]['y'] = 1.0  # type: ignore[index]
    assert isinstance(full, Controller) and isinstance(d, Display)


def test_display_connector_mappings_are_read_only(tmp_path: Path) -> None:
    data = shipped('display_bar_11in')
    data['measured']['connector_positions_mm'] = [{'name': 'usb-c', 'x': 1.0, 'y': 2.0}]
    d = load_display(write(tmp_path, data), draft=True)
    with pytest.raises(TypeError):
        d.connector_positions_mm[0]['x'] = 5.0  # type: ignore[index]


# 12 ------------------------------------------------------------------------
@pytest.mark.parametrize('name', ['flx2', 'flx4', 'display_bar_11in'])
def test_shipped_files_are_honest(name: str) -> None:
    path = PARAMS_DIR / (name + '.yaml')
    text = path.read_text(encoding='utf-8')
    # Whole-line comments (the file header) may mention the word null; value lines may not.
    null_lines = [
        line for line in text.splitlines() if 'null' in line and not line.lstrip().startswith('#')
    ]
    assert null_lines
    for line in null_lines:
        assert '# unmeasured' in line, line
    assert chr(0x2014) not in text
    measured = yaml.safe_load(text)['measured']
    assert measured
    assert all(value is None for value in measured.values())


# 13 ------------------------------------------------------------------------
def _pins() -> dict[str, str]:
    pins: dict[str, str] = {}
    for line in (HARDWARE_DIR / 'requirements.txt').read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if line and not line.startswith('#'):
            name, version = line.split('==')
            pins[name] = version
    return pins


@pytest.mark.parametrize('package', ['build123d', 'pytest', 'PyYAML'])
def test_installed_versions_match_pins(package: str) -> None:
    pins = _pins()
    assert set(pins) == {'build123d', 'pytest', 'PyYAML'}
    assert importlib.metadata.version(package) == pins[package]


def test_cadquery_absent_and_kernel_loads() -> None:
    assert importlib.util.find_spec('cadquery') is None
    from build123d import Box

    assert Box(10, 20, 30).volume == pytest.approx(6000, abs=1e-6)
