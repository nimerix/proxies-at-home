import React from "react";

interface CardLayoutProps {
  images: string[];
}

export const CardLayout: React.FC<CardLayoutProps> = ({ images }) => {
  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: "repeat(3, 1fr)",
        width: "8.5in",
        height: "11in",
        margin: "0 auto",
        gap: 0,
        padding: 0,
        backgroundColor: "white",
      }}
    >
      {images.map((url, index) => (
        <img
          key={index}
          src={url}
          alt={`Card ${index + 1}`}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          draggable={false}
        />
      ))}
    </div>
  );
};
