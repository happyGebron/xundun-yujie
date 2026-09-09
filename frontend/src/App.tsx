import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import {
  Activity,
  AlertTriangle,
  Battery,
  Bot,
  ChevronRight,
  CircleCheck,
  ClipboardCheck,
  Clock3,
  Crosshair,
  Gauge,
  History,
  Map,
  Pause,
  Plane,
  Play,
  Radio,
  RotateCcw,
  Route,
  ShieldAlert,
  Signal,
  Waves,
  Wifi,
} from 'lucide-react'

type Risk = {
  id: string
  name: string
  position: [number, number]
  kind: string
  severity: '高' | '中' | '低'
  rgb: number
  thermal_delta: number
  spectrum: number
  score: number
  status: string
  assigned: string | null
  evidence: { edge_energy: number; thermal_delta_c: number; signal: number[] }
}

type Agent = {
  id: string
  type: 'UAV' | 'UGV'
  name: string
  position: [number, number]
  battery: number
  link: number
  mode: string
  route: [number, number][]
}

type State = {
  mission: { id: string; status: string; cycle: number; updated_at: string }
  agents: Agent[]
  risks: Risk[]
  mesh: { health: number; mode: string; relay: string; fault: string | null }
  timeline: { time: string; level: string; text: string }[]
  last_control: { method: string; speed_mps: number; heading_deg: number; clearance_cells: number }
  summary: { risk_count: number; high_risk_count: number; online_agents: number; coverage: number }
}

type View = 'overview' | 'risks' | 'coordination' | 'history'

const navigation = [
  { id: 'overview' as const, label: '态势', icon: Map },
  { id: 'risks' as const, label: '风险', icon: ShieldAlert },
  { id: 'coordination' as const, label: '协同', icon: Route },
  { id: 'history' as const, label: '记录', icon: History },
]

const faultOptions = [
  ['mesh', '链路衰减'],
  ['obstacle', '动态障碍'],
  ['thermal', '热源漂移'],
  ['gps', '定位降级'],
] as const

async function request(path: string, method = 'GET'): Promise<State> {
  const response = await fetch(path, { method, headers: { Accept: 'application/json' } })
  const payload = await response.json() as State & { error?: string }
  if (!response.ok) throw new Error(payload.error ?? '请求未完成，请稍后重试。')
  return payload
}

