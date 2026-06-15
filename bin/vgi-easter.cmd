@echo off
rem Copyright 2026 Query Farm LLC - https://query.farm
rem Windows stdio launcher entry for the easter VGI worker.
node "%~dp0..\dist\worker.js" %*
