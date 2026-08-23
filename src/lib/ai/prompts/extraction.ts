/**
 * Screenshot extraction prompt.
 *
 * Bump EXTRACTION_PROMPT_VERSION whenever the text changes. Every snapshot
 * records the version that produced it, so historical extractions stay
 * interpretable after the prompt evolves.
 */
export const EXTRACTION_PROMPT_VERSION = "extract-v1.0";

export interface ExtractionPromptArgs {
  knownKpis: { key: string; displayName: string; aliases: string[] }[];
  today: string;
  timezone: string;
  imageLabels: string[];
  strategy: "STANDARD" | "EXPLICIT";
}

const BASE_INSTRUCTIONS = `You extract structured business KPI data from screenshots of a retail sales performance dashboard.

RULES

1. Read only what is visibly printed. Never infer, estimate, or reconstruct a value that is not on screen.
2. Do not calculate anything. Do not sum, average, subtract, or convert. If the screen shows "7 of 12", the value is 7 — the application computes everything derived.
3. Preserve the label exactly as printed in display_name, including capitalisation and spacing.
4. Put the exact on-screen characters in raw_text (for example "7 / 12", "$1,299", "87%"), and the plain number in value.
5. Confidence is your genuine reading certainty for that specific number:
   - 0.95–1.00  crisp, unambiguous digits
   - 0.85–0.94  clear, minor ambiguity about the label or unit
   - 0.70–0.84  legible but the label or which number belongs to it is uncertain
   - below 0.70 blurred, cropped, overlapping, or genuinely a guess
   Never inflate confidence. A low score routes the value to human review, which is the correct outcome for an unclear number.
6. Several screenshots together describe ONE snapshot of the same dashboard. Extract every KPI you see across all of them into a single metrics array.
7. If the same KPI appears on more than one screenshot, report it once per screenshot with its own source_image. Do not silently pick a winner — the application reconciles disagreements.
8. Set source_image to the label of the screenshot the reading came from. Use only the labels provided.
9. Report the reporting period only if it is visibly stated (a date range, "Week of ...", a month name). Otherwise set the dates to null. Never assume the period is the current week.
10. Dates must be ISO format, YYYY-MM-DD.
11. If a screenshot is unreadable or contains no KPI data, add it to unreadable_images with a short reason and extract nothing from it.
12. Ignore navigation chrome, tab bars, buttons, and marketing copy. Extract only performance metrics.
13. Do not invent KPIs. If a metric is not on screen, it does not go in the output.`;

const EXPLICIT_ADDENDUM = `
RETRY GUIDANCE — a previous attempt on these images failed validation.

Work through each screenshot one at a time, top to bottom, left to right.
For every numeric value you can see, ask: what label sits closest to it? That
label is the KPI. Include it even when you are unsure of the label — set a low
confidence and explain the doubt in notes rather than dropping the reading.
Prefer returning a low-confidence value over returning nothing. Return an empty
metrics array only if the images genuinely contain no performance numbers.`;

export function buildExtractionSystemPrompt(args: ExtractionPromptArgs): string {
  const kpiLines =
    args.knownKpis.length > 0
      ? args.knownKpis
          .map((k) => {
            const aliases = k.aliases.length > 0 ? ` (also seen as: ${k.aliases.join(", ")})` : "";
            return `- ${k.key} — "${k.displayName}"${aliases}`;
          })
          .join("\n")
      : "- (none configured yet)";

  return `${BASE_INSTRUCTIONS}${args.strategy === "EXPLICIT" ? EXPLICIT_ADDENDUM : ""}

KNOWN KPIs
When a label matches one of these, set key to the matching identifier exactly.
When a label matches none of them, set key to null and still report the metric —
the user will be asked whether to create a new KPI for it.

${kpiLines}

OUTPUT
Return only data that conforms to the provided schema. No commentary, no markdown.`;
}

export function buildExtractionUserPrompt(args: ExtractionPromptArgs): string {
  return `Today is ${args.today} (${args.timezone}).

The following ${args.imageLabels.length} screenshot${args.imageLabels.length === 1 ? "" : "s"} are one capture of the same dashboard, in order: ${args.imageLabels.join(", ")}.

Extract every KPI visible across all of them.`;
}
