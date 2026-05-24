#!/usr/bin/env bash
# Совместимость со старыми инструкциями — просто запускает setup.sh.
exec "$(dirname "$0")/setup.sh"
