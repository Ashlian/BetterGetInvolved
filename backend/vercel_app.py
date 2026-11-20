"""Vercel entry point for the API (its project's Root Directory is backend/).

Vercel deploys the contents of backend/ as the function's root, so this folder is no longer
importable as the package "backend" that the code's relative imports expect. Register it
under that name, whatever the directory is called, then expose the ASGI app.
"""

import importlib.util
import sys
from pathlib import Path

if "backend" not in sys.modules:
    here = Path(__file__).resolve().parent
    spec = importlib.util.spec_from_file_location("backend", here / "__init__.py", submodule_search_locations=[str(here)])
    package = importlib.util.module_from_spec(spec)
    sys.modules["backend"] = package
    spec.loader.exec_module(package)

from backend.app import app  # noqa: E402

__all__ = ["app"]
