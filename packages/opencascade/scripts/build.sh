#!/bin/bash
set -euo pipefail
/opencascade.js/.venv/bin/python /src/patch-generator.py
cd /opencascade.js
timeout 1800s ./build-wasm.sh generate bindings link /src/custom_build_single.yml
chown -R "$CODE3D_BUILD_UID:$CODE3D_BUILD_GID" /src
