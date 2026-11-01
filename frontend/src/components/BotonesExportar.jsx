import { exportarExcel, exportarPdf } from '../exportar'

function BotonesExportar({ nombre, titulo, columnas, filas }) {
  const vacio = !filas?.length
  const descargar = (formato) => {
    const archivo = { nombre, titulo, columnas, filas }
    if (formato === 'pdf') exportarPdf(archivo)
    else exportarExcel(archivo)
  }

  return (
    <div className="fila-acciones">
      <button type="button" className="btn-mini btn-mini-outline" disabled={vacio} onClick={() => descargar('pdf')}>
        Exportar PDF
      </button>
      <button type="button" className="btn-mini btn-mini-outline" disabled={vacio} onClick={() => descargar('excel')}>
        Exportar Excel
      </button>
    </div>
  )
}

export default BotonesExportar
