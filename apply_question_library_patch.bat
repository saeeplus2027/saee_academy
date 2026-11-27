@echo off
cd /d "%~dp0"
py apply_question_library_patch.py
if errorlevel 1 python apply_question_library_patch.py
pause
