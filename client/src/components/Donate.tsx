import { useState } from "react";
import { Button, Label, TextInput } from "flowbite-react";

function VenmoDonate({ username = "Kaiser-Clipston-1" }) {
  const PRESETS = [1, 5, 10];
  const [preset, setPreset] = useState<number>(5);
  const [custom, setCustom] = useState<string>("");

  const getAmount = () => {
    const v = Math.floor(Number(custom));
    return Number.isFinite(v) && v > 0 ? v : preset;
  };

  const handleDonate = () => {
    const amt = getAmount();
    const url = `https://venmo.com/${encodeURIComponent(
      username
    )}?txn=pay&amount=${amt}&note=${encodeURIComponent("Proxxied support")}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="mt-4 rounded-xl p-3 bg-white dark:bg-gray-800 w-full">
      <Label className="text-sm font-semibold dark:text-gray-300">Donate</Label>

      <div className="mt-2 flex items-center gap-2 w-full">
        {PRESETS.map((v) => (
          <Button
            key={v}
            size="sm"
            onClick={() => setPreset(v)}
            className={`min-w-12 ${
              preset === v && (!custom || Number(custom) <= 0)
                ? "bg-blue-600 hover:bg-blue-700"
                : "bg-gray-300 text-gray-900 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200"
            }`}
          >
            ${v}
          </Button>
        ))}

        <TextInput
          type="number"
          min="1"
          placeholder="Custom"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          className="w-24"
        />
      </div>

      <Button onClick={handleDonate} className="bg-blue-700 w-full mt-[1rem]">
        Donate ${custom && Number(custom) > 0 ? Math.floor(Number(custom)) : preset} via Venmo
      </Button>
    </div>
  );
}

export default VenmoDonate;
