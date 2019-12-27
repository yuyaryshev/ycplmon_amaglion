@echo off
set PATH=%PATH%;node_modules\.bin
set my_drive=%~d0
set my_path=%~dp0
%my_drive%
cd %my_path%
rmdir ts_out /s /q
start C:\Windows\System32\cmd.exe /k watch_src.bat
start C:\Windows\System32\cmd.exe /k watch_test.bat
start C:\Windows\System32\cmd.exe /k cls

