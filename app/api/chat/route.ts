import { AzureOpenAI } from "openai";
import OpenAI from "openai";
import { NextResponse } from "next/server";

type AzureConfig = {
  endpoint: string;
  apiKey: string;
  deploymentName: string;
};

type ChatRequest = {
  code: string;
  prompt: string;
  azure?: AzureConfig;
};

function isChatRequest(value: unknown): value is ChatRequest {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.code === "string" && typeof v.prompt === "string";
}

export async function POST(req: Request) {
  const json = (await req.json()) as unknown;
  if (!isChatRequest(json)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const systemPrompt =
    "You are editing a React component file. Return ONLY the updated /App.js file contents. No markdown. No backticks. No explanation.";

  const userPrompt = `CURRENT_CODE\n${json.code}\n\nUSER_REQUEST\n${json.prompt}`;

  try {
    let client: OpenAI | AzureOpenAI;
    let model: string;

    if (json.azure?.endpoint && json.azure?.apiKey) {
      client = new AzureOpenAI({
        endpoint: json.azure.endpoint,
        apiKey: json.azure.apiKey,
        apiVersion: "2024-08-01-preview",
      });
      model = json.azure.deploymentName || "gpt-4o-mini";
    } else if (process.env.OPENAI_API_KEY) {
      client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      model = "gpt-4o-mini";
    } else {
      return NextResponse.json(
        { error: "No API credentials configured. Add Azure credentials in Settings or set OPENAI_API_KEY." },
        { status: 500 },
      );
    }

    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0,
    });

    const nextCode = completion.choices[0]?.message?.content;
    if (!nextCode || typeof nextCode !== "string") {
      return NextResponse.json({ error: "Model returned empty response" }, { status: 502 });
    }

    return NextResponse.json({ code: nextCode });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Upstream model request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
