# STRIDE.AI - Running Coach Agent

This project implements a custom running coach AI agent utilizing Gemma 4b and the Garmin MCP server.

## Features
- **Modern Neon UI**: Replicates the STRIDE.AI dashboard mock with neon yellow, cyan, and a dark theme.
- **Coach KAI AI**: Integrated chat interface built to connect to a local Ollama instance running `gemma:4b`.
- **Garmin MCP Integration**: The backend uses the `@modelcontextprotocol/sdk` to connect to `github:Taxuspt/garmin_mcp` for retrieving fitness telemetry.

## Setup Instructions

### 1. Install Dependencies
```bash
npm install
```

### 2. Run the Express Backend Server
The backend handles the connection to the local Gemma model and the Garmin MCP server.
```bash
npm run server
```
*Note: Make sure Ollama is installed and you have pulled the model (`ollama pull gemma4:e4b`). The backend will gracefully fall back to a simulated response if Ollama is not detected.*

### 3. Run the Frontend Dashboard
In a new terminal window, start the Vite React application:
```bash
npm run dev
```

### 4. Garmin MCP Server (Optional)
The backend is pre-configured to launch the Garmin MCP via `npx` or stdio execution. If you need to authenticate or configure specific Garmin credentials, you may need to set environment variables according to the `Taxuspt/garmin_mcp` documentation.
