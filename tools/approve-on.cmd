@echo off
REM Re-enable homepage remote approval after approve-off.cmd:
REM removes the break-glass sentinel and starts the broker hidden.
REM (The homepage toggle in Settings -> Projects must also be on.)
setlocal
set "DIR=%LOCALAPPDATA%\AndersonHomepage"
del "%DIR%\approve-disable" >nul 2>&1
wscript "%~dp0approve-broker-hidden.vbs"
echo Remote approval is ENABLED again (broker starting hidden).
echo Buttons appear on the homepage while it is open and the
echo "Approve Claude Code permissions" setting is on.
pause
