export default function ExtractCardName(input: string): string {
    let s = input.trim();

    // 1) Strip leading quantity like "2x " or "3 "
    s = s.replace(/^\s*\d+\s*x?\s+/i, "");

    // 2) Repeatedly strip trailing noise until stable (order‑agnostic)
    const caretTail = /\s*\^[^^]*\^\s*$/;                // ^...^ at end
    const bracketTail = /\s*\[[^\]]*]\s*$/;              // [...] at end
    const setNumTail = /\s*\([a-z0-9]{2,5}\)\s*\d*\s*$/i; // (set) [num] at end

    let changed = true;
    while (changed) {
        const before = s;
        s = s.replace(caretTail, "").trim();
        s = s.replace(bracketTail, "").trim();
        s = s.replace(setNumTail, "").trim();
        changed = s !== before;
    }

    return s;
}