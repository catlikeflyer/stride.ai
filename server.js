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
  let systemInstructions = 'You are Coach KAI, a premium AI running coach. Be concise, highly professional, encouraging, and focus on physiological optimization. ';
  if (latestTelemetryCache) {
    systemInstructions += `\n\nPersonalized Garmin Telemetry Context:
- Athlete: ${latestTelemetryCache.displayName}
- Today's Date: ${latestTelemetryCache.date}
- Current Stats: ${latestTelemetryCache.distance} km, ${latestTelemetryCache.steps} steps (Goal: ${latestTelemetryCache.stepGoal})
- Calories Burned: ${latestTelemetryCache.calories} kcal
- Resting Heart Rate: ${latestTelemetryCache.restingHr} bpm (Max today: ${latestTelemetryCache.maxHr} bpm)
- Stress: ${latestTelemetryCache.stressLevel} (${latestTelemetryCache.stressQualifier})
- Body Battery: Current ${latestTelemetryCache.bodyBatteryCurrent}/100 (Highest: ${latestTelemetryCache.bodyBatteryHighest}, Lowest: ${latestTelemetryCache.bodyBatteryLowest})
- Running VO2 Max: ${latestTelemetryCache.vo2max}
- Pace of Last Run: ${latestTelemetryCache.pace} min/km
- Recent Sessions:
${latestTelemetryCache.recentActivities.slice(0, 3).map(a => `  * ${a.name} (${a.type}): ${a.distance} km, ${a.duration} mins, Avg HR: ${a.avgHr} bpm`).join('\n')}`;
  }

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
      return res.json({ response: data.message.content });
    } else {
      throw new Error(`Ollama returned status: ${response.status}`);
    }
  } catch (err) {
    console.error('Ollama connection failed, falling back to simulated response.', err.message);
    res.json({
      response: `[Simulated Coach KAI Response] I received your message: "${message}". Connect to Ollama with model "${ollamaModel}" to enable real AI coaching responses.`
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
