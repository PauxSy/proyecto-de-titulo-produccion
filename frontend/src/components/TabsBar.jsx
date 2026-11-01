import { useEffect, useRef } from 'react'

function mostrarTab(tab, barra) {
  if (!tab || !barra) return
  const izquierda = tab.offsetLeft
  const derecha = izquierda + tab.offsetWidth
  if (izquierda < barra.scrollLeft) barra.scrollLeft = izquierda
  else if (derecha > barra.scrollLeft + barra.clientWidth) {
    barra.scrollLeft = derecha - barra.clientWidth
  }
}

function TabsBar({ tabs, tabActiva, onCambiarTab }) {
  const barraRef = useRef(null)
  const activaRef = useRef(null)

  useEffect(() => {
    mostrarTab(activaRef.current, barraRef.current)
  }, [tabActiva])

  return (
    <div className="tabs-bar" ref={barraRef}>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          ref={tabActiva === tab.id ? activaRef : null}
          className={`tab-item ${tabActiva === tab.id ? 'active' : ''}`}
          onClick={(e) => {
            onCambiarTab(tab.id)
            mostrarTab(e.currentTarget, barraRef.current)
          }}
          style={{ cursor: 'pointer' }}
        >
          {tab.label}
        </div>
      ))}
    </div>
  )
}

export default TabsBar
