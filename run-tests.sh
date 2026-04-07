#!/bin/bash
# Start proxy and test it

cd /home/saksham/IgniteRouter

# Kill any existing proxy on port 8402
lsof -i :8402 2>/dev/null | grep LISTEN | awk '{print $2}' | xargs -r kill 2>/dev/null
sleep 1

# Start proxy in background
nohup node start-full-proxy.js > /tmp/ir-proxy.log 2>&1 &
PROXY_PID=$!

echo "Started proxy with PID: $PROXY_PID"

# Wait for proxy to be ready
for i in {1..10}; do
  if curl -s http://localhost:8402/health > /dev/null 2>&1; then
    echo "Proxy is ready!"
    break
  fi
  sleep 1
done

echo ""
echo "=== Testing Different Prompts ==="
echo ""

echo "1. Simple greeting (should hit Xiaomi mimo-v2-flash - FREE):"
curl -s -D - -X POST http://localhost:8402/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "ignite/auto", "messages": [{"role": "user", "content": "Hi"}], "max_tokens": 10}' 2>&1 | grep -E "^X-.*model|X-Ignite"

echo ""
echo "2. Creative story (should hit Xiaomi or Mistral based on quality priority):"
curl -s -D - -X POST http://localhost:8402/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "ignite/auto", "messages": [{"role": "user", "content": "Write a creative story about a robot"}], "max_tokens": 30}' 2>&1 | grep -E "^X-.*model|X-Ignite"

echo ""
echo "3. Math reasoning proof (should hit Mistral - COMPLEX tier):"
curl -s -D - -X POST http://localhost:8402/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "ignite/auto", "messages": [{"role": "user", "content": "Prove that sqrt(2) is irrational"}], "max_tokens": 50}' 2>&1 | grep -E "^X-.*model|X-Ignite"

echo ""
echo "4. Direct OpenRouter call:"
curl -s -D - -X POST http://localhost:8402/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "openrouter/auto", "messages": [{"role": "user", "content": "Hello"}], "max_tokens": 10}' 2>&1 | grep -E "^X-.*model|X-Ignite|model.*mistralai"

echo ""
echo "=== All Tests Complete ==="
echo ""
echo "To keep proxy running: it will stay up until you kill it"
echo "To change priority: send a message with /priority cost|speed|quality"