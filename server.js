import express from 'express';
import cors from 'cors';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const app = express();
app.use(cors());
app.use(express.json());

let mcpClient = null;

async function setupMcpClient() {
  try {
    // Connect to the custom Garmin MCP server
    // Assuming it's an npx executable or python script. We'll use npx for generic github repo
    // If it's a python server, it might be run via `uvx` or `python -m`. 
    // We will set a placeholder that the user can configure.
    const transport = new StdioClientTransport({
      command: 'npx',
      args: ['-y', 'github:Taxuspt/garmin_mcp'], 
      // If it's a python server: command: 'uvx', args: ['garmin_mcp']
    });

    mcpClient = new Client(
      { name: 'stride-ai-client', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    await mcpClient.connect(transport);
    console.log('Connected to Garmin MCP Server');
    
    // Optionally fetch tools
    // const tools = await mcpClient.listTools();
    // console.log('Available tools:', tools);

  } catch (err) {
    console.error('Failed to connect to MCP server:', err.message);
  }
}

// setupMcpClient(); // Uncomment to actually connect if the garmin_mcp is properly installed/accessible

app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  
  console.log(`Received message for Gemma4:e4b: ${message}`);
  
  try {
    // Attempt to call Ollama running locally with gemma4:e4b
    const response = await fetch('http://127.0.0.1:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gemma4:e4b',
        messages: [{ role: 'user', content: message }],
        stream: false
      })
    });

    if (response.ok) {
      const data = await response.json();
      return res.json({ response: data.message.content });
    } else {
      throw new Error(`Ollama returned status: ${response.status}`);
    }
  } catch (err) {
    console.error('Ollama connection failed, falling back to simulated response.', err.message);
    // Fallback if Ollama is not running
    res.json({
      response: `[Simulated Gemma4:e4b Response] I received your message: "${message}". Connect to Ollama to enable real AI processing.`
    });
  }
});

app.get('/api/stats', async (req, res) => {
  if (!mcpClient) {
    return res.json({
      distance: '12.4',
      pace: '5.40',
      target: '45',
      vo2max: '52.4'
    });
  }
  
  try {
    // Call a hypothetical tool on the Garmin MCP server
    const result = await mcpClient.callTool({
      name: 'get_daily_stats',
      arguments: {}
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
