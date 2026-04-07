#!/bin/bash
echo "Testing health..."
curl -s http://localhost:8402/health
echo ""
echo "Testing simple chat..."
curl -s -D - -X POST http://localhost:8402/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "ignite/auto", "messages": [{"role": "user", "content": "Hi"}], "max_tokens": 10}' 2>&1
echo ""
echo "Done"