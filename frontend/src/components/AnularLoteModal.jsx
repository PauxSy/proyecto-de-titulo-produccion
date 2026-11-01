import { useState } from 'react'
import { fetchConAuth } from '../sesion'
import { avisarInventarioActualizado } from '../inventario'

const MINIMO_MOTIVO = 10

function AnularLoteModal({ lote, onClose, onAnulado }) {
  const [motivo, setMotivo] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [pedirSeguro, setPedirSeguro] = useState(false)
  const motivoListo = motivo.trim().length >= MINIMO_MOTIVO
  const puedeEnviar = motivoListo && password.length > 0 && !enviando

  const consultarSeguro = (e) => {
    e.preventDefault()
    if (!puedeEnviar) return
    setError('')
    setPedirSeguro(true)
  }

  const enviar = async () => {
    if (!puedeEnviar) return
    setEnviando(true)
    setError('')
    try {
      const res = await fetchConAuth(`/lotes/${lote.id}/anular`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motivo: motivo.trim(), password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        setError(data.error || 'No se pudo anular el lote.')
        return
      }
      avisarInventarioActualizado()
      onAnulado(data)
    } catch {
      setError('Error de conexión con el servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="gu-overlay" onMouseDown={onClose}>
      <div className="gu-modal" role="dialog" aria-modal="true" aria-labelledby="anular-titulo" onMouseDown={(e) => e.stopPropagation()}>
        <div className="gu-modal-cabecera">
          <div>
            <h3 id="anular-titulo">Anular ingreso</h3>
            <p>Lote {lote.numero_lote}. Esta acción revierte el stock solo si el lote no tiene salidas.</p>
          </div>
          <button type="button" className="gu-modal-cerrar" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        <form onSubmit={consultarSeguro}>
          <div className="gu-campo">
            <label htmlFor="motivo-anulacion">Motivo</label>
            <textarea
              id="motivo-anulacion"
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              disabled={pedirSeguro || enviando}
              placeholder="Explica por qué se anula este ingreso (mínimo 10 caracteres)"
            />
            <span className="hint">{motivo.trim().length}/10 caracteres mínimos</span>
          </div>
          <div className="gu-campo">
            <label htmlFor="password-anulacion">Contraseña</label>
            <input
              id="password-anulacion"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={pedirSeguro || enviando}
              autoComplete="current-password"
            />
          </div>
          {pedirSeguro && (
            <p className="anular-confirma" role="alert">
              ¿Está seguro de anular el lote {lote.numero_lote}
              {lote.producto ? ` de ${lote.producto}` : ''}? Se revierte el stock y el lote queda anulado.
            </p>
          )}
          {error && <p className="error-msg">{error}</p>}
          <div className="gu-modal-pie">
            {pedirSeguro ? (
              <>
                <button type="button" className="gu-btn-cancelar" onClick={() => setPedirSeguro(false)} disabled={enviando}>
                  No, volver
                </button>
                <button type="button" className="gl-btn-anular" onClick={enviar} disabled={!puedeEnviar}>
                  {enviando ? 'Anulando...' : 'Sí, anular el lote'}
                </button>
              </>
            ) : (
              <>
                <button type="button" className="gu-btn-cancelar" onClick={onClose} disabled={enviando}>Cancelar</button>
                <button type="submit" className="gl-btn-anular" disabled={!puedeEnviar}>
                  Revisar anulación
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}

export default AnularLoteModal
