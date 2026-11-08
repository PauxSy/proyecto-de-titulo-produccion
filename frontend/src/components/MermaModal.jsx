import { useEffect, useState } from 'react'
import { fetchConAuth } from '../sesion'
import { avisarInventarioActualizado } from '../inventario'

// Mismos motivos que acepta el backend en POST /mermas
const MOTIVOS_MERMA = ['Vencimiento', 'Rotura/Daño', 'Deterioro', 'Error Operacional', 'Otro']

const formatear = (valor) => Number(valor).toFixed(2)

const IconoPapelera = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
)

function MermaModal({ lote, onClose, onRegistrada }) {
  const disponible = Number(lote.cantidad_disponible)

  // Un lote caducado casi siempre se da de baja por vencimiento; se puede cambiar
  const [motivo, setMotivo] = useState(lote.vencido ? 'Vencimiento' : '')
  const [cantidad, setCantidad] = useState('')
  const [errores, setErrores] = useState({})
  const [errorEnvio, setErrorEnvio] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    const alPresionar = (e) => {
      if (e.key === 'Escape' && !enviando) onClose()
    }
    document.addEventListener('keydown', alPresionar)
    return () => document.removeEventListener('keydown', alPresionar)
  }, [enviando, onClose])

  const validar = () => {
    const er = {}
    if (!MOTIVOS_MERMA.includes(motivo)) er.motivo = 'Selecciona la causa de la merma.'

    const n = Number(cantidad)
    if (cantidad === '' || !Number.isFinite(n) || n <= 0) {
      er.cantidad = 'Ingresa una cantidad mayor a 0.'
    } else if (Math.abs(Math.round(n * 100) - n * 100) > 1e-6) {
      er.cantidad = 'Usa como máximo 2 decimales.'
    } else if (n > disponible) {
      er.cantidad = `No puede superar el disponible del lote (${formatear(disponible)}).`
    }
    return er
  }

  const cerrar = () => {
    if (!enviando) onClose()
  }

  const enviar = async (e) => {
    e.preventDefault()
    setErrorEnvio('')

    const er = validar()
    setErrores(er)
    if (Object.keys(er).length > 0) return

    setEnviando(true)
    try {
      // El usuario responsable NO va en el cuerpo: el backend lo toma del JWT,
      // que fetchConAuth envía en el header Authorization.
      const res = await fetchConAuth('/mermas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lote_id: lote.id,
          cantidad: Number(cantidad),
          motivo,
        }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok || !data.success) {
        setErrorEnvio(data.error || 'No se pudo registrar la merma. Intenta nuevamente.')
        return
      }
      avisarInventarioActualizado()
      onRegistrada(data.data)
    } catch {
      setErrorEnvio('Error de conexión con el servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="gm-overlay" onMouseDown={cerrar}>
      <div
        className="gm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gm-titulo"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="gm-cabecera">
          <span className="gm-icono"><IconoPapelera /></span>
          <div className="gm-titulos">
            <h3 id="gm-titulo">Registrar merma</h3>
            <p>Descuenta stock físico y audita la pérdida</p>
          </div>
          <button type="button" className="gm-cerrar" onClick={cerrar} aria-label="Cerrar">
            ×
          </button>
        </div>

        <form className="gm-cuerpo" onSubmit={enviar} noValidate>
          <div className="gm-campo">
            <label htmlFor="gm-insumo">Insumo</label>
            <input id="gm-insumo" type="text" value={`${lote.producto} (${lote.sku})`} disabled />
          </div>

          <div className="gm-campo">
            <label htmlFor="gm-lote">Lote físico específico</label>
            <input
              id="gm-lote"
              type="text"
              className="gm-mono"
              value={`${lote.numero_lote} (Disp: ${formatear(disponible)} | Vence: ${lote.fecha_vencimiento})`}
              disabled
            />
          </div>

          <div className="gm-fila">
            <div className="gm-campo">
              <label htmlFor="gm-cantidad">Cantidad *</label>
              <input
                id="gm-cantidad"
                type="number"
                step="0.01"
                min="0"
                value={cantidad}
                onChange={(e) => {
                  setCantidad(e.target.value)
                  setErrores((er) => ({ ...er, cantidad: undefined }))
                }}
                placeholder="Ej. 1.5"
                className={errores.cantidad ? 'gm-invalido' : ''}
              />
              {errores.cantidad ? (
                <span className="gm-error-campo">{errores.cantidad}</span>
              ) : (
                <span className="gm-hint">
                  Máx. {formatear(disponible)} ·{' '}
                  <button
                    type="button"
                    className="gm-link"
                    onClick={() => {
                      setCantidad(String(disponible))
                      setErrores((er) => ({ ...er, cantidad: undefined }))
                    }}
                  >
                    usar todo el lote
                  </button>
                </span>
              )}
            </div>

            <div className="gm-campo">
              <label htmlFor="gm-motivo">Causa de merma *</label>
              <select
                id="gm-motivo"
                value={motivo}
                onChange={(e) => {
                  setMotivo(e.target.value)
                  setErrores((er) => ({ ...er, motivo: undefined }))
                }}
                className={errores.motivo ? 'gm-invalido' : ''}
              >
                <option value="">Selecciona una causa</option>
                {MOTIVOS_MERMA.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              {errores.motivo && <span className="gm-error-campo">{errores.motivo}</span>}
            </div>
          </div>

          {errorEnvio && <p className="error-msg">⚠️ {errorEnvio}</p>}

          <div className="gm-pie">
            <button type="button" className="gm-btn-cancelar" onClick={cerrar} disabled={enviando}>
              Cancelar
            </button>
            <button type="submit" className="gm-btn-confirmar" disabled={enviando}>
              {enviando ? 'Registrando...' : 'Confirmar Baja de Inventario'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default MermaModal