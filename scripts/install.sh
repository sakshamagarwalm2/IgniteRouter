#!/usr/bin/env bash
set -e

echo "Installing IgniteRouter..."

# Check Node version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "Error: Node.js 20+ required. Current: $(node -v)"
  exit 1
fi

# Install plugin via OpenClaw
openclaw plugins install @igniterouter/igniterouter 2>/dev/null || \
  openclaw plugins install . --local

# Restart gateway
openclaw gateway restart

echo ""
echo "IgniteRouter installed successfully."
echo ""
echo "Add your models to openclaw.yaml:"
echo ""
echo "  plugins:"
echo "    - id: igniterouter"
echo "      config:"
echo "        defaultPriority: cost"
echo "        providers:"
echo "          - id: openai/gpt-4o"
echo "            apiKey: YOUR_OPENAI_KEY"
echo "            tier: COMPLEX"
echo "          - id: openai/gpt-4o-mini"
echo "            apiKey: YOUR_OPENAI_KEY"
echo "            tier: SIMPLE"
echo "          - id: google/gemini-2.5-flash"
echo "            apiKey: YOUR_GOOGLE_KEY"
echo "            tier: SIMPLE"
echo "            specialisedFor: [vision]"
echo ""
echo "Then run: openclaw gateway restart"
echo ""
