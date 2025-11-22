import { VertexAI } from "@google-cloud/vertexai";

const project = process.env.GCP_PROJECT_ID;
const location = process.env.GCP_LOCATION;
const geminiModel = process.env.VERTEX_GEMINI_MODEL || "gemini-1.5-flash";
const useVertex = ["1", "true", "yes"].includes(
  (process.env.USE_VERTEX_AI || "").toLowerCase()
);

let generativeModel = null;
let tsModelName = process.env.VERTEX_TS_MODEL || null;

export const initVertex = () => {
  if (!useVertex) return false;
  if (!project || !location || !geminiModel) return false;
  const vertexAI = new VertexAI({ project, location });
  generativeModel = vertexAI.getGenerativeModel({ model: geminiModel });
  return true;
};

export const hasVertex = () => useVertex && !!generativeModel;

const parseJsonFromText = (text) => {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
};

export const runPitStrategist = async (payload) => {
  if (!hasVertex()) throw new Error("Vertex not configured");
  const { question, currentLap, bestLap, tireAge } = payload;
  const prompt = `
You are an endurance pit strategist. Given the context, return a strict JSON:
{
  "actions": [
    { "pit_lap": number, "rationale": string, "confidence": number, "json_patch": object }
  ],
  "text": string
}
Use confidence 0..1. Do NOT include any other keys.
Context:
- Question: ${question || "N/A"}
- Current lap: ${currentLap ?? "-"}
- Best pit lap: ${bestLap ?? "-"}
- Tire age: ${tireAge ?? "-"}
Respond ONLY with JSON.
`;

  const result = await generativeModel.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 256 }
  });

  const text = result.response?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const parsed = parseJsonFromText(text);
  if (!parsed || !parsed.actions) {
    throw new Error("Unparseable Vertex response");
  }
  return {
    ...parsed,
    latency_ms: result.response?.promptFeedback?.latencyMs || null,
    provider: "vertex"
  };
};

export const runAnomalyScan = async (payload) => {
  if (!hasVertex()) throw new Error("Vertex not configured");
  const { lap, signals } = payload;
  const prompt = `
You are a motorsport telemetry anomaly detector. Return JSON:
{
  "anomalies": [
    { "signal": string, "zscore": number, "message": string, "severity": "low"|"medium"|"high"|"info" },
  ],
  "text": string
}
Only include anomalies with |zscore| >= 1.0. Severity rule: z>=2.5 -> high, 1.5-2.49 -> medium, 1.0-1.49 -> low, else info.
Signals: ${JSON.stringify(signals || {})}
Lap: ${lap ?? "-"}
Respond ONLY with JSON.
`;
  const result = await generativeModel.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 256 }
  });
  const text = result.response?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const parsed = parseJsonFromText(text);
  if (!parsed || !parsed.anomalies) throw new Error("Unparseable Vertex response");
  return {
    ...parsed,
    latency_ms: result.response?.promptFeedback?.latencyMs || null,
    provider: "vertex"
  };
};

export const runExplanation = async (payload) => {
  if (!hasVertex()) throw new Error("Vertex not configured");
  const { strategy, prev } = payload;
  const prompt = `
You are a pit strategy explainer. Return JSON:
{
  "summary": string,
  "delta": string
}
Explain the current strategy vs previous.
Current: ${JSON.stringify(strategy || {})}
Previous: ${JSON.stringify(prev || {})}
Respond ONLY with JSON.
`;
  const result = await generativeModel.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 180 }
  });
  const text = result.response?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const parsed = parseJsonFromText(text);
  if (!parsed || !parsed.summary) throw new Error("Unparseable Vertex response");
  return {
    ...parsed,
    latency_ms: result.response?.promptFeedback?.latencyMs || null,
    provider: "vertex"
  };
};
