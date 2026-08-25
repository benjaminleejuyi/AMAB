// Dependency-free QR Code version 5-L encoder. This capacity comfortably fits
// AMA Board URLs while keeping the generated code large enough for projection.
const SIZE = 37
const DATA_CODEWORDS = 108
const ECC_CODEWORDS = 26

const gfMultiply = (left: number, right: number) => {
  let result = 0
  for (let index = 0; index < 8; index++) { if (right & 1) result ^= left; const high = left & 0x80; left = (left << 1) & 0xff; if (high) left ^= 0x1d; right >>= 1 }
  return result
}

const generator = () => {
  let polynomial = [1]
  let root = 1
  for (let degree = 0; degree < ECC_CODEWORDS; degree++) {
    const next = new Array(polynomial.length + 1).fill(0)
    polynomial.forEach((coefficient, index) => { next[index] ^= coefficient; next[index + 1] ^= gfMultiply(coefficient, root) })
    polynomial = next; root = gfMultiply(root, 2)
  }
  return polynomial
}

const errorCorrection = (data: number[]) => {
  const result = [...data, ...new Array(ECC_CODEWORDS).fill(0)]
  const divisor = generator()
  for (let index = 0; index < data.length; index++) {
    const factor = result[index]
    if (factor) divisor.forEach((coefficient, offset) => { result[index + offset] ^= gfMultiply(coefficient, factor) })
  }
  return result.slice(data.length)
}

const codewords = (value: string) => {
  const bytes = [...new TextEncoder().encode(value)]
  if (bytes.length > 106) throw new Error('Board URL is too long to encode as a QR code.')
  const bits: number[] = [0, 1, 0, 0]
  for (let bit = 7; bit >= 0; bit--) bits.push((bytes.length >>> bit) & 1)
  bytes.forEach(byte => { for (let bit = 7; bit >= 0; bit--) bits.push((byte >>> bit) & 1) })
  bits.push(...new Array(Math.min(4, DATA_CODEWORDS * 8 - bits.length)).fill(0))
  while (bits.length % 8) bits.push(0)
  const data: number[] = []
  for (let index = 0; index < bits.length; index += 8) data.push(bits.slice(index, index + 8).reduce((sum, bit) => (sum << 1) | bit, 0))
  for (let pad = 0; data.length < DATA_CODEWORDS; pad++) data.push(pad % 2 ? 0x11 : 0xec)
  return [...data, ...errorCorrection(data)]
}

export const qrMatrix = (value: string) => {
  const modules: Array<Array<boolean | null>> = Array.from({ length: SIZE }, () => new Array(SIZE).fill(null))
  const set = (row: number, column: number, dark: boolean) => { if (row >= 0 && column >= 0 && row < SIZE && column < SIZE) modules[row][column] = dark }
  const finder = (row: number, column: number) => { for (let y = -1; y <= 7; y++) for (let x = -1; x <= 7; x++) set(row + y, column + x, y >= 0 && y <= 6 && x >= 0 && x <= 6 && (y === 0 || y === 6 || x === 0 || x === 6 || (y >= 2 && y <= 4 && x >= 2 && x <= 4))) }
  finder(0, 0); finder(SIZE - 7, 0); finder(0, SIZE - 7)
  for (let index = 8; index < SIZE - 8; index++) { if (modules[index][6] === null) set(index, 6, index % 2 === 0); if (modules[6][index] === null) set(6, index, index % 2 === 0) }
  for (const row of [6, 30]) for (const column of [6, 30]) if (modules[row][column] === null) for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) set(row + y, column + x, Math.max(Math.abs(x), Math.abs(y)) !== 1)
  const format = 0x77c4
  for (let index = 0; index < 15; index++) {
    const dark = ((format >>> index) & 1) === 1
    set(index < 6 ? index : index < 8 ? index + 1 : SIZE - 15 + index, 8, dark)
    set(8, index < 8 ? SIZE - index - 1 : index < 9 ? 15 - index : 15 - index - 1, dark)
  }
  set(SIZE - 8, 8, true)
  const bits = codewords(value).flatMap(byte => Array.from({ length: 8 }, (_, index) => (byte >>> (7 - index)) & 1))
  let bitIndex = 0; let upwards = true
  for (let right = SIZE - 1; right > 0; right -= 2) {
    if (right === 6) right--
    for (let vertical = 0; vertical < SIZE; vertical++) {
      const row = upwards ? SIZE - 1 - vertical : vertical
      for (let offset = 0; offset < 2; offset++) {
        const column = right - offset
        if (modules[row][column] === null) { const bit = bits[bitIndex++] || 0; modules[row][column] = Boolean(bit ^ (((row + column) % 2 === 0) ? 1 : 0)) }
      }
    }
    upwards = !upwards
  }
  return modules as boolean[][]
}

export const qrSvg = (value: string) => {
  const matrix = qrMatrix(value); const quiet = 4
  const cells = matrix.flatMap((row, y) => row.map((dark, x) => dark ? `<rect x="${x + quiet}" y="${y + quiet}" width="1" height="1"/>` : '')).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE + quiet * 2} ${SIZE + quiet * 2}" shape-rendering="crispEdges" role="img" aria-label="QR code for ${value.replace(/[&<>"']/g, '')}"><rect width="100%" height="100%" fill="white"/><g fill="#173f2b">${cells}</g></svg>`
}
