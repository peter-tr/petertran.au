import { randomUUID } from "node:crypto";
import { getAnthropicClient } from "api-shared/anthropic-client";
import { assertAiNotRateLimited } from "../util/ai-rate-limit";
import type { DesignElementRecord, DesignElementType } from "../design";

const MAX_PROMPT_LENGTH = 300;
const MAX_ELEMENTS = 12;

interface RawElement {
  type: DesignElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  text: string | null;
  fontFamily: string | null;
  fontSize: number | null;
  fontWeight: number | null;
}

interface RawGenerateResult {
  elements: RawElement[];
}

// Top-level must be an object (Anthropic's json_schema output doesn't allow
// a bare array at the root), hence wrapping the actual list in "elements".
const GENERATE_ELEMENTS_SCHEMA = {
  type: "object",
  properties: {
    elements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["RECTANGLE", "ELLIPSE", "TEXT"] },
          x: { type: "number" },
          y: { type: "number" },
          width: { type: "number" },
          height: { type: "number" },
          rotation: { type: "number" },
          fill: { type: "string" },
          stroke: { type: "string" },
          strokeWidth: { type: "number" },
          text: { anyOf: [{ type: "string" }, { type: "null" }] },
          fontFamily: { anyOf: [{ type: "string" }, { type: "null" }] },
          fontSize: { anyOf: [{ type: "number" }, { type: "null" }] },
          fontWeight: { anyOf: [{ type: "number" }, { type: "null" }] },
        },
        required: [
          "type",
          "x",
          "y",
          "width",
          "height",
          "rotation",
          "fill",
          "stroke",
          "strokeWidth",
          "text",
          "fontFamily",
          "fontSize",
          "fontWeight",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["elements"],
  additionalProperties: false,
} as const;

function buildSystemPrompt(width: number, height: number, isRefinement: boolean): string {
  const refinementNote = isRefinement
    ? `\n\nThe user already has a draft, provided as JSON in their message alongside the instruction. Treat the instruction as a follow-up refinement of that draft (e.g. "make the text bigger", "change the colors to blue", "add a subtitle") rather than a request to start over. Return the COMPLETE updated set of elements - everything from the existing draft that the instruction didn't ask to change should come back unchanged, not be dropped.`
    : "";

  return `You generate a small set of design elements for a poster/slide/resume-style canvas editor (like a simplified Canva), from a short natural-language prompt.

The canvas is ${width}x${height} px, origin (0,0) at the top-left. Generate between 2 and ${MAX_ELEMENTS} elements that together form a coherent, reasonably attractive layout matching the prompt - typically a background rectangle, a heading, supporting text, and a couple of accent shapes.

Rules:
- Keep every element's x/y/width/height fully within the canvas bounds (0..${width} horizontally, 0..${height} vertically) - nothing may hang off the edge.
- "fill"/"stroke" are hex colors (e.g. "#1a1a2e"); use "stroke": "" and "strokeWidth": 0 when an element has no border.
- Only TEXT elements set "text"/"fontFamily"/"fontSize"/"fontWeight" (fontWeight 400 for regular, 600-700 for bold) - set all four to null for RECTANGLE/ELLIPSE.
- "rotation" is degrees, 0 unless the prompt implies an angled element.
- Order elements back-to-front (large background shapes first, text and accents last) - the caller assigns stacking order from this array's order, not from any field you return.
- Use a cohesive color palette (2-4 colors) that fits the prompt's mood/theme rather than random colors per element.${refinementNote}`;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;

  return Math.min(Math.max(value, min), max);
}

// The model supplies visual properties only - id and stacking order are
// assigned here rather than trusted from its output, same "never trust the
// model for identity" discipline as pantry's itemId hallucination guard.
// Sizes/positions are clamped defensively too, since a model-picked layout
// isn't guaranteed to respect the bounds it was told about.
function sanitizeElement(
  raw: RawElement,
  width: number,
  height: number,
  zIndex: number
): DesignElementRecord {
  const w = clamp(raw.width, 5, width);
  const h = clamp(raw.height, 5, height);
  const x = clamp(raw.x, 0, width - w);
  const y = clamp(raw.y, 0, height - h);
  const isText = raw.type === "TEXT";
  const fontSize = raw.fontSize && raw.fontSize > 0 ? raw.fontSize : 20;

  return {
    id: randomUUID(),
    type: raw.type,
    x,
    y,
    width: w,
    height: h,
    rotation: Number.isFinite(raw.rotation) ? raw.rotation : 0,
    zIndex,
    fill: raw.fill || "#63c7be",
    stroke: raw.stroke ?? "",
    strokeWidth: raw.strokeWidth > 0 ? raw.strokeWidth : 0,
    text: isText ? (raw.text ?? "") : undefined,
    fontFamily: isText ? (raw.fontFamily ?? "IBM Plex Sans") : undefined,
    fontSize: isText ? fontSize : undefined,
    fontWeight: isText ? (raw.fontWeight ?? 400) : undefined,
  };
}

export async function generateDesignElements(
  prompt: string,
  width: number,
  height: number,
  currentElements: DesignElementRecord[] | undefined,
  sourceIp: string | undefined
): Promise<DesignElementRecord[]> {
  const trimmed = prompt.trim();
  if (!trimmed) throw new Error("A prompt is required.");
  if (trimmed.length > MAX_PROMPT_LENGTH) {
    throw new Error(`Keep the prompt under ${MAX_PROMPT_LENGTH} characters.`);
  }
  if (width <= 0 || height <= 0) throw new Error("width/height must be positive.");

  await assertAiNotRateLimited(sourceIp);

  const isRefinement = !!currentElements?.length;
  const userContent = isRefinement
    ? `Current draft (JSON): ${JSON.stringify(currentElements)}\n\nInstruction: ${trimmed}`
    : trimmed;

  const client = await getAnthropicClient();
  const response = await client.messages.parse({
    model: "claude-haiku-4-5",
    max_tokens: 2048,
    system: buildSystemPrompt(width, height, isRefinement),
    messages: [{ role: "user", content: userContent }],
    output_config: { format: { type: "json_schema", schema: GENERATE_ELEMENTS_SCHEMA } },
  });

  const parsed = response.parsed_output as RawGenerateResult | null;
  if (!parsed || !parsed.elements.length) {
    throw new Error("Claude didn't return a usable design - try rephrasing the prompt.");
  }

  return parsed.elements.slice(0, MAX_ELEMENTS).map((el, index) => sanitizeElement(el, width, height, index));
}
