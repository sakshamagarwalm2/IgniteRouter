#!/bin/bash
set -e

############################################################
# IgniteRouter Setup Script for OpenClaw
# 
# This script sets up OpenClaw with IgniteRouter plugin,
# configures providers, and enables smart routing.
#
# Usage:
#   ./setup-igniterouter.sh
#
# Requirements:
#   - Node.js 20+
#   - OpenClaw installed (npm install -g openclaw@latest)
############################################################

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
OPENCLAW_DIR="$HOME/.openclaw"
OPENCLAW_CONFIG="$OPENCLAW_DIR/openclaw.json"
IGNITROUTER_PLUGIN_DIR="$OPENCLAW_DIR/extensions/igniterouter"
PORT=${PORT:-8402}
GATEWAY_PORT=${GATEWAY_PORT:-18789}

echo -e "${BLUE}==================================================${NC}"
echo -e "${BLUE}  IgniteRouter Setup for OpenClaw${NC}"
echo -e "${BLUE}==================================================${NC}"
echo ""

# Function to print status
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running from IgniteRouter directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IGNITE_ROUTER_DIR="$SCRIPT_DIR"

# Check for required tools
check_requirements() {
    print_status "Checking requirements..."
    
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed. Please install Node.js 20+ first."
        exit 1
    fi
    
    local node_version=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$node_version" -lt 20 ]; then
        print_error "Node.js version must be 20+. Current: $(node -v)"
        exit 1
    fi
    
    print_success "Node.js $(node -v) is installed"
    
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed"
        exit 1
    fi
    
    print_success "All requirements met"
}

# Install OpenClaw if not installed
install_openclaw() {
    print_status "Checking for OpenClaw..."
    
    if command -v openclaw &> /dev/null; then
        print_success "OpenClaw is already installed: $(openclaw --version 2>/dev/null || echo 'version unknown')"
    else
        print_status "Installing OpenClaw..."
        npm install -g openclaw@latest
        print_success "OpenClaw installed"
    fi
}

# Build IgniteRouter
build_igniterouter() {
    print_status "Building IgniteRouter..."
    
    if [ -d "$IGNITE_ROUTER_DIR" ]; then
        cd "$IGNITE_ROUTER_DIR"
        npm install 2>/dev/null || true
        npm run build
        print_success "IgniteRouter built"
    else
        print_error "IgniteRouter directory not found at $IGNITE_ROUTER_DIR"
        exit 1
    fi
}

# Configure OpenClaw
configure_openclaw() {
    print_status "Configuring OpenClaw..."
    
    # Create OpenClaw directory if needed
    mkdir -p "$OPENCLAW_DIR"
    
    # Check if config exists
    if [ -f "$OPENCLAW_CONFIG" ]; then
        print_warning "Backing up existing config..."
        cp "$OPENCLAW_CONFIG" "$OPENCLAW_CONFIG.backup.$(date +%s)"
    fi
    
    # Create minimal config if not exists
    if [ ! -f "$OPENCLAW_CONFIG" ]; then
        cat > "$OPENCLAW_CONFIG" << 'EOF'
{
  "agents": {
    "defaults": {
      "workspace": "~/.openclaw/workspace",
      "model": {
        "primary": "ignite/auto"
      }
    }
  },
  "gateway": {
    "mode": "local",
    "auth": {
      "mode": "token",
      "token": "dev-token-change-in-production"
    },
    "port": 18789,
    "bind": "loopback"
  }
}
EOF
        print_success "Created OpenClaw config"
    else
        # Update existing config to use ignite/auto
        print_status "Updating existing config..."
    fi
    
    # Add/update models.providers section
    python3 -c "
import json
import sys

config_file = '$OPENCLAW_CONFIG'

try:
    with open(config_file, 'r') as f:
        config = json.load(f)
except:
    print('Could not parse config, creating new one')
    config = {
        'agents': {'defaults': {'model': {'primary': 'ignite/auto'}}},
        'gateway': {'mode': 'local', 'port': $GATEWAY_PORT}
    }

# Ensure models.providers exists
if 'models' not in config:
    config['models'] = {'mode': 'merge', 'providers': {}}

if 'providers' not in config['models']:
    config['models']['providers'] = {}

# Add default providers (you can customize these)
config['models']['providers']['deepseek'] = {
    'baseUrl': 'https://api.deepseek.com',
    'api': 'openai-completions',
    'models': [
        {
            'id': 'deepseek-chat',
            'name': 'DeepSeek Chat',
            'input': ['text'],
            'contextWindow': 131072,
            'cost': {'input': 0.28, 'output': 0.42}
        },
        {
            'id': 'deepseek-reasoner',
            'name': 'DeepSeek Reasoner',
            'input': ['text'],
            'reasoning': True,
            'contextWindow': 131072,
            'cost': {'input': 0.28, 'output': 0.42}
        }
    ]
}

config['models']['providers']['xiaomi'] = {
    'baseUrl': 'https://api.xiaomimimo.com/v1',
    'api': 'openai-completions',
    'models': [
        {
            'id': 'mimo-v2-flash',
            'name': 'Xiaomi MiMo V2 Flash',
            'input': ['text'],
            'cost': {'input': 0, 'output': 0},
            'contextWindow': 262144
        },
        {
            'id': 'mimo-v2-pro',
            'name': 'Xiaomi MiMo V2 Pro',
            'input': ['text'],
            'reasoning': True,
            'cost': {'input': 0, 'output': 0},
            'contextWindow': 1048576
        }
    ]
}

config['models']['providers']['mistral'] = {
    'baseUrl': 'https://api.mistral.ai/v1',
    'api': 'openai-completions',
    'models': [
        {
            'id': 'mistral-large-latest',
            'name': 'Mistral Large',
            'input': ['text', 'image'],
            'cost': {'input': 0.5, 'output': 1.5},
            'contextWindow': 262144
        }
    ]
}

# Ensure default model is ignite/auto
if 'agents' not in config:
    config['agents'] = {'defaults': {}}
if 'model' not in config['agents']['defaults']:
    config['agents']['defaults']['model'] = {'primary': 'ignite/auto'}
config['agents']['defaults']['model']['primary'] = 'ignite/auto'

# Add igniterouter plugin
if 'plugins' not in config:
    config['plugins'] = {'entries': {}}
config['plugins']['entries']['igniterouter'] = {
    'enabled': True,
    'config': {
        'defaultPriority': 'cost'
    }
}

with open(config_file, 'w') as f:
    json.dump(config, f, indent=2)

print('Config updated successfully')
" 2>/dev/null || print_warning "Could not update config automatically. Please edit $OPENCLAW_CONFIG manually."
    
    print_success "OpenClaw configured"
}

