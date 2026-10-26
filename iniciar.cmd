@echo off
rem Inicia a ponte do WhatsApp e o nucleo (minimizados) e abre o painel.
rem "iniciar.cmd auto" (usado pelo inicio automatico do Windows) nao abre o painel.
cd /d "%~dp0"
set PYTHONUTF8=1
tasklist /fi "WINDOWTITLE eq Assistente - *" | find "cmd.exe" >nul && (
  if /i "%~1"=="auto" exit /b
  echo O assistente ja esta rodando. Abrindo o painel...
  start "" http://127.0.0.1:8765/
  exit /b
)
rem Chrome antigo da sessao do WhatsApp (sobra de suspensao) trava a ponte: encerra antes.
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -like '*wwebjs_auth*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
start "Assistente - ponte" /min cmd /c "cd bridge && node index.js >> ..\data\bridge.log 2>&1"
start "Assistente - nucleo" /min cmd /c ".venv\Scripts\python -m app >> data\core.out 2>&1"
if /i "%~1"=="auto" exit /b
echo Iniciando... o painel abre em alguns segundos.
timeout /t 8 /nobreak >nul
start "" http://127.0.0.1:8765/
