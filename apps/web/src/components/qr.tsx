/**
 * Pairing QR code.
 *
 * The encoding itself is **not** written here: it comes from `qrcode` (MIT), the
 * same way the cryptography comes from WebCrypto. Writing an encoder by hand would
 * be the exact mistake this project refuses to make elsewhere.
 *
 * What is ours: the rendering, so no third-party string ever reaches the DOM as
 * markup. The matrix is turned into `<rect>` elements — nothing is injected as HTML.
 */
import { create } from 'qrcode';

export interface QrMatrix {
  size: number;
  /** Row-major, `true` for a dark module. No quiet zone: the viewBox adds it. */
  dark: boolean[][];
}

/** Builds the module matrix, or returns `undefined` when the text cannot be encoded. */
export function qrMatrix(text: string, errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H' = 'M'): QrMatrix | undefined {
  if (text.length === 0) return undefined;
  try {
    const code = create(text, { errorCorrectionLevel });
    const size = code.modules.size;
    const dark: boolean[][] = [];
    for (let row = 0; row < size; row += 1) {
      const line: boolean[] = [];
      // `modules.get` is typed `boolean` but really returns 1/0: normalise it here so
      // the rest of the code never has to think about it.
      for (let column = 0; column < size; column += 1) line.push(Boolean(code.modules.get(row, column)));
      dark.push(line);
    }
    return { size, dark };
  } catch {
    // Too long for a QR code: the caller still shows the code and the link.
    return undefined;
  }
}

export function QrCode({
  value,
  label,
  size = 168,
}: {
  value: string;
  /** Read out to assistive technology; the link is always shown next to it. */
  label: string;
  size?: number;
}): React.ReactElement | null {
  const matrix = qrMatrix(value);
  if (!matrix) return null;
  const quiet = 2;
  const side = matrix.size + quiet * 2;
  return (
    <svg
      className="df-qr"
      width={size}
      height={size}
      viewBox={`0 0 ${side} ${side}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={side} height={side} fill="#ffffff" />
      {matrix.dark.map((line, row) =>
        line.map((on, column) =>
          on ? <rect key={`${row}-${column}`} x={column + quiet} y={row + quiet} width={1} height={1} fill="#0b0b0f" /> : null,
        ),
      )}
    </svg>
  );
}
