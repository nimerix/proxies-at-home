import axios from "axios";
import { useState } from "react";

type CardOption = {
  name: string;
  imageUrls: string[];
};

export default function DeckInput() {
  const [deckText, setDeckText] = useState("");
  const [cards, setCards] = useState<CardOption[]>([]);
  const [selectedImages, setSelectedImages] = useState<Record<string, string>>({});
  const [expandedCard, setExpandedCard] = useState<string | null>(null);

  const handleSubmit = async () => {
    const names: string[] = [];

    deckText.split("\n").forEach((line) => {
      const trimmed = line.trim();
      const match = trimmed.match(/^(\d+)x?\s+(.*)/i);
      if (match) {
        const count = parseInt(match[1], 10);
        const cardName = match[2];
        for (let i = 0; i < count; i++) {
          names.push(cardName);
        }
      } else if (trimmed.length > 0) {
        names.push(trimmed);
      }
    });

    const response = await axios.post<CardOption[]>(
      "http://localhost:3001/api/cards/images",
      { cardNames: Array.from(new Set(names)) }
    );
    console.log("Fetched cards:", response.data);

    setCards(response.data);

    const initialSelection: Record<string, string> = {};
    for (const card of response.data) {
      if (card.imageUrls.length > 0) {
        initialSelection[card.name] = card.imageUrls[0];
      }
    }
    setSelectedImages(initialSelection);
    setExpandedCard(null);
  };

  const handleImageClick = (cardName: string) => {
    setExpandedCard((prev) => (prev === cardName ? null : cardName));
  };

  const handleSelectImage = (cardName: string, url: string) => {
    setSelectedImages((prev) => ({ ...prev, [cardName]: url }));
    setExpandedCard(null);
  };

  return (
    <div className="space-y-4 p-4">
      {/* Decklist Input */}
      <textarea
        className="w-full h-40 border rounded p-2"
        placeholder="Paste decklist here (e.g. 1x Sol Ring)"
        value={deckText}
        onChange={(e) => setDeckText(e.target.value)}
      />
      <button
        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        onClick={handleSubmit}
      >
        Fetch Images
      </button>

      {/* Grid of Selected Images */}
      {cards.length > 0 && (
        <div className="mt-6">
          <h2 className="text-xl font-bold mb-4">Selected Cards</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {cards.map((card) => (
              <div key={card.name} className="bg-white rounded shadow p-2">
                <h3 className="text-md font-semibold mb-2 text-center">
                  {card.name}
                </h3>
                <img
                  src={selectedImages[card.name]}
                  alt={card.name}
                  className="w-full rounded border-4 border-blue-500 cursor-pointer"
                  onClick={() => handleImageClick(card.name)}
                />

                {/* Expanded alt-art selection */}
                {expandedCard === card.name && (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    {card.imageUrls.map((url, i) => (
                      <img
                        key={i}
                        src={url}
                        alt={`${card.name} alt art ${i}`}
                        className={`w-full border-4 ${
                          selectedImages[card.name] === url
                            ? "border-green-500"
                            : "border-transparent"
                        } cursor-pointer`}
                        onClick={() => handleSelectImage(card.name, url)}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
