@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist node_modules (
  echo [1/3] 正在安装依赖...
  call npm install
  if errorlevel 1 goto error
)

if not exist dist\index.html (
  echo [2/3] 正在构建项目...
  call npm run build
  if errorlevel 1 goto error
)

echo [3/3] 启动本地预览：http://127.0.0.1:4173/
start "星际穿越预览服务器" cmd /k "npm run preview"
timeout /t 3 >nul
start "" "http://127.0.0.1:4173/"
exit /b 0

:error
echo.
echo 启动失败，请检查 Node.js 是否已安装，或直接双击「星际穿越-离线版.html」。
pause
exit /b 1
