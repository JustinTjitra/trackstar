"""Load and check the measurement files for the Trackstar bridge.

The parameter files in ``hardware/params`` hold the dimensions of a DJ
controller or a bar display. Published dimensions are numbers; everything that
has to be measured with calipers is ``null`` until someone measures it.

This module reads such a file, checks its shape and values strictly, and
returns a frozen dataclass. By default (print-ready mode) it refuses to return
anything while a measurement is missing. In draft mode the missing values are
replaced by documented guesses and every guessed field is listed in
``placeholders``, so a sketch can never be mistaken for a measured part.

It has no dependency on build123d.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any, Mapping

import yaml

PARAMS_DIR: Path = Path(__file__).resolve().parents[1] / 'params'

# Placeholder numbers used only in draft mode. They are guesses for sketching
# and are never measurements.
PLACEHOLDER_REAR_GAP_MM = 4.0
PLACEHOLDER_FOOT_HEIGHT_MM = 4.0
PLACEHOLDER_TOP_PANEL_INSET_MM = 10.0  # top panel height = published height - this
PLACEHOLDER_CORNER_RADIUS_MM = 8.0
PLACEHOLDER_DISPLAY_BEZEL_MM = 14.0  # outer size = active size + this
PLACEHOLDER_DISPLAY_THICKNESS_MM = 12.0

_H7 = 'task H7 (measure the real object with calipers)'

# Field kinds for measured values.
_SCALAR = 'scalar'
_POINTS = 'points'
_MAPPING = 'mapping'
_MAPPING_LIST = 'mapping_list'
_CONNECTORS = 'connectors'

_CONTROLLER_PUBLISHED = ('width_mm', 'depth_mm', 'height_mm', 'weight_kg')
_CONTROLLER_MEASURED: dict[str, str] = {
    'rear_gap_mm': _SCALAR,
    'foot_height_mm': _SCALAR,
    'foot_positions_mm': _POINTS,
    'top_panel_height_mm': _SCALAR,
    'tallest_control_height_mm': _SCALAR,
    'usb_c_port_mm': _MAPPING,
    'kensington_slot_mm': _MAPPING,
    'left_jacks_mm': _MAPPING_LIST,
    'corner_radius_mm': _SCALAR,
}
_DISPLAY_NOMINAL = ('diagonal_in', 'resolution_px')
_DISPLAY_MEASURED: dict[str, str] = {
    'outer_width_mm': _SCALAR,
    'outer_height_mm': _SCALAR,
    'thickness_mm': _SCALAR,
    'active_width_mm': _SCALAR,
    'active_height_mm': _SCALAR,
    'connector_positions_mm': _CONNECTORS,
    'mounting_holes_mm': _POINTS,
}


class ParamError(ValueError):
    """A parameter file is malformed: unknown key, wrong type or impossible value."""


class MissingMeasurements(ParamError):
    """Print-ready values were requested but some measured values are null."""

    fields: tuple[str, ...]

    def __init__(self, message: str, fields: tuple[str, ...]) -> None:
        super().__init__(message)
        self.fields = fields


@dataclass(frozen=True)
class Controller:
    """A DJ controller: published size plus measured details."""

    name: str
    width_mm: float
    depth_mm: float
    height_mm: float
    weight_kg: float
    rear_gap_mm: float
    foot_height_mm: float
    top_panel_height_mm: float
    tallest_control_height_mm: float
    corner_radius_mm: float
    foot_positions_mm: tuple[tuple[float, float], ...]
    usb_c_port_mm: Mapping[str, float] | None
    kensington_slot_mm: Mapping[str, float] | None
    left_jacks_mm: tuple[Mapping[str, float], ...]
    placeholders: tuple[str, ...]

    @property
    def is_draft(self) -> bool:
        """True when some fields are placeholders and not real measurements."""
        return bool(self.placeholders)


@dataclass(frozen=True)
class Display:
    """A bar display: nominal listing data plus measured details."""

    name: str
    diagonal_in: float
    resolution_px: tuple[int, int]
    outer_width_mm: float
    outer_height_mm: float
    thickness_mm: float
    active_width_mm: float
    active_height_mm: float
    connector_positions_mm: tuple[Mapping[str, object], ...]
    mounting_holes_mm: tuple[tuple[float, float], ...]
    placeholders: tuple[str, ...]

    @property
    def is_draft(self) -> bool:
        """True when some fields are placeholders and not real measurements."""
        return bool(self.placeholders)


def nominal_active_area_mm(
    diagonal_in: float, resolution_px: tuple[int, int]
) -> tuple[float, float]:
    """Return (width, height) in mm of a panel with this diagonal and pixel grid.

    Square pixels are assumed.
    """
    px_w, px_h = resolution_px
    diagonal_mm = diagonal_in * 25.4
    norm = math.hypot(px_w, px_h)
    return diagonal_mm * px_w / norm, diagonal_mm * px_h / norm


# ---------------------------------------------------------------- helpers


def _resolve(source: str | Path) -> Path:
    if isinstance(source, Path):
        return source
    if '/' in source or '\\' in source or source.endswith(('.yaml', '.yml')):
        return Path(source)
    return PARAMS_DIR / (source + '.yaml')


def _is_number(value: object) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def _positive(value: object) -> bool:
    return _is_number(value) and value > 0  # type: ignore[operator]


def _read(source: str | Path) -> tuple[Path, dict[str, Any]]:
    path = _resolve(source)
    with path.open('r', encoding='utf-8') as handle:
        data = yaml.safe_load(handle)
    if not isinstance(data, dict):
        raise ParamError(f'{path}: top level must be a mapping')
    return path, data


def _check_keys(
    where: str, path: Path, data: Mapping[str, Any], expected: tuple[str, ...]
) -> None:
    for key in data:
        if key not in expected:
            raise ParamError(f'{path}: unknown key {key!r} in {where}')
    for key in expected:
        if key not in data:
            raise ParamError(f'{path}: missing key {key!r} in {where}')


def _section(path: Path, data: Mapping[str, Any], key: str, expected: tuple[str, ...]) -> Mapping[str, Any]:
    section = data[key]
    if not isinstance(section, dict):
        raise ParamError(f'{path}: {key!r} must be a mapping')
    _check_keys(key, path, section, expected)
    return section


def _check_name(path: Path, name: object) -> str:
    if not isinstance(name, str) or not name.strip():
        raise ParamError(f"{path}: 'name' must be a non-empty string")
    return name


def _check_point(path: Path, field: str, item: object) -> tuple[float, float]:
    if (
        not isinstance(item, (list, tuple))
        or len(item) != 2
        or not all(_is_number(v) for v in item)
    ):
        raise ParamError(f'{path}: {field!r} entries must be [x, y] with two finite numbers, got {item!r}')
    return float(item[0]), float(item[1])


def _check_mapping(
    path: Path, field: str, item: object, allow_name: bool = False
) -> Mapping[str, Any]:
    if not isinstance(item, dict) or not item:
        raise ParamError(f'{path}: {field!r} entries must be non-empty mappings, got {item!r}')
    out: dict[str, Any] = {}
    for key, value in item.items():
        if not isinstance(key, str):
            raise ParamError(f'{path}: {field!r} has a non-string key {key!r}')
        if allow_name and key == 'name':
            if not isinstance(value, str):
                raise ParamError(f"{path}: {field!r} 'name' must be a string, got {value!r}")
            out[key] = value
        elif _is_number(value):
            out[key] = float(value)
        else:
            raise ParamError(f'{path}: {field!r} key {key!r} must be a finite number, got {value!r}')
    return MappingProxyType(out)


def _check_measured(path: Path, field: str, kind: str, value: object) -> Any:
    """Validate one non-null measured value and return its frozen form."""
    if kind == _SCALAR:
        if not _positive(value):
            raise ParamError(f'{path}: {field!r} must be a finite number greater than 0, got {value!r}')
        return float(value)  # type: ignore[arg-type]
    if kind == _POINTS:
        if not isinstance(value, list):
            raise ParamError(f'{path}: {field!r} must be a list of [x, y], got {value!r}')
        return tuple(_check_point(path, field, v) for v in value)
    if kind == _MAPPING:
        return _check_mapping(path, field, value)
    if kind == _MAPPING_LIST:
        if not isinstance(value, list):
            raise ParamError(f'{path}: {field!r} must be a list of mappings, got {value!r}')
        return tuple(_check_mapping(path, field, v) for v in value)
    if kind == _CONNECTORS:
        if not isinstance(value, list):
            raise ParamError(f'{path}: {field!r} must be a list of mappings, got {value!r}')
        return tuple(_check_mapping(path, field, v, allow_name=True) for v in value)
    raise AssertionError(kind)  # pragma: no cover


def _empty_for(kind: str) -> Any:
    if kind in (_POINTS, _MAPPING_LIST, _CONNECTORS):
        return ()
    return None


def _measured_values(
    path: Path,
    section: Mapping[str, Any],
    kinds: Mapping[str, str],
) -> tuple[dict[str, Any], tuple[str, ...]]:
    """Validate the measured section; return the values and the names that are null."""
    values: dict[str, Any] = {}
    missing: list[str] = []
    for field, kind in kinds.items():
        raw = section[field]
        if raw is None:
            missing.append(field)
            values[field] = None
        else:
            values[field] = _check_measured(path, field, kind, raw)
    return values, tuple(missing)


def _finish(
    path: Path,
    values: dict[str, Any],
    missing: tuple[str, ...],
    kinds: Mapping[str, str],
    placeholder_for: Mapping[str, float],
    draft: bool,
) -> tuple[dict[str, Any], tuple[str, ...]]:
    if missing and not draft:
        raise MissingMeasurements(
            f'{path}: {len(missing)} measured value(s) missing: {", ".join(missing)}. '
            f'Nothing print-ready can be built from guesses; see {_H7}. '
            'Pass draft=True to sketch with placeholders.',
            missing,
        )
    for field in missing:
        if field in placeholder_for:
            values[field] = placeholder_for[field]
        else:
            values[field] = _empty_for(kinds[field])
    return values, missing


# ---------------------------------------------------------------- controller


def load_controller(source: str | Path, *, draft: bool = False) -> Controller:
    """Load a controller file by path or bare name such as ``'flx2'``.

    Raises ``MissingMeasurements`` if any measured value is null and ``draft``
    is False; raises ``ParamError`` for a malformed file.
    """
    path, data = _read(source)
    _check_keys('top level', path, data, ('name', 'published', 'measured'))
    name = _check_name(path, data['name'])
    published = _section(path, data, 'published', _CONTROLLER_PUBLISHED)
    for key in _CONTROLLER_PUBLISHED:
        if not _positive(published[key]):
            raise ParamError(
                f'{path}: published {key!r} must be a finite number greater than 0, got {published[key]!r}'
            )
    pub = {key: float(published[key]) for key in _CONTROLLER_PUBLISHED}
    section = _section(path, data, 'measured', tuple(_CONTROLLER_MEASURED))
    values, missing = _measured_values(path, section, _CONTROLLER_MEASURED)

    height = pub['height_mm']
    for field in ('rear_gap_mm', 'foot_height_mm', 'top_panel_height_mm'):
        if values[field] is not None and values[field] > height:
            raise ParamError(
                f'{path}: {field!r} ({values[field]}) must not exceed the published height_mm ({height})'
            )
    radius_limit = min(pub['width_mm'], pub['depth_mm']) / 2
    if values['corner_radius_mm'] is not None and values['corner_radius_mm'] > radius_limit:
        raise ParamError(
            f"{path}: 'corner_radius_mm' ({values['corner_radius_mm']}) must be at most half of "
            f'the smaller of width and depth ({radius_limit})'
        )

    placeholder_for = {
        'rear_gap_mm': PLACEHOLDER_REAR_GAP_MM,
        'foot_height_mm': PLACEHOLDER_FOOT_HEIGHT_MM,
        'top_panel_height_mm': height - PLACEHOLDER_TOP_PANEL_INSET_MM,
        'tallest_control_height_mm': height,
        'corner_radius_mm': PLACEHOLDER_CORNER_RADIUS_MM,
    }
    values, missing = _finish(path, values, missing, _CONTROLLER_MEASURED, placeholder_for, draft)
    return Controller(name=name, **pub, **values, placeholders=missing)


# ---------------------------------------------------------------- display


def load_display(source: str | Path, *, draft: bool = False) -> Display:
    """Load a display file by path or bare name such as ``'display_bar_11in'``.

    Raises ``MissingMeasurements`` if any measured value is null and ``draft``
    is False; raises ``ParamError`` for a malformed file.
    """
    path, data = _read(source)
    _check_keys('top level', path, data, ('name', 'nominal', 'measured'))
    name = _check_name(path, data['name'])
    nominal = _section(path, data, 'nominal', _DISPLAY_NOMINAL)
    diagonal = nominal['diagonal_in']
    if not _positive(diagonal):
        raise ParamError(
            f"{path}: nominal 'diagonal_in' must be a finite number greater than 0, got {diagonal!r}"
        )
    res = nominal['resolution_px']
    if (
        not isinstance(res, list)
        or len(res) != 2
        or not all(isinstance(v, int) and not isinstance(v, bool) and v > 0 for v in res)
    ):
        raise ParamError(f"{path}: nominal 'resolution_px' must be two positive integers, got {res!r}")
    resolution = (res[0], res[1])
    section = _section(path, data, 'measured', tuple(_DISPLAY_MEASURED))
    values, missing = _measured_values(path, section, _DISPLAY_MEASURED)

    nominal_w, nominal_h = nominal_active_area_mm(float(diagonal), resolution)
    # A measured active size, when present, is a better base for the guessed outer size.
    active_w = values['active_width_mm'] if values['active_width_mm'] is not None else nominal_w
    active_h = values['active_height_mm'] if values['active_height_mm'] is not None else nominal_h
    placeholder_for = {
        'active_width_mm': nominal_w,
        'active_height_mm': nominal_h,
        'outer_width_mm': active_w + PLACEHOLDER_DISPLAY_BEZEL_MM,
        'outer_height_mm': active_h + PLACEHOLDER_DISPLAY_BEZEL_MM,
        'thickness_mm': PLACEHOLDER_DISPLAY_THICKNESS_MM,
    }
    values, missing = _finish(path, values, missing, _DISPLAY_MEASURED, placeholder_for, draft)
    return Display(
        name=name,
        diagonal_in=float(diagonal),
        resolution_px=resolution,
        **values,
        placeholders=missing,
    )
