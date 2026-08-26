@echo off
chcp 65001 >nul
color 0B
title IDPK Builder - Ochrana a Kompilace

echo ========================================================
echo   KOMPILATOR PROJEKTU OIS IDPK (ZAMKNUTI ZDROJ. KODU)
echo ========================================================
echo.
set /p APP_NAME="Zadej nazev pro uzivatele (napriklad OIS_IDPK_V1.4): "

echo.
echo [1/3] Balim a zamykam scripty (main.js, HTML, logiku) do .asar archivu...
REM --icon=icon.ico natvrdo aplikuje tvou ikonu
call npx electron-packager . "%APP_NAME%" --platform=win32 --arch=x64 --icon="icon.ico" --asar --ignore="^/(data|obraz|zvuky|linky|build|\.git)" --out="../IDPK_BUILDS" --overwrite

echo.
echo [2/3] Vytvarim pristupne slozky vedle .exe souboru...
set OUT_DIR="..\IDPK_BUILDS\%APP_NAME%-win32-x64"

mkdir "%OUT_DIR%\data" 2>nul
mkdir "%OUT_DIR%\obraz" 2>nul
mkdir "%OUT_DIR%\zvuky" 2>nul
mkdir "%OUT_DIR%\linky" 2>nul

echo Kopiruji data pro hrace...
xcopy /E /Y /I "data\*" "%OUT_DIR%\data\" >nul
xcopy /E /Y /I "obraz\*" "%OUT_DIR%\obraz\" >nul
xcopy /E /Y /I "zvuky\*" "%OUT_DIR%\zvuky\" >nul
xcopy /E /Y /I "linky\*" "%OUT_DIR%\linky\" >nul

echo Pridavam nastroj na odemykani linek...
if exist "Odemykac_Linek.bat" copy "Odemykac_Linek.bat" "%OUT_DIR%\" /Y >nul

echo.
echo ========================================================
echo [3/3] HOTOVO! APLIKACE JE PRIPRAVENA.
echo ========================================================
echo Tvoje vyvojarska slozka zustala nedotcena.
echo Zabalenou hru, kterou muzes poslat lidem, najdes o slozku vys v: 
echo IDPK_BUILDS\%APP_NAME%-win32-x64
echo.
echo TIP PRO IKONU: Pokud na .exe souboru porad vidis logo Electronu,
echo Windows si ho pamatuje ve vyrovnavaci pameti.
echo Zkus .exe soubor prejmenovat nebo presunout na plochu!
echo.
pause