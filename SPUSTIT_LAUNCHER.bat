@echo off
title IDPK Launcher - Projekt OIS IDPK
cd /d "%~dp0IDPK-OIS-RC-EDITION-V1.6" 2>nul || cd /d "%~dp0"
echo ====================================================
echo        Spousteni IDPK Launcheru (Projekt OIS)
echo ====================================================
echo Pracovni adresar: %CD%
echo.
call npm start
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo npm start selhalo, zkousim spustit npx electron...
    call npx electron .
)
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Nastala chyba pri spousteni launcheru.
    pause
)
