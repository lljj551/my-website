@echo off
REM ============================================================================
REM  serve.cmd —— 仅用于启用摄像头/手势的本地静态服务（零依赖优先用 Python）
REM  用法：双击本文件，浏览器打开 http://localhost:5173
REM  说明：这不是构建工具，不会编译任何代码；纯静态托管 index.html
REM ============================================================================
setlocal
set PORT=5173

where python >nul 2>nul
if %errorlevel%==0 (
  echo [ZRD] 请在浏览器打开 http://localhost:%PORT%/
  python -m http.server %PORT%
  goto :eof
)

where py >nul 2>nul
if %errorlevel%==0 (
  echo [ZRD] 请在浏览器打开 http://localhost:%PORT%/
  py -m http.server %PORT%
  goto :eof
)

where npx >nul 2>nul
if %errorlevel%==0 (
  echo [ZRD] 请在浏览器打开 http://localhost:%PORT%/
  npx --yes serve . -l %PORT%
  goto :eof
)

echo [ZRD] 未找到 Python 或 Node。请安装其一，或在任意静态服务器中打开本目录。
pause
