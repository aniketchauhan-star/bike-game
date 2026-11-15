@echo off
REM Double-click to start UTTARAKHAND RIDERS (Windows)
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js nahi mila. Install karo: https://nodejs.org & pause & exit /b)
start "" http://localhost:8080/
node server.js
pause
