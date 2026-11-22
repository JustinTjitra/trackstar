# hardware

This folder holds the Python workspace for the hardware part of Trackstar: a 3D printed bridge that holds a small bar display above a DJ controller (Pioneer DDJ-FLX2 or DDJ-FLX4). The parts will be modelled in code with the Python library build123d.

Right now the folder contains only the parameter files and the code that loads and checks them. There is no 3D modelling yet.

## Setup

Run these three commands from the repository root, one after the other. Python 3.11 or newer is needed (3.13 was used). The install takes about 40 seconds and about 1 GB of disk.

Go to the folder and create the virtual environment:

```bash
cd hardware && python3 -m venv .venv
```

Install the pinned packages (this is the only step that uses the network):

```bash
.venv/bin/pip install -r requirements.txt
```

Run the tests:

```bash
.venv/bin/python -m pytest
```

The `.venv` folder is ignored by git. Do not install CadQuery in this environment: build123d and CadQuery ship different builds of the same geometry kernel, and mixing them breaks both. A test checks that CadQuery is absent.

## Running the tests

From the `hardware` folder:

```bash
.venv/bin/python -m pytest
```

The tests check the parameter loader, check that the shipped YAML files are honest (no guessed value is stored as a measurement), and check that the installed packages match the pins and that the geometry kernel loads.

## Parameter files

In `params/`:

- `flx2.yaml`: Pioneer DDJ-FLX2.
- `flx4.yaml`: Pioneer DDJ-FLX4.
- `display_bar_11in.yaml`: the 11.26 inch 1920 x 440 bar display.

Each file has a `published` (or `nominal`) section with numbers taken from the maker's specification or the product listing, and a `measured` section for values that must be taken with calipers on the real object (task H7). A value of `null` means it has not been measured yet, and its line carries a comment starting with `# unmeasured` that says what to measure.

To record a measurement, replace `null` with the value (in millimetres) and delete the `# unmeasured` comment on that line. Lists and mappings use YAML syntax, for example `foot_positions_mm: [[20, 20], [360, 20]]` or `usb_c_port_mm: {x: 100, z: 10, width: 9, height: 3.5}`. A misspelled key, a missing key, a zero or negative number, or a value that cannot be true (for example a rear gap taller than the controller) is rejected with a message that names the key and the file.

## Draft and print-ready

`load_controller` and `load_display` (in `trackstar_hw.params`) have two modes:

- Print-ready (the default): if any measured value is still `null`, they raise `MissingMeasurements`, which lists every missing field and points to task H7. Nothing that will be printed can be built from guesses.
- Draft (`draft=True`): each missing value is replaced by a documented placeholder, and the names of those fields are listed in `placeholders`. `is_draft` is true while that list is not empty. Drafts are for sketching only. The placeholder numbers are named constants at the top of `trackstar_hw/params.py`.

```python
from trackstar_hw import load_controller

sketch = load_controller('flx2', draft=True)   # works today
part = load_controller('flx2')                 # raises until all values are measured
```

## Licences of the pinned packages

- build123d 0.13.0: Apache-2.0
- pytest 9.2.0: MIT
- PyYAML 6.0.3: MIT

## Recording the installed versions

`requirements.txt` pins only the three direct packages. To record the full set of installed versions, including everything they pull in:

```bash
.venv/bin/pip freeze
```
