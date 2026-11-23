"""Trackstar hardware workspace: parameter loading and the draft controller bridge."""

from .bridge import build_bridge, controller_envelope, crossbar_segment_count
from .params import (
    PARAMS_DIR,
    Controller,
    Display,
    MissingMeasurements,
    ParamError,
    load_controller,
    load_display,
    nominal_active_area_mm,
)

__all__ = [
    'PARAMS_DIR',
    'Controller',
    'Display',
    'MissingMeasurements',
    'ParamError',
    'load_controller',
    'load_display',
    'nominal_active_area_mm',
    'build_bridge',
    'controller_envelope',
    'crossbar_segment_count',
]
