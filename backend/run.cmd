@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
    py -3 -m venv .venv
    if errorlevel 1 exit /b 1
)
".venv\Scripts\python.exe" -c "import sys; assert sys.version_info >= (3, 12), 'Python 3.12+ required'"
if errorlevel 1 exit /b 1
".venv\Scripts\python.exe" -m pip install -q -r requirements.txt
if errorlevel 1 exit /b 1
".venv\Scripts\python.exe" -m uvicorn app.main:create_app --factory --host 0.0.0.0 --port 8000
exit /b %errorlevel%
