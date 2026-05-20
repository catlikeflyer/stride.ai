import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const app = express();
app.use(cors());
app.use(express.json());

let mcpClient = null;
let latestTelemetryCache = null;
let ollamaTools = [];

async function setupMcpClient() {
  const command = process.env.GARMIN_MCP_COMMAND || 'uvx';
  const args = (process.env.GARMIN_MCP_ARGS || '')
    .split(',')
    .map(arg => arg.trim())
    .filter(Boolean);

  console.log(`Starting Garmin MCP connection: ${command} ${args.join(' ')}`);

  try {
    const transport = new StdioClientTransport({
      command,
      args
    });

    mcpClient = new Client(
      { name: 'stride-ai-client', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    await mcpClient.connect(transport);
    console.log('Connected to Garmin MCP Server');

    // Populate Ollama tools list with a curated selection of core tools to prevent prompt-bloat
    try {
      const toolsRes = await mcpClient.listTools();
      const allowedTools = [
        'get_stats',
        'get_user_profile',
        'get_activities',
        'get_sleep_data',
        'get_hrv_data',
        'get_training_status',
        'get_vo2max_trend',
        'get_hrv_trend',
        'get_training_load_trend',
        'get_workouts',
        'schedule_workout'
      ];
      ollamaTools = (toolsRes.tools || [])
        .filter(t => allowedTools.includes(t.name))
        .map(tool => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema
          }
        }));
      console.log(`Successfully mapped ${ollamaTools.length} core Garmin tools for AI usage`);
    } catch (toolListErr) {
      console.warn('Failed to fetch tool definitions from Garmin MCP:', toolListErr.message);
    }

    // Warm up the telemetry cache immediately
    await refreshTelemetry();
  } catch (err) {
    console.error('Failed to connect to MCP server:', err.message);
  }
}

// Helper function to fetch and cache Garmin telemetry
async function refreshTelemetry() {
  if (!mcpClient) return null;

  try {
    const todayStr = new Date().toLocaleDateString('sv-SE');
    
    // 1. Fetch daily stats
    let statsData = {};
    try {
      const statsRes = await mcpClient.callTool({
        name: 'get_stats',
        arguments: { date: todayStr }
      });
      statsData = JSON.parse(statsRes.content[0].text);
    } catch (e) {
      console.warn('get_stats failed:', e.message);
    }

    // 2. Fetch user profile
    let profileData = {};
    try {
      const profileRes = await mcpClient.callTool({
        name: 'get_user_profile',
        arguments: {}
      });
      profileData = JSON.parse(profileRes.content[0].text);
    } catch (e) {
      console.warn('get_user_profile failed:', e.message);
    }

    // 3. Fetch full name
    let fullName = 'Jamal Sterling';
    try {
      const nameRes = await mcpClient.callTool({
        name: 'get_full_name',
        arguments: {}
      });
      fullName = nameRes.content[0].text.trim().replace(/^"|"$/g, '') || fullName;
    } catch (e) {
      console.warn('get_full_name failed:', e.message);
    }

    // 4. Fetch activities
    let activitiesData = [];
    try {
      const activitiesRes = await mcpClient.callTool({
        name: 'get_activities',
        arguments: { start: 0, limit: 5 }
      });
      const parsed = JSON.parse(activitiesRes.content[0].text);
      activitiesData = parsed.activities || [];
    } catch (e) {
      console.warn('get_activities failed:', e.message);
    }

    // Calculate pace from the latest running activity
    const runActivity = activitiesData.find(a => a.type === 'running' || a.type === 'treadmill_running');
    let paceStr = '0.00';
    if (runActivity && runActivity.distance_meters > 0) {
      const durationMin = runActivity.duration_seconds / 60;
      const distanceKm = runActivity.distance_meters / 1000;
      const paceMinPerKm = durationMin / distanceKm;
      const paceMinutes = Math.floor(paceMinPerKm);
      const paceSeconds = Math.round((paceMinPerKm - paceMinutes) * 60);
      paceStr = `${paceMinutes}:${paceSeconds < 10 ? '0' : ''}${paceSeconds}`;
    }

    // Map recent activities
    const recentActivities = activitiesData.map(act => {
      const distKm = act.distance_meters ? (act.distance_meters / 1000).toFixed(2) : '0.00';
      return {
        id: act.id,
        name: act.name,
        type: act.type,
        startTime: act.start_time,
        distance: distKm,
        duration: Math.round(act.duration_seconds / 60),
        avgHr: act.avg_hr_bpm
      };
    });

    latestTelemetryCache = {
      success: true,
      displayName: fullName,
      date: todayStr,
      distance: statsData.distance_meters ? (statsData.distance_meters / 1000).toFixed(1) : '0.0',
      steps: statsData.total_steps || 0,
      stepGoal: statsData.daily_step_goal || 0,
      calories: statsData.total_calories || 0,
      restingHr: statsData.resting_heart_rate_bpm || 0,
      maxHr: statsData.max_heart_rate_bpm || 0,
      stressLevel: statsData.avg_stress_level || 0,
      stressQualifier: statsData.stress_qualifier || 'UNKNOWN',
      bodyBatteryCurrent: statsData.body_battery_current || 0,
      bodyBatteryHighest: statsData.body_battery_highest || 0,
      bodyBatteryLowest: statsData.body_battery_lowest || 0,
      pace: paceStr,
      target: '45', // Aerobic Base Target Minutes
      vo2max: profileData.userData?.vo2MaxRunning || '52.4',
      recentActivities
    };

    return latestTelemetryCache;
  } catch (err) {
    console.error('Error refreshing Garmin telemetry:', err.message);
    return null;
  }
}

