export type CardInfo = { name: string; set?: string; number?: string };
export const MAX_CARDS = 1000;
export function extractCardInfo(input: string): CardInfo {
  let name = input.trim().replace(/^\d+\s*x?\s+/i, "");
  name = name
    .replace(/\s+(?:\*F\*|\*E\*|\[[^\]]*\]|\^[^^]*\^)\s*$/gi, "")
    .trim();
  const printing = name.match(/\s+\(([a-z0-9]{2,8})\)(?:\s+([^\s]+))?$/i);
  if (!printing) return { name };
  name = name.slice(0, printing.index).trim();
  return { name, set: printing[1].toLowerCase(), number: printing[2] };
}
export function parseDeckToInfos(text: string): CardInfo[] {
  if (text.length > 200000)
    throw new Error(
      "This decklist is too large. Import up to 1,000 cards at a time."
    );
  const infos: CardInfo[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (
      !trimmed ||
      /^(?:#|\/\/|\[)/.test(trimmed) ||
      /^(?:deck|sideboard|commander|companions?|maybeboard|mainboard)\s*:?$/i.test(
        trimmed
      )
    )
      continue;
    const quantity = trimmed.match(/^(\d+)\s*x?\s+(.+)$/i);
    const count = quantity ? Number(quantity[1]) : 1;
    if (!Number.isSafeInteger(count) || count + infos.length > MAX_CARDS)
      throw new Error(
        "Import up to 1,000 cards at a time. Reduce the quantities and try again."
      );
    const info = extractCardInfo(quantity?.[2] ?? trimmed);
    if (!info.name || info.name.length > 200)
      throw new Error(`Check this decklist line: ${trimmed.slice(0, 80)}`);
    for (let i = 0; i < count; i++) infos.push({ ...info });
  }
  return infos;
}
export function cardKey(ci: CardInfo) {
  return `${ci.name.trim().toLowerCase()}|${ci.set?.toLowerCase() ?? ""}|${ci.number ?? ""}`;
}
