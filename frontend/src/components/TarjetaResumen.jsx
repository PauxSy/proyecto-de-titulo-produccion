function TarjetaResumen({ titulo, contador, clase, subtitulo, icono, seleccionada, onClick, cargando, error }) {
  return (
    <button
      type="button"
      className={`stock-summary-card ${clase}${seleccionada ? ' stock-summary-seleccionada' : ''}${cargando ? ' stock-summary-cargando' : ''}`}
      aria-pressed={seleccionada}
      aria-busy={cargando}
      disabled={cargando || Boolean(error)}
      onClick={onClick}
    >
      <div>
        <div className="stock-summary-label">{titulo}</div>
        <div className="stock-summary-numero">{error ? '—' : cargando ? '…' : contador}</div>
        <div className="stock-summary-sub">{error ? 'No se pudo cargar' : subtitulo}</div>
      </div>
      <span className="stock-summary-dot">{icono}</span>
    </button>
  )
}

export default TarjetaResumen
