#!/usr/bin/env bash
set -e

echo "=== IgniteRouter Installation Simulation ==="

# Step 1: Verify build output exists
echo "Checking build output..."
[ -f "dist/index.js" ] && echo "✓ dist/index.js exists" || { echo "✗ dist/index.js missing — run npm run build"; exit 1; }
[ -f "dist/index.d.ts" ] && echo "✓ dist/index.d.ts exists" || echo "⚠ dist/index.d.ts missing"

# Step 2: Verify plugin manifest
echo ""
echo "Checking plugin manifest..."
PLUGIN_ID=$(node -e "const p=require('./openclaw.plugin.json'); console.log(p.id)")
[ "$PLUGIN_ID" = "igniterouter" ] && echo "✓ Plugin ID: $PLUGIN_ID" || { echo "✗ Plugin ID should be 'igniterouter', got: $PLUGIN_ID"; exit 1; }

# Step 3: Verify package.json openclaw field
echo ""
echo "Checking package.json openclaw field..."
OPENCLAW_FIELD=$(node -e "const p=require('./package.json'); console.log(JSON.stringify(p.openclaw))")
echo "openclaw field: $OPENCLAW_FIELD"
[[ "$OPENCLAW_FIELD" == *"dist/index.js"* ]] && echo "✓ openclaw.extensions points to dist/index.js" || { echo "✗ openclaw.extensions missing or wrong"; exit 1; }

# Step 4: Start proxy in test mode and hit /health
echo ""
echo "Starting proxy in test mode..."
PORT=18402
node --no-warnings -e "
import { startProxy, loadProviders } from './dist/index.js';
const cfg = loadProviders({
  defaultPriority: 'cost',
  providers: [
    { id: 'openai/gpt-4o-mini', apiKey: 'test-key', tier: 'SIMPLE' },
    { id: 'openai/gpt-4o', apiKey: 'test-key', tier: 'COMPLEX' }
  ]
});
startProxy({ port: $PORT, igniteConfig: cfg }).then(() => {
  console.log('Proxy started on port $PORT');
});
" &
PROXY_PID=$!
sleep 3

# Step 5: Health check
echo ""
echo "Testing /health endpoint..."
HEALTH=$(curl -sf http://localhost:$PORT/health || echo "FAILED")
echo "Response: $HEALTH"
[[ "$HEALTH" == *"igniterouter"* ]] && echo "✓ /health returns plugin name" || { echo "✗ /health response unexpected"; kill $PROXY_PID; exit 1; }

# Step 6: Models list
echo ""
echo "Testing /v1/models endpoint..."
MODELS=$(curl -sf http://localhost:$PORT/v1/models || echo "FAILED")
# echo "Response: $MODELS"
[[ "$MODELS" == *"igniterouter/auto"* ]] && echo "✓ /v1/models includes igniterouter/auto" || { echo "✗ igniterouter/auto missing from models list"; kill $PROXY_PID; exit 1; }
[[ "$MODELS" == *"openai/gpt-4o-mini"* ]] && echo "✓ /v1/models includes configured providers" || { echo "✗ configured providers missing from models list"; kill $PROXY_PID; exit 1; }

# Step 8: Kill proxy
kill $PROXY_PID 2>/dev/null || true
wait $PROXY_PID 2>/dev/null || true

echo ""
echo "=== Installation simulation complete ==="
