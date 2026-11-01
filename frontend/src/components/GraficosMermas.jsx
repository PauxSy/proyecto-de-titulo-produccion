import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'

const COLORES_MOTIVO = {
  Vencimiento: '#ef4444',
  'Rotura/Daño': '#f97316',
  Deterioro: '#eab308',
  'Error Operacional': '#8b5cf6',
  Otro: '#64748b',
}

const dinero = (v) =>
  Number(v || 0).toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })
const cantidad = (v) => Number(v || 0).toLocaleString('es-CL', { maximumFractionDigits: 2 })
const corto = (texto = '', max = 18) => {
  const str = String(texto || '')
  return str.length > max ? `${str.slice(0, max - 1)}…` : str
}

const etiquetaPeriodo = (iso, periodo) => {
  if (!iso) return ''
  const f = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(f.getTime())) return String(iso)
  if (periodo === 'mes') return f.toLocaleDateString('es-CL', { month: 'short', year: '2-digit' })
  const dia = f.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' })
  return periodo === 'semana' ? `Sem. ${dia}` : dia
}

const TOOLTIP = {
  contentStyle: {
    background: '#0f172a',
    border: 'none',
    borderRadius: 10,
    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.25)',
    padding: '10px 14px',
  },
  labelStyle: { color: '#94a3b8', fontSize: 12, marginBottom: 4 },
  itemStyle: { color: '#ffffff', fontSize: 13, fontWeight: 600 },
}

const EJE = { fill: '#64748b', fontSize: 12 }

function Tarjeta({ titulo, subtitulo, children }) {
  return (
    <div className="mg-card">
      <div className="mg-titulo">{titulo}</div>
      <div className="mg-subtitulo">{subtitulo}</div>
      <div className="mg-area">
        <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
      </div>
    </div>
  )
}

function GraficoPeriodo({ titulo, subtitulo, datos, periodo, campo, formato, color, colorFin, nombre }) {
  const id = `grad-${campo}`
  return (
    <Tarjeta titulo={titulo} subtitulo={subtitulo}>
      <BarChart data={datos} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} />
            <stop offset="100%" stopColor={colorFin} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="4 4" />
        <XAxis
          dataKey="periodo"
          tickFormatter={(v) => etiquetaPeriodo(v, periodo)}
          tickLine={false}
          axisLine={false}
          tick={EJE}
        />
        <YAxis tickFormatter={formato} tickLine={false} axisLine={false} width={80} tick={EJE} />
        <Tooltip
          {...TOOLTIP}
          cursor={{ fill: 'rgba(37, 99, 235, 0.06)' }}
          labelFormatter={(v) => etiquetaPeriodo(v, periodo)}
          formatter={(v) => [formato(v), nombre]}
        />
        <Bar dataKey={campo} fill={`url(#${id})`} radius={[8, 8, 0, 0]} maxBarSize={72} />
      </BarChart>
    </Tarjeta>
  )
}

function GraficoMotivo({ datos = [] }) {
  const filas = datos.map((f) => ({ motivo: f.motivo || 'Otro', costo: Number(f.costo_total || 0) }))
  return (
    <Tarjeta titulo="Pérdida económica por causa" subtitulo="Costo valorizado según el motivo de la merma">
      <BarChart data={filas} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="4 4" />
        <XAxis dataKey="motivo" tickLine={false} axisLine={false} tick={{ ...EJE, fontSize: 11 }} />
        <YAxis tickFormatter={dinero} tickLine={false} axisLine={false} width={80} tick={EJE} />
        <Tooltip
          {...TOOLTIP}
          cursor={{ fill: 'rgba(15, 23, 42, 0.04)' }}
          formatter={(v) => [dinero(v), 'Costo']}
        />
        <Bar dataKey="costo" radius={[8, 8, 0, 0]} maxBarSize={72}>
          {filas.map((f) => <Cell key={f.motivo} fill={COLORES_MOTIVO[f.motivo] || '#64748b'} />)}
        </Bar>
      </BarChart>
    </Tarjeta>
  )
}

function GraficoTopInsumos({ datos = [] }) {
  const filas = datos.slice(0, 5).map((f) => ({ producto: f.producto || 'Insumo', costo: Number(f.costo_total || 0) }))
  return (
    <Tarjeta titulo="Top insumos con mayor merma" subtitulo="Costo valorizado por insumo">
      <BarChart data={filas} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid horizontal={false} stroke="#e2e8f0" strokeDasharray="4 4" />
        <XAxis type="number" tickFormatter={dinero} tickLine={false} axisLine={false} tick={EJE} />
        <YAxis
          type="category"
          dataKey="producto"
          width={140}
          tickFormatter={(v) => corto(v)}
          tickLine={false}
          axisLine={false}
          tick={{ ...EJE, fontSize: 11 }}
        />
        <Tooltip
          {...TOOLTIP}
          cursor={{ fill: 'rgba(15, 23, 42, 0.04)' }}
          formatter={(v) => [dinero(v), 'Costo']}
        />
        <Bar dataKey="costo" fill="#ef4444" radius={[0, 8, 8, 0]} maxBarSize={28} />
      </BarChart>
    </Tarjeta>
  )
}

export default function GraficosMermas({ periodo = 'semana', porPeriodo = [], porMotivo = [], porProducto = [] }) {
  if (!porPeriodo || porPeriodo.length === 0) {
    return <p className="hint">No hay mermas en el período seleccionado.</p>
  }
  return (
    <>
      <div className="mg-grid">
        <GraficoPeriodo
          titulo="Volumen de mermas"
          subtitulo="Cantidad dada de baja por período"
          datos={porPeriodo}
          periodo={periodo}
          campo="cantidad"
          formato={cantidad}
          color="#3b82f6"
          colorFin="#1d4ed8"
          nombre="Cantidad"
        />
        <GraficoPeriodo
          titulo="Costo valorizado"
          subtitulo="Pérdida económica por período"
          datos={porPeriodo}
          periodo={periodo}
          campo="costo"
          formato={dinero}
          color="#fb923c"
          colorFin="#c2410c"
          nombre="Costo"
        />
      </div>
      <div className="mg-grid">
        <GraficoMotivo datos={porMotivo} />
        <GraficoTopInsumos datos={porProducto} />
      </div>
    </>
  )
}