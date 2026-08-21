import { invokeLLM, listLLMModels } from "./_core/llm";

export type TranslationInputCue = { id: string; richText: string; plainText: string };
export type TranslationOutputCue = { id: string; richText: string; plainText: string };

const formattingPattern = /(\{\\[^}]+\}|<\/?[^>]+>)/g;

export function protectFormattingTokens(value: string) {
  const tokens: string[] = [];
  const protectedText = value.replace(formattingPattern, token => {
    const placeholder = `⟦FMT_${tokens.length}⟧`;
    tokens.push(token);
    return placeholder;
  });
  return { protectedText, tokens };
}

export function restoreFormattingTokens(value: string, tokens: string[]) {
  let restored = value;
  for (let index = 0; index < tokens.length; index += 1) {
    const placeholder = `⟦FMT_${index}⟧`;
    const occurrences = restored.split(placeholder).length - 1;
    if (occurrences !== 1) throw new Error("The translation did not preserve every formatting token exactly once.");
    restored = restored.replace(placeholder, tokens[index]);
  }
  return restored;
}

export async function translateCueBatch(cues: TranslationInputCue[], targetLanguage: string, sourceLanguage = "auto") {
  if (!cues.length) return { model: "", cues: [] as TranslationOutputCue[] };
  if (cues.length > 50) throw new Error("Translate no more than 50 cues per batch to preserve context and response reliability.");
  const protectedCues = cues.map(cue => ({ id: cue.id, ...protectFormattingTokens(cue.richText) }));
  const { data: catalog } = await listLLMModels();
  const model = catalog.find(item => item.id === "gpt-5-mini")?.id || catalog[0]?.id;
  if (!model) throw new Error("No translation model is available for this project.");
  const response = await invokeLLM({
    model,
    messages: [
      {
        role: "system",
        content: "You translate professional screen subtitles. Preserve dialogue register, tone, idioms, speaker intent, line breaks, and every protected formatting token exactly once. Never add explanations. Keep text concise enough for subtitles.",
      },
      {
        role: "user",
        content: `Translate the following subtitle cues from ${sourceLanguage} to ${targetLanguage}. Context matters across adjacent cues. Do not modify tokens such as ⟦FMT_0⟧.\n\n${JSON.stringify(protectedCues)}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "subtitle_translations",
        strict: true,
        schema: {
          type: "object",
          properties: {
            translations: {
              type: "array",
              items: {
                type: "object",
                properties: { id: { type: "string" }, text: { type: "string" } },
                required: ["id", "text"],
                additionalProperties: false,
              },
            },
          },
          required: ["translations"],
          additionalProperties: false,
        },
      },
    },
  });
  const content = response.choices[0]?.message.content;
  if (typeof content !== "string") throw new Error("Translation model returned an invalid response.");
  const parsed = JSON.parse(content) as { translations: Array<{ id: string; text: string }> };
  if (parsed.translations.length !== cues.length) throw new Error("Translation response was incomplete; no changes were saved.");
  const outputs = cues.map(cue => {
    const translation = parsed.translations.find(item => item.id === cue.id);
    if (!translation) throw new Error("Translation response omitted a cue; no changes were saved.");
    const tokenSet = protectedCues.find(item => item.id === cue.id)!;
    const richText = restoreFormattingTokens(translation.text, tokenSet.tokens);
    return { id: cue.id, richText, plainText: richText.replace(formattingPattern, "").replace(/\\N/g, " ").trim() };
  });
  return { model, cues: outputs };
}
