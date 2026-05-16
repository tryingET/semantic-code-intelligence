# Ontology-LSP Web UI Dashboard

A real-time monitoring dashboard for the Ontology-LSP system, providing insights into system health, performance metrics, and learning statistics.

## Features

- **System Health Monitoring**: Real-time status indicators and uptime tracking
- **Performance Metrics**: Request counts, latency percentiles, and error rates
- **Cache Analytics**: Hit rates, cache performance, and optimization insights
- **Layer Performance**: Individual layer metrics with health indicators
- **Learning Statistics**: Pattern learning progress and concept tracking
- **Recent Errors**: Real-time error monitoring and debugging information
- **Auto-Refresh**: Automatic data updates every 5 seconds
- **Responsive Design**: Works on desktop and mobile devices

## Architecture

The dashboard is a single-page application built with vanilla HTML, CSS, and JavaScript:

```
web-ui/
├── dist/
│   └── index.html          # Complete dashboard (self-contained)
├── test-dashboard.cjs      # API connectivity test script
└── README.md              # This file
```

## Quick Start

### Option 1: Direct File Access
Open the dashboard directly in your browser:
```bash
# From the ontology-lsp root directory
open web-ui/dist/index.html
# or
xdg-open web-ui/dist/index.html
```

### Option 2: Docker Compose (Recommended)
The dashboard is integrated into the docker-compose stack:
```bash
docker-compose up web-ui
# Dashboard available at: http://localhost:8080
```

### Option 3: Local HTTP Server
Serve the dashboard with any HTTP server:
```bash
cd web-ui/dist
python3 -m http.server 8080
# Dashboard available at: http://localhost:8080
```

## API Integration

The dashboard connects to the Ontology-LSP HTTP API on port 7000:

### Required Endpoints
- `GET /health` - System health check
- `GET /api/v1/monitoring` - Detailed monitoring data

### Configuration
The dashboard automatically connects to `http://localhost:7000`. For different configurations:

1. Edit `web-ui/dist/index.html`
2. Update the `apiBase` property in the `OntologyDashboard` class:
   ```javascript
   this.apiBase = 'http://your-ontology-lsp-host:7000';
   ```

## Testing

Test API connectivity before using the dashboard:
```bash
cd web-ui
node test-dashboard.cjs
```

Expected output:
```
🧪 Testing Ontology-LSP Dashboard API Connectivity

Testing Health Check (/health)...
✅ Success: 3 keys

Testing Stats (/api/v1/stats)...
✅ Success: 2 keys

Testing Monitoring (/api/v1/monitoring)...
✅ Success: 2 keys
  📊 Monitoring data structure:
    - System Health: healthy
    - Performance: 0 requests
    - Cache: 0% hit rate
    - Layers: 5 layers
    - Learning: 0 patterns
```

## Features in Detail

### System Health Card
- **Overall Status**: Healthy/Degraded indicator
- **Uptime**: System runtime since last restart
- **Total Requests**: Cumulative request count

### Performance Metrics Card
- **Average Latency**: Mean response time across all requests
- **P95 Latency**: 95th percentile response time
- **Error Rate**: Percentage of failed requests with visual progress bar

### Cache Performance Card
- **Hit Rate**: Percentage of cache hits with visual progress bar
- **Cache Hits/Misses**: Absolute numbers for cache performance

### Layer Performance Card
- **5 Processing Layers**: Individual metrics for each processing layer
  - Layer 1: Fast Search (target: <5ms)
  - Layer 2: AST Analysis (target: <50ms)
  - Layer 3: Planner (target: <10ms)
  - Layer 4: Semantic Graph (target: <10ms)
  - Layer 4: Semantic Graph (target: <10ms)
  - Layer 5: Pattern Learning & Spread (target: <20ms)
- **Health Indicators**: Visual status for each layer
- **Request Counts**: Number of requests processed per layer

### Recent Errors Card
- **Last 5 Errors**: Most recent error messages
- **Timestamps**: When each error occurred
- **Layer Context**: Which layer generated the error

### Learning Statistics Card
- **Patterns Learned**: Number of code patterns discovered
- **Concepts Tracked**: Total concepts in the knowledge graph
- **Learning Accuracy**: Effectiveness of pattern prediction

## Keyboard Shortcuts

- **F5** or **Ctrl+R**: Manual refresh
- **Auto-refresh**: Every 5 seconds when not loading

## Customization

### Colors and Themes
The dashboard uses CSS custom properties for easy theming. Key colors:
- Primary: `#4f46e5` (Indigo)
- Success: `#10b981` (Emerald) 
- Warning: `#f59e0b` (Amber)
- Error: `#ef4444` (Red)

### Refresh Interval
Change auto-refresh frequency in the JavaScript:
```javascript
this.refreshInterval = 10000; // 10 seconds instead of 5
```

## Browser Compatibility

- **Chrome/Chromium**: 80+
- **Firefox**: 75+
- **Safari**: 13+
- **Edge**: 80+

## Security

The dashboard only reads data from the API and does not expose any write operations. It includes:
- CORS support for cross-origin requests
- Error boundary handling
- Request timeout protection
- Connection retry logic

## Performance

- **Bundle Size**: ~50KB (single HTML file)
- **Memory Usage**: <10MB typical
- **Network**: Minimal API calls every 5 seconds
- **CPU Impact**: Negligible

## Troubleshooting

### Dashboard Not Loading
1. Check if Ontology-LSP HTTP server is running on port 7000
2. Test API connectivity: `curl http://localhost:7000/health`
3. Check browser console for JavaScript errors

### No Data Displayed
1. Verify monitoring endpoint: `curl http://localhost:7000/api/v1/monitoring`
2. Check if system is generating metrics (make some API calls)
3. Look for CORS issues in browser developer tools

### Connection Errors
1. Check if firewall is blocking port 7000
2. Verify API server is accepting connections from your IP
3. Test with the connectivity script: `node test-dashboard.cjs`

## Development

To modify the dashboard:

1. Edit `web-ui/dist/index.html` directly (self-contained)
2. Test changes with `node web-ui/test-dashboard.cjs`
3. Refresh the page to see updates

The dashboard is intentionally built as a single file for simplicity and easy deployment.
