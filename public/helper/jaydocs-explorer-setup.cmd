@if (@CodeSection == @Batch) @then
@echo off
chcp 65001 >nul
setlocal
rem JayDocs 파일 탐색기 연결 도우미 (DESIGN 21).
rem   더블클릭      이 사용자 계정에 설치. 관리자 권한은 필요 없다
rem   /uninstall    제거
rem 웹 앱은 탐색기를 직접 열 수 없어, jaydocs-open: 주소를 이 파일 아래쪽의 JScript 로 넘긴다.
rem JScript 는 폴더를 보여 주거나 파일을 선택해 보여 주기만 하고, 파일을 실행하지 않는다.
set "KEY=HKCU\Software\Classes\jaydocs-open"
set "DIR=%LOCALAPPDATA%\JayDocs"
set "FILE=%DIR%\jaydocs-explorer.cmd"

if /i "%~1"=="/uninstall" goto uninstall

if not exist "%DIR%" mkdir "%DIR%" || goto failed
if /i not "%~f0"=="%FILE%" copy /y "%~f0" "%FILE%" >nul || goto failed
reg add "%KEY%" /ve /d "URL:JayDocs Explorer" /f >nul || goto failed
reg add "%KEY%" /v "URL Protocol" /d "" /f >nul || goto failed
reg add "%KEY%\shell\open\command" /ve /d "\"%SystemRoot%\System32\wscript.exe\" //E:JScript //Nologo \"%FILE%\" \"%%1\"" /f >nul || goto failed
echo.
echo 설치했습니다. JayDocs 로 돌아가 "설치했습니다 - 열기" 를 누르세요.
echo 제거: 이 파일을 /uninstall 과 함께 실행
echo.
pause
exit /b 0

:uninstall
reg delete "%KEY%" /f >nul 2>&1
echo 제거했습니다.
pause
del "%FILE%" 2>nul & rmdir "%DIR%" 2>nul & exit /b 0

:failed
echo.
echo 설치하지 못했습니다. 위 메시지를 확인하세요.
echo.
pause
exit /b 1
@end

// wscript runs from here. Keep this part ASCII: WSH does not read UTF-8.
var shell = new ActiveXObject('WScript.Shell');
var fso = new ActiveXObject('Scripting.FileSystemObject');
var app = new ActiveXObject('Shell.Application');

function fail(detail) {
  // "cannot open this path"
  shell.Popup('경로를 열 수 없습니다\n\n' + detail, 0, 'JayDocs', 48);
  WScript.Quit(1);
}

var url = WScript.Arguments.length ? WScript.Arguments(0) : '';
var path = '';
try {
  path = decodeURIComponent(url.replace(/^jaydocs-open:\/*/i, '').replace(/\/+$/, ''));
} catch (e) {
  fail(url);
}

// Any web page can call this scheme, so: local drive paths only (a \\server path would
// send Windows credentials to that server) and never run anything, only show it.
if (!/^[A-Za-z]:\\/.test(path) || /["\r\n]/.test(path)) fail(path);

if (fso.FolderExists(path)) app.ShellExecute('explorer.exe', '"' + path + '"', '', 'open', 1);
else if (fso.FileExists(path)) app.ShellExecute('explorer.exe', '/select,"' + path + '"', '', 'open', 1);
else fail(path);