function riskClass(severity: Risk['severity']) {
  return severity === '高' ? 'risk-high' : severity === '中' ? 'risk-medium' : 'risk-low'
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`
}

function mapPoint(point: [number, number]) {
  return [55 + point[0] * 50, 65 + point[1] * 48]
}

function SignalChart({ signal }: { signal: number[] }) {
  const points = signal.map((value, index) => `${index * (260 / Math.max(signal.length - 1, 1))},${72 - value * 62}`).join(' ')
  return (
    <svg className="signal-chart" viewBox="0 0 260 84" role="img" aria-label="所选事件的传感器时间序列">
      <path d="M0 72 H260 M0 42 H260 M0 12 H260" className="chart-grid" />
      <polyline points={points} className="chart-line" />
    </svg>
  )
}

function DamMap({ agents, risks, running, selectedRisk, onSelectRisk }: {
  agents: Agent[]
  risks: Risk[]
  running: boolean
  selectedRisk: string
  onSelectRisk: (id: string) => void
}) {
  const horizontalLines = Array.from({ length: 11 }, (_, index) => index)
  const verticalLines = Array.from({ length: 19 }, (_, index) => index)
  return (
    <div className={`map-viewport ${running ? 'running' : ''}`}>
      <svg className="dam-map" viewBox="0 0 1000 600" role="img" aria-label="坝区数字孪生态势图，可选择风险事件">
        <rect width="1000" height="600" className="map-bg" />
        <path d="M0 70 C180 18 354 58 520 28 C730 -8 840 40 1000 12 L1000 0 L0 0 Z" className="ridge far" />
        <path d="M0 126 C148 76 282 126 450 84 C632 38 810 112 1000 56 L1000 0 L0 0 Z" className="ridge near" />
        {horizontalLines.map((line) => <line key={`h${line}`} x1="50" x2="950" y1={50 + line * 48} y2={50 + line * 48} className="grid-line" />)}
        {verticalLines.map((line) => <line key={`v${line}`} y1="50" y2="530" x1={50 + line * 50} x2={50 + line * 50} className="grid-line" />)}
        <path d="M0 385 C170 328 310 430 486 368 C676 302 800 405 1000 332 L1000 600 L0 600 Z" className="reservoir" />
        <path d="M76 168 L914 168 L858 236 L132 236 Z" className="dam-crest" />
        <path d="M132 236 L858 236 L786 326 L204 326 Z" className="dam-face" />
        <path d="M204 326 L786 326" className="dam-base" />
        <path d="M442 168 L470 326 M530 168 L558 326" className="spillway" />
        <g aria-label="禁行障碍区">
          <path d="M342 142 H442 V238 H342 Z M592 334 H742 V382 H592 Z" className="restricted" />
          <path d="M350 152 L432 228 M432 152 L350 228 M602 342 L732 374 M732 342 L602 374" className="restricted-mark" />
        </g>
        <g className="coordinate-labels" aria-hidden="true">
          <text x="50" y="552">00</text><text x="490" y="552">09</text><text x="930" y="552">18</text>
          <text x="20" y="58">00</text><text x="20" y="298">05</text><text x="20" y="530">10</text>
        </g>
        {agents.map((agent) => {
          const routePoints = agent.route.map((point) => mapPoint(point).join(',')).join(' ')
          const [cx, cy] = mapPoint(agent.position)
          return (
            <g key={agent.id}>
              {routePoints && <polyline points={routePoints} pathLength="1" className={`route-line ${agent.type.toLowerCase()}`} />}
              <g className={`agent-node ${agent.type.toLowerCase()}`} style={{ transform: `translate(${cx}px, ${cy}px)` }}>
                {agent.type === 'UAV' ? <path d="M-9 0 L0 -9 L9 0 L0 9 Z" /> : <rect x="-7" y="-7" width="14" height="14" rx="2" />}
                <path d="M12 -13 H36" className="node-leader" />
                <text x="40" y="-9">{agent.id}</text>
              </g>
            </g>
          )
        })}
        {risks.map((risk) => {
          const [cx, cy] = mapPoint(risk.position)
          const selected = risk.id === selectedRisk
          const reviewed = risk.status === '人工确认'
          return (
            <g
              key={risk.id}
              className={`risk-node ${riskClass(risk.severity)} ${selected ? 'selected' : ''} ${reviewed ? 'reviewed' : ''}`}
              style={{ transform: `translate(${cx}px, ${cy}px)` }}
              role="button"
              tabIndex={0}
              aria-label={`${risk.id}，${risk.name}，${risk.severity}风险，${risk.status}`}
              onClick={() => onSelectRisk(risk.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelectRisk(risk.id)
                }
              }}
            >
              <circle r="19" className="risk-halo" />
              <path d="M0 -10 L9 8 H-9 Z" className="risk-symbol" />
              <circle r="2.5" cy="3" className="risk-core" />
              <path d="M13 12 H45" className="node-leader" />
              <text x="49" y="16">{risk.id}</text>
            </g>
          )
        })}
        {running && <rect x="50" y="50" width="900" height="2" className="scan-line" />}
      </svg>
      <div className="map-heading"><p>实时任务工作面</p><h1>坝区协同态势</h1></div>
      <div className="map-tools" aria-label="地图状态"><Crosshair aria-hidden="true" /><span>18 × 10 仿真网格</span></div>
      <div className="map-legend" aria-label="地图图例"><span><i className="uav-key" />UAV 航迹</span><span><i className="ugv-key" />UGV 路径</span><span><i className="risk-key" />风险点</span></div>
    </div>
  )
}

function Metric({ label, value, detail, attention = false }: { label: string; value: string; detail: string; attention?: boolean }) {
  return <div className={`metric ${attention ? 'attention' : ''}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
}

