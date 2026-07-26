export interface AiStylePreset {
  key: string;
  label: string;
  // Appended to the user's own prompt when generating (see
  // EditorWorkspace's handleGenerate) - null for "None", which sends the
  // prompt exactly as typed.
  descriptor: string | null;
}

export const AI_STYLE_PRESETS: AiStylePreset[] = [
  { key: "none", label: "None", descriptor: null },
  { key: "fancy", label: "Fancy", descriptor: "fancy, ornate, luxurious" },
  { key: "classic", label: "Classic", descriptor: "classic, timeless, elegant" },
  { key: "vintage", label: "Vintage", descriptor: "vintage, retro" },
  { key: "funny", label: "Funny", descriptor: "playful, funny, humorous" },
];
