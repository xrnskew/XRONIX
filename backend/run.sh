#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  "${PYTHON:-python3}" -m venv .venv
fi
.venv/bin/python -c 'import sys; assert sys.version_info >= (3, 12), "Python 3.12+ required"'
.venv/bin/python -m pip install -q -r requirements.txt
exec .venv/bin/python -m uvicorn app.main:create_app --factory --host 0.0.0.0 --port 8000
