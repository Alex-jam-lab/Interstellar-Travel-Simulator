@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "dist\interstellar-standalone.html" (
  echo 离线单文件尚未生成，正在构建...
  call npm run standalone
  if errorlevel 1 goto error
)
start "" "%CD%\dist\interstellar-standalone.html"
exit /b 0

:error
echo 构建失败，请先运行 npm install。
pause
exit /b 1
