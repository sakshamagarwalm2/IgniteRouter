#!/bin/bash
set -e

cd "$(dirname "$0")/../.."

echo "🦞 IgniteRouter Edge Case Test Suite"
echo ""

# Build the test image
echo "🐳 Building Docker test environment..."
docker build -f test/docker/Dockerfile.edge-cases -t IgniteRouter-edge-cases .

echo ""
echo "🧪 Running edge case tests..."

# Run with network access for x402 testing
docker run --rm \
    --network host \
    -e IgniteRouter_API_URL="${IgniteRouter_API_URL:-https://api.IgniteRouter.ai/v1}" \
    IgniteRouter-edge-cases

echo ""
echo "✅ Edge case tests completed!"

