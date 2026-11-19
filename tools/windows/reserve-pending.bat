@echo off
rem Pede os codigos de reserva dos boletins publicados sem codigo (corre a cada 2 minutos).
rem Corre a partir da pasta do projecto (onde esta o package.json e a pasta node_modules).
setlocal
if "%SUPABASE_URL%"=="" set SUPABASE_URL=https://dcvadrtvyzwwvlwejach.supabase.co
if "%SUPABASE_SERVICE_ROLE_KEY%"=="" set /p SUPABASE_SERVICE_ROLE_KEY=Cola a SUPABASE_SERVICE_ROLE_KEY e carrega Enter: 
node tools\reserve-pending.js --watch
