import { lexicalOverlap, lexicalTokens } from "../normalization";

/** Deterministic copy/dependency support; semantic grouping belongs to Nebula. */
export function lexicalTemporalSimilarity(left: string, right: string, temporalProximity: number): number {
  const overlap = lexicalOverlap(left, right);
  const leftTokens = lexicalTokens(left);
  const rightTokens = lexicalTokens(right);
  const exact = leftTokens.size > 0 && leftTokens.size === rightTokens.size && overlap === 1 ? 1 : 0;
  return Math.min(1, exact * 0.2 + overlap * 0.7 + temporalProximity * 0.1);
}

export function extractEntityKeys(text: string): string[] {
  return entityPatterns.filter(([, pattern]) => pattern.test(text)).map(([key]) => key);
}

export function entityOverlap(left: string, right: string): number {
  const leftEntities = new Set(extractEntityKeys(left));
  const rightEntities = new Set(extractEntityKeys(right));
  if (leftEntities.size === 0 || rightEntities.size === 0) return 0;
  let shared = 0;
  for (const entity of leftEntities) if (rightEntities.has(entity)) shared += 1;
  return shared / Math.max(leftEntities.size, rightEntities.size);
}

export function temporalProximity(leftIso: string | null, rightIso: string | null, horizonHours = 48): number {
  if (!leftIso || !rightIso) return 0;
  const difference = Math.abs(new Date(leftIso).getTime() - new Date(rightIso).getTime());
  return Math.max(0, 1 - difference / (horizonHours * 60 * 60 * 1_000));
}

const entityPatterns: Array<[string, RegExp]> = [
  ["iran", /ایران|iran/iu],
  ["tehran", /تهران|tehran/iu],
  ["israel", /اسرائیل|اسرائیی|israel/iu],
  ["united_states", /آمریکا|ایالات متحده|united states|usa/iu],
  ["russia", /روسیه|russia/iu],
  ["ukraine", /اوکراین|ukraine/iu],
  ["gaza", /غزه|gaza/iu],
  ["dollar", /دلار|دالر|dollar/iu],
  ["internet", /اینترنت|internet/iu],
  ["openai", /openai/iu]
];

export function inferCategory(text: string, fallback = "IRAN"): string {
  if (/دلار|ارز|بورس|اقتصاد|تورم|بازار|dollar|market|economy/iu.test(text)) return "ECONOMY";
  if (/جنگ|موشک|حمله|ارتش|امنیت|غزه|جبهه|war|missile|attack|security/iu.test(text)) return "WAR_SECURITY";
  if (/هوش مصنوعی|فناوری|تکنولوژی|openai|ai|technology/iu.test(text)) return "TECHNOLOGY";
  if (/دولت|مجلس|رئیس جمهور|انتخابات|government|president|election/iu.test(text)) return "POLITICS";
  if (/اینترنت|فیلتر|قطعی|زیرساخت|internet|outage/iu.test(text)) return "SOCIETY";
  return fallback;
}
