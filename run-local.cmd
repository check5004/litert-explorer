@echo off
cd /d "%~dp0"
echo LiteRT Lab: first setup downloads approx 764 MB of public Core/Decision + LLM runtime models and runtime assets.
call npm ci --ignore-scripts || exit /b 1
call npm run assets || exit /b 1
call npm run build || exit /b 1
call npm run preview
