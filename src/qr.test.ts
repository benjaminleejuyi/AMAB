import { describe, expect, it } from 'vitest'
import { qrMatrix, qrSvg } from './qr'

describe('board QR code', () => {
  const url = 'https://ama.anyhowonly.com/boards/all-company'

  it('creates a complete version 5 QR matrix', () => {
    const matrix = qrMatrix(url)
    expect(matrix).toHaveLength(37)
    expect(matrix.every(row => row.length === 37 && row.every(cell => typeof cell === 'boolean'))).toBe(true)
    expect(matrix[0].slice(0, 7)).toEqual([true, true, true, true, true, true, true])
  })

  it('renders a portable SVG with the board URL as its accessible label', () => {
    const svg = qrSvg(url)
    expect(svg).toContain('<svg')
    expect(svg).toContain('shape-rendering="crispEdges"')
    expect(svg).toContain(`aria-label="QR code for ${url}"`)
  })

  it('rejects URLs beyond the supported QR capacity', () => {
    expect(() => qrMatrix(`https://example.com/${'x'.repeat(120)}`)).toThrow(/too long/i)
  })
})
