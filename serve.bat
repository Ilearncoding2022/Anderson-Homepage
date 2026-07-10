@echo off
REM The calendar can't fetch from a file:// page (browser blocks cross-origin requests
REM from "origin null"). Launch the app over http://localhost instead, where it works.
cd /d "%~dp0"
start "" http://localhost:8000/Anderson%%20Homepage.html
echo Serving this folder at http://localhost:8000  (press Ctrl+C to stop)
python -m http.server 8000 --bind 127.0.0.1
