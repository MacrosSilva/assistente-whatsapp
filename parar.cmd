@echo off
rem Encerra a ponte do WhatsApp e o nucleo. A sessao do WhatsApp continua salva (sem novo QR).
taskkill /fi "WINDOWTITLE eq Assistente - *" /t /f >nul 2>&1
echo Assistente encerrado.
timeout /t 2 /nobreak >nul
