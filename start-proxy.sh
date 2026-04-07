#!/bin/bash
# Start the IgniteRouter proxy in the background

cd /home/saksham/IgniteRouter

# Kill any existing proxy on port 8402
lsof -ti:8402 | xargs -r kill -9 2>/dev/null

# Start the proxy
nohup node start-proxy.js > /tmp/ignite.log 2>&1 &

# Wait for it to be ready
for i in {1..10}; do
  if curl -s http://localhost:8402/health > /dev/null 2>&1; then
    echo "Proxy started successfully"
    exit 0
  fi
  sleep 1
done

echo "Failed to start proxy"
cat /tmp/ignite.log
exit 1