function App() {
  const [state, setState] = useState<State | null>(null)
  const [activeView, setActiveView] = useState<View>('overview')
  const [selectedRiskId, setSelectedRiskId] = useState('R-021')
  const [message, setMessage] = useState('正在连接本地仿真 API…')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  const load = useCallback(async () => {
    try {
      const nextState = await request('/api/overview')
      setState(nextState)
      setError('')
      setMessage('状态已同步')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法连接本地 API。')
    }
  }, [])

  const runAction = useCallback((path: string, label: string) => {
    startTransition(async () => {
      try {
        const nextState = await request(path, 'POST')
        setState(nextState)
        setError('')
        setMessage(label)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '操作未完成，请重试。')
      }
    })
  }, [startTransition])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (state?.mission.status !== '执行中') return
    const timer = window.setInterval(() => runAction('/api/simulation/tick', '控制周期已推进'), 4000)
    return () => window.clearInterval(timer)
  }, [runAction, state?.mission.status])

  const selectedRisk = useMemo(() => state?.risks.find((risk) => risk.id === selectedRiskId) ?? state?.risks[0], [selectedRiskId, state])
  const isRunning = state?.mission.status === '执行中'

  if (!state) {
    return <main className="loading-screen" aria-live="polite"><Activity aria-hidden="true" /><p>{error || message}</p><button type="button" onClick={() => void load()}>重新连接 API</button></main>
  }

  const riskInspector = selectedRisk && (
    <>
      <div className="inspector-title"><div><p className="section-kicker">当前事件</p><h2>{selectedRisk.id}</h2></div><span className={`severity ${riskClass(selectedRisk.severity)}`}>{selectedRisk.severity}风险</span></div>
      <div className="risk-summary"><p>{selectedRisk.name}</p><span>{selectedRisk.kind} · {selectedRisk.status}</span><strong>{formatPercent(selectedRisk.score)}</strong><small>多源融合评分</small></div>
      <div className="evidence-bars" aria-label="风险证据构成">
        <div><span>视觉边缘</span><b>{formatPercent(selectedRisk.rgb)}</b><i><em style={{ width: formatPercent(selectedRisk.rgb) }} /></i></div>
        <div><span>热成像温差</span><b>{selectedRisk.thermal_delta}°C</b><i><em style={{ width: `${Math.min(100, selectedRisk.thermal_delta / 15 * 100)}%` }} /></i></div>
        <div><span>频域异常</span><b>{formatPercent(selectedRisk.spectrum)}</b><i><em style={{ width: formatPercent(selectedRisk.spectrum) }} /></i></div>
      </div>
    </>
  )

  return (
    <div className="app-shell">
      <a className="skip-link" href="#operations-map">跳转到任务工作面</a>
      <header className="topbar">
        <a className="brand" href="#operations-map" aria-label="巡盾御界主页"><ShieldAlert aria-hidden="true" /><span>巡盾御界<small>智能巡坝指挥台</small></span></a>
        <div className="mission-state"><span className={`live-dot ${isRunning ? 'active' : ''}`} /><div><b>{state.mission.status}</b><small className="mono">{state.mission.id}</small></div></div>
        <div className="top-metrics" aria-label="任务摘要"><span>周期<b>{state.mission.cycle}</b></span><span>覆盖<b>{state.summary.coverage}%</b></span><span>链路<b>{state.mesh.health}%</b></span></div>
        <div className="top-actions"><button type="button" className="icon-button" aria-label="重置场景" title="重置场景" disabled={isPending} onClick={() => runAction('/api/mission/reset', '场景已重置')}><RotateCcw aria-hidden="true" /></button><button type="button" className="primary-action" disabled={isPending} onClick={() => runAction(isRunning ? '/api/mission/pause' : '/api/mission/start', isRunning ? '任务已暂停' : '协同任务已启动')}>{isRunning ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}{isRunning ? '暂停任务' : '启动任务'}</button></div>
      </header>

      <nav className="mobile-viewbar" aria-label="移动端工作区导航">{navigation.map(({ id, label }) => <button key={id} type="button" aria-pressed={activeView === id} onClick={() => setActiveView(id)}>{label}</button>)}</nav>

      <main className="workspace">
        <nav className="side-rail" aria-label="工作区导航">
          {navigation.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-pressed={activeView === id} onClick={() => setActiveView(id)}><Icon aria-hidden="true" /><span>{label}</span></button>)}
          <div className="rail-connection" title={`MESH 链路健康度 ${state.mesh.health}%`}><Wifi aria-hidden="true" /><span>{state.mesh.health}</span></div>
        </nav>

        <section className="map-region" id="operations-map" aria-label="数字孪生任务地图">
          <DamMap agents={state.agents} risks={state.risks} running={isRunning} selectedRisk={selectedRisk?.id ?? ''} onSelectRisk={(id) => { setSelectedRiskId(id); setActiveView('overview') }} />
          <div className="telemetry-band" aria-label="实时任务指标">
            <Metric label="风险队列" value={`${state.summary.risk_count}`} detail={`${state.summary.high_risk_count} 项需优先处置`} attention={state.summary.high_risk_count > 0} />
            <Metric label="在线单元" value={`${state.summary.online_agents}/${state.agents.length}`} detail="空地节点协同" />
            <Metric label="局部速度" value={`${state.last_control.speed_mps}`} detail={`${state.last_control.method} · m/s`} />
            <Metric label="安全净空" value={`${state.last_control.clearance_cells}`} detail="障碍栅格" />
          </div>
          <div className="agent-band" aria-label="执行单元状态">
            {state.agents.map((agent) => <div key={agent.id} className="agent-status"><span>{agent.type === 'UAV' ? <Plane aria-hidden="true" /> : <Bot aria-hidden="true" />}</span><div><b>{agent.id}</b><small>{agent.mode}</small></div><dl><div><dt><Battery aria-hidden="true" />电量</dt><dd>{agent.battery}%</dd></div><div><dt><Signal aria-hidden="true" />链路</dt><dd>{agent.link}%</dd></div></dl></div>)}
          </div>
        </section>

        <aside className="inspector" aria-label="任务检查器">
          {activeView === 'overview' && <>
            <section className="inspector-section">{riskInspector}<button type="button" className="review-action" disabled={isPending || selectedRisk?.status === '人工确认'} onClick={() => selectedRisk && runAction(`/api/risks/${selectedRisk.id}/review`, `${selectedRisk.id} 已人工确认`)}><ClipboardCheck aria-hidden="true" />{selectedRisk?.status === '人工确认' ? '事件已确认' : '确认风险事件'}</button></section>
            <section className="inspector-section queue-section"><div className="section-heading"><p className="section-kicker">处置顺序</p><span>{state.risks.length} 项</span></div><div className="risk-queue">{state.risks.map((risk) => <button key={risk.id} type="button" aria-pressed={selectedRisk?.id === risk.id} onClick={() => setSelectedRiskId(risk.id)}><i className={riskClass(risk.severity)} /><span><b>{risk.id} · {risk.name}</b><small>{risk.assigned ?? '等待分派'} · {risk.status}</small></span><strong>{formatPercent(risk.score)}</strong><ChevronRight aria-hidden="true" /></button>)}</div></section>
          </>}

          {activeView === 'risks' && <>
            <section className="inspector-section">{riskInspector}{selectedRisk && <SignalChart signal={selectedRisk.evidence.signal} />}<p className="data-note">可解释特征用于软件推演，不代表真实坝体诊断结论。</p></section>
            <section className="inspector-section"><div className="section-heading"><p className="section-kicker">风险队列</p><span>{state.risks.length} 项</span></div><div className="risk-queue">{state.risks.map((risk) => <button key={risk.id} type="button" aria-pressed={selectedRisk?.id === risk.id} onClick={() => setSelectedRiskId(risk.id)}><i className={riskClass(risk.severity)} /><span><b>{risk.id} · {risk.kind}</b><small>{risk.status}</small></span><strong>{formatPercent(risk.score)}</strong><ChevronRight aria-hidden="true" /></button>)}</div></section>
          </>}

          {activeView === 'coordination' && <>
            <section className="inspector-section"><div className="inspector-title"><div><p className="section-kicker">通信韧性</p><h2>{state.mesh.mode}</h2></div><Radio aria-hidden="true" /></div><div className="mesh-readout"><strong>{state.mesh.health}%</strong><span>链路健康度 · 中继 {state.mesh.relay}</span><i><em style={{ width: `${state.mesh.health}%` }} /></i></div><ul className="check-list" role="list"><li><CircleCheck aria-hidden="true" />自动发现邻居节点</li><li><CircleCheck aria-hidden="true" />弱链路启用中继与缓存</li><li><CircleCheck aria-hidden="true" />风险事件保留确认轨迹</li></ul></section>
            <section className="inspector-section"><div className="section-heading"><p className="section-kicker">控制链路</p><span>{state.last_control.method}</span></div><div className="control-facts"><span><Route aria-hidden="true" /><b>A*</b><small>全局路径</small></span><span><Waves aria-hidden="true" /><b>{state.last_control.heading_deg}°</b><small>当前航向</small></span><span><Gauge aria-hidden="true" /><b>{state.last_control.speed_mps}</b><small>速度 m/s</small></span></div></section>
            <section className="inspector-section"><p className="section-kicker">故障推演</p><div className="fault-grid">{faultOptions.map(([kind, label]) => <button key={kind} type="button" disabled={isPending} onClick={() => runAction(`/api/fault?kind=${kind}`, `${label}已注入`)}><AlertTriangle aria-hidden="true" />{label}</button>)}</div></section>
          </>}

          {activeView === 'history' && <>
            <section className="inspector-section"><div className="inspector-title"><div><p className="section-kicker">任务回放</p><h2>控制事件记录</h2></div><button type="button" className="icon-button" aria-label="推进一个控制周期" title="推进一个控制周期" disabled={isPending} onClick={() => runAction('/api/simulation/tick', '手动推进一个控制周期')}><Activity aria-hidden="true" /></button></div><ol className="timeline" role="list">{state.timeline.map((item, index) => <li key={`${item.time}-${index}`} className={item.level}><time>{item.time}</time><span /><p>{item.text}</p></li>)}</ol></section>
            <section className="inspector-section boundary"><p className="section-kicker">系统边界</p><p>当前版本用于数字孪生、算法联调和界面演示；不连接真实硬件，不替代工程检测与安全决策。</p></section>
          </>}
        </aside>
      </main>

      <footer className="statusbar"><span><span className={`live-dot ${isRunning ? 'active' : ''}`} />{isRunning ? '自动推进开启 · 4 秒/周期' : '自动推进已停止'}</span><span role="status" aria-live="polite">{error || message}</span><span><Clock3 aria-hidden="true" />{state.mission.updated_at}</span><span>V1.1.0 · 软件仿真版</span></footer>
    </div>
  )
}

export default App
