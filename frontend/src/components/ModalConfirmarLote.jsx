import { useEffect } from 'react'

const textoStock = (valor) => {
  const n = Number(valor)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function ModalConfirmarLote({
  numeroLote,
  productoNombre,
  cantidad,
  unidad,
  fechaVencimiento,
  costoUnitario,
  notas,
  stockAnterior,
  resultado,
  error,
  guardando,
  onCancelar,
  onConfirmar,
  onCerrarExito,
}) {
  useEffect(() => {
    const alTeclar = (e) => {
      if (e.key !== 'Escape' || guardando) return
      if (resultado) onCerrarExito()
      else onCancelar()
    }
    document.addEventListener('keydown', alTeclar)
    return () => document.removeEventListener('keydown', alTeclar)
  }, [guardando, resultado, onCancelar, onCerrarExito])

  const cerrarSinGuardar = () => {
    if (guardando) return
    if (resultado) onCerrarExito()
    else onCancelar()
  }

  const gramaje = unidad ? `${cantidad} ${unidad}` : cantidad

  return (
    <div className="modal-overlay modal-confirmar-lote" onClick={cerrarSinGuardar}>
      <div
        className="modal-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-confirmar-lote"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2 id="titulo-confirmar-lote" style={{ margin: 0, fontSize: '16px' }}>Confirmar ingreso de lote</h2>
            <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: '#6b7280' }}>
              Revisa los datos antes de guardar.
            </p>
          </div>
          <button type="button" className="modal-close-btn" onClick={cerrarSinGuardar} disabled={guardando} aria-label="Cerrar">
            ✕
          </button>
        </div>

        <div className="resumen-box">
          <p style={{ marginTop: 0 }}>
            ¿Están correctos los datos? Se ingresará el lote <strong>{numeroLote}</strong> del
            producto <strong>{productoNombre}</strong>, con un gramaje de <strong>{gramaje}</strong>,
            fecha de vencimiento <strong>{fechaVencimiento}</strong> y un total de <strong>{cantidad}</strong> unidades.
          </p>
          <p style={{ marginBottom: 0 }}>
            Stock global actual de <strong>{productoNombre}</strong>: <strong>{textoStock(stockAnterior)}</strong>
          </p>
          {(costoUnitario || notas) && (
            <p style={{ marginBottom: 0 }}>
              {costoUnitario ? <>Costo unitario: <strong>${costoUnitario}</strong>. </> : null}
              {notas ? <>Notas: <strong>{notas}</strong></> : null}
            </p>
          )}
        </div>

        {!resultado && (
          <p className="hint" style={{ marginTop: '-8px' }}>
            Si cancelas, el lote no se guarda.
          </p>
        )}

        {error && <p className="error-msg">⚠️ {error}</p>}

        {resultado?.producto && (
          <div className="stock-confirmado" role="status">
            Lote registrado. El stock global de {resultado.producto.nombre} quedó en
            <span className="stock-confirmado-numero">
              {textoStock(stockAnterior)} → {textoStock(resultado.producto.stock_actual)}
            </span>
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px' }}>
          {!resultado ? (
            <>
              <button type="button" className="btn-primary" style={{ background: '#6b7280' }} onClick={onCancelar} disabled={guardando}>
                Cancelar
              </button>
              <button type="button" className="btn-primary" onClick={onConfirmar} disabled={guardando}>
                {guardando && <span className="btn-spinner" aria-hidden="true" />}
                {guardando ? 'Confirmando ingreso...' : 'Confirmar ingreso'}
              </button>
            </>
          ) : (
            <button type="button" className="btn-primary" onClick={onCerrarExito}>
              Volver
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default ModalConfirmarLote