// Start the MCP connection
setupMcpClient();

app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  console.log(`Received message for Ollama: ${message}`);

  const ollamaModel = process.env.OLLAMA_MODEL || 'gemma4:e4b';
  const ollamaHost = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

  // Construct system prompt with Garmin context if available
  let systemInstructions = 'You are Coach KAI, a premium AI running coach. Be concise, highly professional, encouraging, and focus on physiological optimization. ' +
    'You have access to real-time tools via the Garmin MCP server to check athlete metrics, history, trends, workouts, and sleep. ' +
    'Always use these tools if the athlete asks about their data, progress, workouts, or performance history. ' +
    'Do not hallucinate data that requires a tool call.';

  if (latestTelemetryCache) {
    systemInstructions += `\n\nPersonalized Garmin Telemetry Context (Static Summary):
- Athlete: ${latestTelemetryCache.displayName}
- Today's Date: ${latestTelemetryCache.date}
- Current Stats: ${latestTelemetryCache.distance} km, ${latestTelemetryCache.steps} steps (Goal: ${latestTelemetryCache.stepGoal})
- Calories Burned: ${latestTelemetryCache.calories} kcal
- Resting Heart Rate: ${latestTelemetryCache.restingHr} bpm (Max today: ${latestTelemetryCache.maxHr} bpm)
- Stress: ${latestTelemetryCache.stressLevel} (${latestTelemetryCache.stressQualifier})
- Body Battery: Current ${latestTelemetryCache.bodyBatteryCurrent}/100
- Running VO2 Max: ${latestTelemetryCache.vo2max}
- Pace of Last Run: ${latestTelemetryCache.pace} min/km`;
  }

  const messages = [
    { role: 'system', content: systemInstructions },
    { role: 'user', content: message }
  ];

  const actionsTaken = [];
  let loopCount = 0;
  const maxLoops = 6;

  try {
    // If ollamaTools is empty, try to populate it now
    if (ollamaTools.length === 0 && mcpClient) {
      try {
        const toolsRes = await mcpClient.listTools();
        ollamaTools = (toolsRes.tools || []).map(tool => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema
          }
        }));
      } catch (err) {
        console.warn('Deferred tool fetching failed:', err.message);
      }
    }

    while (loopCount < maxLoops) {
      loopCount++;
      console.log(`Agent interaction loop #${loopCount}`);

      const requestBody = {
        model: ollamaModel,
        messages: messages,
        stream: false
      };

      // Only add tools parameter if we successfully loaded tools from the MCP server
      if (ollamaTools.length > 0) {
        requestBody.tools = ollamaTools;
      }

      const response = await fetch(`${ollamaHost}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error(`Ollama returned status: ${response.status}`);
      }

      const data = await response.json();
      const assistantMessage = data.message;

      // Push response from Ollama to the thread
      messages.push(assistantMessage);

      // Check for tool calls
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        console.log(`Model requested tool calls:`, JSON.stringify(assistantMessage.tool_calls));
        
        for (const call of assistantMessage.tool_calls) {
          const toolName = call.function.name;
          const toolArgs = call.function.arguments;
          
          console.log(`Executing tool: ${toolName} with args:`, toolArgs);
          
          // Format user-facing action text
          let actionLabel = `Invoked Garmin tool: ${toolName}`;
          if (toolName === 'get_stats') {
            actionLabel = `Checked daily stats for ${toolArgs.date || 'today'}`;
          } else if (toolName === 'get_activities') {
            actionLabel = `Fetched recent running logs`;
          } else if (toolName === 'get_sleep_data') {
            actionLabel = `Analyzed sleep metrics for ${toolArgs.date || 'last night'}`;
          } else if (toolName === 'get_hrv_trend') {
            actionLabel = `Fetched HRV progression trends`;
          } else if (toolName === 'get_training_status') {
            actionLabel = `Loaded training status metrics`;
          } else if (toolName === 'get_vo2max_trend') {
            actionLabel = `Checked VO2 Max trend`;
          }
          actionsTaken.push(actionLabel);

          let resultText = '';
          try {
            const toolResult = await mcpClient.callTool({
              name: toolName,
              arguments: toolArgs
            });
            resultText = toolResult.content.map(c => c.text).join('\n');
          } catch (toolErr) {
            console.error(`Error executing tool ${toolName}:`, toolErr.message);
            resultText = JSON.stringify({ error: toolErr.message });
          }

          messages.push({
            role: 'tool',
            content: resultText,
            tool_call_id: call.id
          });
        }
        // Proceed with next loop to let Ollama inspect the tool outputs
      } else {
        // No tool calls, we have the final assistant message
        return res.json({
          response: assistantMessage.content,
          actions: actionsTaken
        });
      }
    }

    // If we exceed loop count
    return res.json({
      response: messages[messages.length - 1].content || "I have gathered the data but need to pause my thinking loop here.",
      actions: actionsTaken
    });

  } catch (err) {
    console.error('Ollama tool-calling chat failed, falling back.', err.message);
    
    // Fallback: If Ollama fails because of the tools parameter, try a standard completion without tools
    try {
      const response = await fetch(`${ollamaHost}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: ollamaModel,
          messages: [
            { role: 'system', content: systemInstructions },
            { role: 'user', content: message }
          ],
          stream: false
        })
      });

      if (response.ok) {
        const data = await response.json();
        return res.json({
          response: data.message.content,
          actions: ['Garmin Connection Offline - Standard response generated']
        });
      }
    } catch (fallbackErr) {
      console.error('Fallback failed:', fallbackErr.message);
    }

    res.json({
      response: `[Simulated Coach KAI Response] I received your message: "${message}". Connect to Ollama with model "${ollamaModel}" to enable real AI coaching responses.`,
      actions: ['Garmin Connection Offline - Mock response generated']
    });
  }
});

app.get('/api/stats', async (req, res) => {
  // Try to refresh telemetry on demand
  const telemetry = await refreshTelemetry();
  
  if (telemetry) {
    return res.json(telemetry);
  }

  // Fallback to default mock data if not connected/failed
  res.json({
    success: false,
    displayName: 'Jamal Sterling',
    distance: '12.4',
    pace: '5:40',
    target: '45',
    vo2max: '52.4',
    recentActivities: [
      { id: 1, name: 'Evening Run', type: 'running', startTime: '2026-05-18 18:30:00', distance: '5.20', duration: 28, avgHr: 142 },
      { id: 2, name: 'Tempo Session', type: 'running', startTime: '2026-05-16 07:15:00', distance: '8.50', duration: 42, avgHr: 158 }
    ]
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
