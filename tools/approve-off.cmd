@echo off
REM Break-glass OFF switch for homepage remote approval (v4.17).
REM Double-click to make the feature completely inert, machine-wide, without
REM needing the homepage, Claude Code, or a terminal:
REM   1. Drops the sentinel file that tools/claude-approve-hook.js checks
REM      FIRST on every invocation — takes effect mid-session, no restart.
REM   2. Kills the broker (best-effort, via its PID file) so held requests
REM      release immediately instead of waiting out their 150s hold.
REM Undo with approve-on.cmd.
setlocal
set "DIR=%LOCALAPPDATA%\AndersonHomepage"
if not exist "%DIR%" mkdir "%DIR%"
> "%DIR%\approve-disable" echo disabled %date% %time%
if exist "%DIR%\approve-broker.pid" (
    for /f "usebackq delims=" %%p in ("%DIR%\approve-broker.pid") do (
        taskkill /f /pid %%p >nul 2>&1
    )
    del "%DIR%\approve-broker.pid" >nul 2>&1
)
echo Remote approval is now DISABLED. Claude Code will show its own
echo permission dialogs as usual. Run approve-on.cmd to re-enable.
pause