# Install IgniteRouter plugin
install_plugin() {
    print_status "Installing IgniteRouter plugin..."
    
    # Create plugin directory
    mkdir -p "$IGNITROUTER_PLUGIN_DIR"
    
    # Copy built files
    if [ -d "$IGNITE_ROUTER_DIR/dist" ]; then
        cp -r "$IGNITE_ROUTER_DIR/dist/"* "$IGNITROUTER_PLUGIN_DIR/"
        print_success "Plugin files copied to $IGNITROUTER_PLUGIN_DIR"
    else
        print_error "IgniteRouter dist folder not found. Run 'npm run build' first."
        exit 1
    fi
}

# Start OpenClaw gateway
start_gateway() {
    print_status "Starting OpenClaw gateway..."
    
    # Kill existing gateway if running
    pkill -f "openclaw gateway" 2>/dev/null || true
    sleep 1
    
    # Start gateway in background
    openclaw gateway &
    GATEWAY_PID=$!
    
    # Wait for gateway to start
    print_status "Waiting for gateway to start..."
    local max_attempts=30
    local attempt=0
    while [ $attempt -lt $max_attempts ]; do
        if curl -s "http://localhost:$GATEWAY_PORT/health" > /dev/null 2>&1; then
            print_success "Gateway started on port $GATEWAY_PORT"
            break
        fi
        sleep 1
        attempt=$((attempt + 1))
    done
    
    if [ $attempt -eq $max_attempts ]; then
        print_warning "Gateway may not have started. Check with 'openclaw logs'"
    fi
}

# Verify setup
verify_setup() {
    print_status "Verifying setup..."
    
    local success=true
    
    # Check if proxy is running
    if curl -s "http://localhost:$PORT/health" > /dev/null 2>&1; then
        print_success "IgniteRouter proxy is running on port $PORT"
        
        # Show health info
        echo ""
        curl -s "http://localhost:$PORT/health" | python3 -m json.tool 2>/dev/null || echo "  (health check response)"
    else
        print_warning "IgniteRouter proxy not responding on port $PORT"
        success=false
    fi
    
    # Check if models are available
    if curl -s "http://localhost:$PORT/v1/models" > /dev/null 2>&1; then
        print_success "Models API responding"
    else
        print_warning "Models API not responding"
    fi
    
    # Check gateway
    if curl -s "http://localhost:$GATEWAY_PORT/health" > /dev/null 2>&1; then
        print_success "OpenClaw gateway is running on port $GATEWAY_PORT"
    else
        print_warning "OpenClaw gateway not responding on port $GATEWAY_PORT"
    fi
    
    echo ""
    if [ "$success" = true ]; then
        print_success "Setup complete!"
    else
        print_warning "Setup completed with warnings. Check logs for issues."
    fi
}

# Test routing
test_routing() {
    print_status "Testing routing with sample prompts..."
    
    local prompts=(
        "What is 2+2?"
        "Explain TCP/IP"
        "Build a React component"
        "Prove sqrt(2) is irrational"
    )
    
    for prompt in "${prompts[@]}"; do
        echo ""
        print_status "Testing: \"$prompt\""
        
        curl -s -X POST "http://localhost:$PORT/v1/chat/completions" \
            -H "Content-Type: application/json" \
            -d "{\"model\": \"igniterouter/auto\", \"messages\": [{\"role\": \"user\", \"content\": \"$prompt\"}], \"max_tokens\": 10}" \
            -w "\n  Status: %{http_code}\n" \
            -o /dev/null 2>&1 || true
    done
    
    print_success "Routing test complete"
}

# Main execution
main() {
    check_requirements
    install_openclaw
    build_igniterouter
    configure_openclaw
    install_plugin
    start_gateway
    verify_setup
    
    echo ""
    echo -e "${BLUE}==================================================${NC}"
    echo -e "${GREEN}  Setup Complete!${NC}"
    echo -e "${BLUE}==================================================${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Add your API keys to $OPENCLAW_CONFIG"
    echo "  2. Restart gateway: openclaw gateway restart"
    echo "  3. View logs: openclaw logs --follow"
    echo "  4. Test routing: curl http://localhost:$PORT/v1/models"
    echo ""
    echo "Configuration file: $OPENCLAW_CONFIG"
    echo "Plugin directory: $IGNITROUTER_PLUGIN_DIR"
    echo ""
}

# Run main
main "$@"
