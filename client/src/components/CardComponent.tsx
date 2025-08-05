interface CardComponentProps {
  imageUrl?: string;
  bleedIn: number;
  guideWidth: number;
  onClick?: () => void;
}

export const CardComponent = ({
  imageUrl,
  bleedIn,
  guideWidth,
  onClick,
}: CardComponentProps) => {
  const dpi = 96;
  const bleedPx = bleedIn * dpi;
  const cardWidth = 2.5 * dpi;
  const cardHeight = 3.5 * dpi;

  return (
    <div
      onClick={onClick}
      className="relative overflow-hidden"
      style={{
        width: `${cardWidth}px`,
        height: `${cardHeight}px`,
      }}
    >
      {imageUrl && (
        <img
          src={imageUrl}
          alt="card"
          className="absolute"
          style={{
            top: -bleedPx,
            left: -bleedPx,
            width: `${cardWidth + bleedPx * 2}px`,
            height: `${cardHeight + bleedPx * 2}px`,
            objectFit: "cover",
          }}
        />
      )}

      {/* Guide overlay */}
      {guideWidth > 0 && (
        <div
          className="absolute pointer-events-none"
          style={{
            top: 0,
            left: 0,
            width: `${cardWidth}px`,
            height: `${cardHeight}px`,
            border: `${guideWidth}px solid lime`, // replace with guideColor prop if needed
            boxSizing: "border-box",
          }}
        />
      )}
    </div>
  );
};
