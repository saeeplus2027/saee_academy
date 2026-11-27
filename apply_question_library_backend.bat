@echo off
cd /d "%~dp0"
python apply_question_library_backend.py
if errorlevel 1 pause
