// Маленький хелпер для setup.bat / setup.sh — печатает один криптостойкий секрет.
// Вынесен в отдельный файл, чтобы не воевать с экранированием кавычек в cmd.exe.
const crypto = require('crypto');
process.stdout.write(crypto.randomBytes(48).toString('hex'));
