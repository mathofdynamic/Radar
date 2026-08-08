export interface NormalizationResult {
  normalizedText: string;
  isNoise: boolean;
  noiseReason: string | null;
}

const noisePatterns = [
  /عضویت|لینک عضویت|تبلیغ|اسپانسر|برای تبلیغات|تبلیغات/iu,
  /کانال ما را دنبال کنید|ما را دنبال کنید|join our channel/iu,
  /کد تخفیف|خرید کنید|فروش ویژه/iu
];

export function normalizePersianText(input: string): NormalizationResult {
  const normalizedText = input
    .replace(/[يى]/gu, "ی")
    .replace(/ك/gu, "ک")
    .replace(/ۀ/gu, "ه")
    .replace(/[\u200c\u200d]/gu, "‌")
    .replace(/[\t\r\n ]+/gu, " ")
    .replace(/\s+([،؛؟!:.])/gu, "$1")
    .trim();

  if (!normalizedText) return { normalizedText: "", isNoise: true, noiseReason: "empty" };
  if (normalizedText.length < 18) return { normalizedText, isNoise: true, noiseReason: "too_short" };
  const matched = noisePatterns.find((pattern) => pattern.test(normalizedText));
  if (matched) return { normalizedText, isNoise: true, noiseReason: "promotion_or_advertisement" };
  return { normalizedText, isNoise: false, noiseReason: null };
}

export function lexicalTokens(input: string): Set<string> {
  return new Set(
    normalizePersianText(input).normalizedText
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}]+/gu)
      .filter((token) => token.length >= 2)
  );
}

export function lexicalOverlap(left: string, right: string): number {
  const leftTokens = lexicalTokens(left);
  const rightTokens = lexicalTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let shared = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) shared += 1;
  return shared / Math.max(leftTokens.size, rightTokens.size);
}
