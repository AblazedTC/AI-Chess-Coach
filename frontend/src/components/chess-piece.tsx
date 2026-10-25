import { defaultPieces } from "react-chessboard";

export function ChessPiece({ piece, square }: { piece: string; square?: string }) {
  const type = `${piece === piece.toUpperCase() ? "w" : "b"}${piece.toUpperCase()}`;
  const Piece = defaultPieces[type];
  if (!Piece) throw new Error(`Unsupported chess piece: ${piece}`);
  return (
    <span className="piece" data-piece={type} aria-hidden="true">
      <Piece square={square} />
    </span>
  );
}
