import type { Question } from './types'

export interface ReportOptions { officialReplies: boolean; comments: boolean; votes: boolean; authors: boolean }

const ascii = (value: string) => value.normalize('NFKD').replace(/[^\x20-\x7E]/g, '').replace(/[()\\]/g, '\\$&')
const wrap = (text: string, width = 88) => {
  const words = ascii(text).split(/\s+/); const lines: string[] = []; let line = ''
  for (const word of words) { if (`${line} ${word}`.trim().length > width) { lines.push(line); line = word } else line = `${line} ${word}`.trim() }
  if (line) lines.push(line)
  return lines
}

export function createBoardReport(title: string, questions: Question[], options: ReportOptions): Blob {
  const pages: string[][] = [[]]; let page = pages[0]; let used = 0
  const add = (line = '', cost = 1) => { if (used + cost > 42) { page = []; pages.push(page); used = 0 } page.push(line); used += cost }
  add('AMA BOARD — OFFICIAL REPORT', 2); add(title, 2); add(`Generated ${new Date().toLocaleString()} | ${questions.length} questions`, 2); add('')
  questions.forEach((question, index) => {
    add(`${index + 1}. ${question.category.toUpperCase()} | ${question.status.toUpperCase()}`, 2)
    wrap(question.body).forEach(line => add(line))
    if (options.authors) add(`Submitted by: ${question.author}`)
    if (options.votes) add(`Votes: ${question.upvotes} up | ${question.downvotes} down | ${question.upvotes - question.downvotes} net`)
    if (options.officialReplies && question.officialReply) {
      add('OFFICIAL REPLY', 2); wrap(question.officialReply.body).forEach(line => add(`  ${line}`))
      if (options.authors) add(`  ${question.officialReply.author} | ${question.officialReply.time}`)
    }
    if (options.comments && question.comments.length) {
      add(`COMMENTS (${question.comments.length})`, 2)
      question.comments.forEach(comment => { wrap(comment.body, 82).forEach((line, lineIndex) => add(`  ${lineIndex ? '' : `${options.authors ? `${comment.author}: ` : ''}`}${line}`)) })
    }
    add('________________________________________________________________________________'); add('')
  })

  const objects: string[] = []; const addObject = (value: string) => { objects.push(value); return objects.length }
  const font = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const pageRefs: number[] = []; const streamRefs: number[] = []
  pages.forEach(lines => {
    const commands = ['BT', '/F1 10 Tf', '50 790 Td']
    lines.forEach((line, index) => { const heading = index < 3 || line === 'OFFICIAL REPLY' || line.startsWith('COMMENTS') || /^\d+\./.test(line); commands.push(`${heading ? '/F1 12 Tf' : '/F1 10 Tf'} 0 ${index ? -17 : 0} Td (${ascii(line)}) Tj`) })
    commands.push('ET'); const stream = commands.join('\n'); streamRefs.push(addObject(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)); pageRefs.push(0)
  })
  const pagesRef = objects.length + pages.length + 1
  pages.forEach((_, index) => { pageRefs[index] = addObject(`<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${streamRefs[index]} 0 R >>`) })
  addObject(`<< /Type /Pages /Kids [${pageRefs.map(ref => `${ref} 0 R`).join(' ')}] /Count ${pageRefs.length} >>`)
  const catalog = addObject(`<< /Type /Catalog /Pages ${pagesRef} 0 R >>`)
  let pdf = '%PDF-1.4\n'; const offsets = [0]
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xref = pdf.length; pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`
  return new Blob([pdf], { type: 'application/pdf' })
}

export function downloadBoardReport(title: string, questions: Question[], options: ReportOptions) {
  const url = URL.createObjectURL(createBoardReport(title, questions, options)); const link = document.createElement('a')
  link.href = url; link.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ama-board'}-report.pdf`; link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
