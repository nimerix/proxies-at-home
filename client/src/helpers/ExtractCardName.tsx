export default function ExtractCardName(input: string): string {
  let s = input.trim();

  // 1) Strip leading quantity like "2x " or "3 "
  s = s.replace(/^\s*\d+\s*x?\s+/i, "");

  // 2) Drop trailing bracketed metadata like "[Sorcery]" (only at the end)
  s = s.replace(/\s*\[[^\]]+\]\s*$/i, "").trim();

  // 3) Drop a trailing "(setcode)" and optional collector number at the end
  //    e.g., "(cmm) 321", "(cmm)", "(CMM)   012"
  s = s.replace(/\s*\([a-z0-9]{2,5}\)\s*\d*\s*$/i, "").trim();

  // If there are multiple trailing set/number chunks, strip repeatedly
  // (rare, but harmless)
  while (/\s*\([a-z0-9]{2,5}\)\s*\d*\s*$/i.test(s)) {
    s = s.replace(/\s*\([a-z0-9]{2,5}\)\s*\d*\s*$/i, "").trim();
  }

  return s;
}