@echo off
chcp 65001 >nul
title Odemknuti GTFS Linek - OIS IDPK
color 0B

set LINKY_DIR=linky
if not exist "%LINKY_DIR%" mkdir "%LINKY_DIR%"

:menu
cls
echo ===================================================
echo     MANAZER VLASTNICH LINEK - PROJEKT OIS IDPK
echo ===================================================
echo.
echo Zde si muzes zpristupnit jakoukoliv linku z cele CR
echo z obri GTFS databaze. Staci znat 6-mistny kod.
echo.
echo !!! POZOR: TENTO NASTROJ MUZE ZABLOKOVAT ANTIVIRUS !!!
echo !!! (Pokud se tak stane, pridej ho do vyjimek)     !!!
echo.
echo ---------------------------------------------------
echo 1. PRIDAT (ODEMKNOUT) NOVOU LINKU
echo 2. SMAZAT (PRESUNOUT DO ARCHIVU) LINKU
echo 3. UKONCIT
echo ---------------------------------------------------
echo.
set /p volba="Vyber moznost (1-3): "

if "%volba%"=="1" goto add
if "%volba%"=="2" goto del
if "%volba%"=="3" exit
goto menu

:add
echo.
set /p add_code="Zadej cely kod linky z GTFS (napr. 490735): "
if "%add_code%"=="" goto menu

set short_code=%add_code:~-3%
set suffix=
set filename=%LINKY_DIR%\%short_code%%suffix%_auto.txt

:check_exist
:: Zkontrolujeme, jestli soubor existuje. Pokud ne, preskocime na vytvoreni
if not exist "%filename%" goto create_file

:: Pokud existuje, zkontrolujeme, jestli uz nahodou nema stejnou linku
findstr /C:"Linka: \"%add_code%\"" "%filename%" >nul
if %errorlevel% equ 0 (
    echo.
    echo TATO LINKA JIZ EXISTUJE! Kod %add_code% je uz odemknuty.
    pause
    goto menu
)

:: Pokud existuje, ale ma jinou linku, menime pismeno 
if "%suffix%"=="" (
    set suffix=B
) else if "%suffix%"=="B" (
    set suffix=C
) else if "%suffix%"=="C" (
    set suffix=D
) else (
    set suffix=E
)
set filename=%LINKY_DIR%\%short_code%%suffix%_auto.txt
goto check_exist

:create_file
echo GTSF-DATA> "%filename%"
echo Linka: "%add_code%">> "%filename%"
echo.>> "%filename%"
echo Zastávky:>> "%filename%"
echo a = b ^| Display:  ^| Tarifní zona:  ^| Čas:  ^| Další znaky:>> "%filename%"
echo a = b ^| Display:  ^| Tarifní zona:  ^| Čas:  ^| Další znaky:>> "%filename%"
echo a = b ^| Display:  ^| Tarifní zona:  ^| Čas:  ^| Další znaky:>> "%filename%"
echo.>> "%filename%"
echo.>> "%filename%"
echo !!SMAZAT PRED POUZITIM!!>> "%filename%"
echo Display: NEMUSITE VYPLNOVAT POUZE KDYŽ BUDE CHYBA V GTFS DATECH>> "%filename%"
echo Tarifní zona: TAKY NEMUSITE VYPLNOVAT JEN KDYŽ BUDE CHYBA V GTFS DATECH>> "%filename%"
echo Čas: TAKY NEMUSITE VYPLNOVAT JEN KDYŽ BUDE CHYBA V CASU ZASTAVKY>> "%filename%"
echo !!DALSI ZNAKY: MUSITE DOPLNIT ZASTAVKU NA ZNAMENI (ZZ)!!>> "%filename%"
echo !!SOUBOR SE MUSI JMENOVAT CISLO LINKY_AUTO PR. 735_AUTO!!>> "%filename%"
echo.>> "%filename%"
echo PRIKLAD:>> "%filename%"
echo NAZEV ZASTAVKY = ZVUKOVA_NAHRAVKA.wav ^| Display: Stred ^| Tarifní zona: 001 ^| Čas: 12:00 ^| Další znaky: ZZ>> "%filename%"

echo.
echo HOTOVO! Linka %add_code% byla odemknuta a soubor %short_code%%suffix%_auto.txt byl vytvoren.
if not "%suffix%"=="" echo Kvuli shode koncovky byl soubor automaticky prejmenovan na %short_code%%suffix%_auto.txt, aby se nic neprepsalo!
pause
goto menu

:del
echo.
set /p del_code="Zadej KRATKY kod vcetne pismene ke smazani (napr. 735 nebo 735B): "
if "%del_code%"=="" goto menu

set filename=%LINKY_DIR%\%del_code%_auto.txt
set old_dir=%LINKY_DIR%\OLD

if not exist "%old_dir%" mkdir "%old_dir%"

if exist "%filename%" (
    move /Y "%filename%" "%old_dir%\" >nul
    echo.
    echo HOTOVO! Linka %del_code% byla presunuta do archivu (linky\OLD).
    echo Zmizi z displeje po restartu palubaku.
) else (
    echo.
    echo CHYBA: Soubor %filename% neexistuje. Tato linka neni odemknuta.
)
pause
goto menu