import * as XLSX from 'xlsx'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

const valor = (fila, columna) => {
  const crudo = fila[columna.key]
  if (crudo === null || crudo === undefined || crudo === '') return columna.numero ? 0 : ''
  return columna.numero ? Number(crudo) : String(crudo)
}

export const exportarExcel = ({ nombre, columnas, filas }) => {
  const datos = filas.map((fila) => {
    const objeto = {}
    for (const columna of columnas) objeto[columna.titulo] = valor(fila, columna)
    return objeto
  })
  const hoja = XLSX.utils.json_to_sheet(datos, { header: columnas.map((columna) => columna.titulo) })
  const libro = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(libro, hoja, 'Datos')
  XLSX.writeFile(libro, `${nombre}.xlsx`)
}

export const exportarPdf = ({ nombre, titulo, columnas, filas }) => {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  doc.setFontSize(14)
  doc.text(titulo, 40, 36)
  autoTable(doc, {
    startY: 52,
    head: [columnas.map((columna) => columna.titulo)],
    body: filas.map((fila) => columnas.map((columna) => valor(fila, columna))),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [37, 99, 235] },
  })
  doc.save(`${nombre}.pdf`)
}
