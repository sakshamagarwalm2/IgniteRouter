#!/usr/bin/env bash
set -e

echo "Uninstalling IgniteRouter..."

openclaw plugins uninstall igniterouter 2>/dev/null || true
openclaw gateway restart

echo "IgniteRouter uninstalled."
