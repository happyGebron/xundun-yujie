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
  MapPinned,
  Pause,
  Plane,
  Play,
  Radio,
  RotateCcw,
  Route,
  ShieldAlert,
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

type Tab = '态势总览' | '风险复核' | '协同控制' | '任务记录'

const tabs: Tab[] = ['态势总览', '风险复核', '协同控制', '任务记录']
const faultOptions = [
  ['mesh', '模拟链路衰减'],
  ['obstacle', '模拟动态障碍'],
  ['thermal', '模拟热源漂移'],
  ['gps', '模拟定位降级'],
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

function MapCanvas({ agents, risks }: Pick<State, 'agents' | 'risks'>) {
  const horizontalLines = Array.from({ length: 11 }, (_, index) => index)
  const verticalLines = Array.from({ length: 19 }, (_, index) => index)
  return (
    <div className="map-wrap">
      <svg className="dam-map" viewBox="0 0 900 500" role="img" aria-label="巡坝仿真区域，包括坝体、禁行区、巡检单元和风险事件">
        <rect x="0" y="0" width="900" height="500" className="map-bg" />
        {horizontalLines.map((line) => <line key={`h${line}`} x1="0" x2="900" y1={line * 50} y2={line * 50} className="grid-line" />)}
        {verticalLines.map((line) => <line key={`v${line}`} y1="0" y2="500" x1={line * 50} x2={line * 50} className="grid-line" />)}
        <path d="M52 88 L850 88 L805 158 L97 158 Z" className="dam-body" />
        <path d="M97 158 L805 158 L748 230 L156 230 Z" className="dam-shadow" />
        <path d="M0 330 C160 275 275 382 436 330 C620 272 720 371 900 300 L900 500 L0 500 Z" className="water-line" />
        <g aria-label="禁行障碍区">
          <rect x="300" y="100" width="100" height="100" className="obstacle" />
          <rect x="550" y="300" width="150" height="50" className="obstacle" />
        </g>
        {agents.map((agent) => {
          const [x, y] = agent.position
          const cx = 25 + x * 50
          const cy = 25 + y * 50
          return (
            <g key={agent.id} className={`agent-node ${agent.type.toLowerCase()}`}>
              {agent.type === 'UAV' ? <path d={`M${cx - 10} ${cy} L${cx} ${cy - 10} L${cx + 10} ${cy} L${cx} ${cy + 10} Z`} /> : <rect x={cx - 8} y={cy - 8} width="16" height="16" rx="3" />}
              <text x={cx + 12} y={cy - 10}>{agent.id}</text>
            </g>
          )
        })}
        {risks.map((risk) => {
          const [x, y] = risk.position
          return <g key={risk.id} className={`risk-marker ${riskClass(risk.severity)}`}><circle cx={25 + x * 50} cy={25 + y * 50} r="10" /><circle cx={25 + x * 50} cy={25 + y * 50} r="18" className="risk-ring" /></g>
        })}
      </svg>
      <div className="map-legend" aria-label="地图图例">
        <span><i className="legend-uav" />空中巡检</span>
        <span><i className="legend-ugv" />地面复核</span>
        <span><i className="legend-risk" />风险事件</span>
      </div>
    </div>
  )
}

function Metric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: string }) {
  return <section className={`metric ${tone ?? ''}`} aria-label={`${label}：${value}`}><p>{label}</p><strong>{value}</strong><span>{detail}</span></section>
}

function SignalChart({ signal }: { signal: number[] }) {
  const points = signal.map((value, index) => `${index * 26},${80 - value * 75}`).join(' ')
  return <svg className="signal-chart" viewBox="0 0 300 96" role="img" aria-label="传感器时间序列示意图"><path d="M0 80 H300" className="chart-grid" /><polyline points={points} className="chart-line" /></svg>
}

function App() {
  const [state, setState] = useState<State | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('态势总览')
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

  const focusRisk = useMemo(() => state?.risks.find((risk) => risk.severity === '高') ?? state?.risks[0], [state])
  const isRunning = state?.mission.status === '执行中'

  if (!state) {
    return <main className="loading-screen" aria-live="polite"><Activity aria-hidden="true" /><p>{error || message}</p><button type="button" onClick={() => void load()}>重新连接 API</button></main>
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#command-center">跳转到指挥主界面</a>
      <header className="topbar">
        <a className="brand" href="#command-center" aria-label="巡盾御界主页"><span className="brand-mark"><ShieldAlert aria-hidden="true" /></span><span>巡盾御界<small>智能巡坝指挥台</small></span></a>
        <div className="mission-meta"><span className={`status-dot ${isRunning ? 'live' : ''}`} />{state.mission.status}<span>·</span><span className="mono">{state.mission.id}</span></div>
        <div className="topbar-actions">
          <span className="connection"><Wifi aria-hidden="true" />MESH {state.mesh.health}%</span>
          <button type="button" className="button secondary" disabled={isPending} onClick={() => runAction('/api/mission/reset', '场景已重置')}><RotateCcw aria-hidden="true" />重置场景</button>
          <button type="button" className="button primary" disabled={isPending} onClick={() => runAction(isRunning ? '/api/mission/pause' : '/api/mission/start', isRunning ? '任务已暂停' : '协同任务已启动')}>{isRunning ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}{isRunning ? '暂停任务' : '启动任务'}</button>
        </div>
      </header>

      <nav className="tabbar" aria-label="主导航">
        {tabs.map((tab) => <button key={tab} type="button" aria-pressed={activeTab === tab} className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>{tab}</button>)}
        <span className="refresh-note" role="status" aria-atomic="true"><Clock3 aria-hidden="true" />{state.mission.updated_at}</span>
      </nav>

      <main id="command-center" className="command-center">
        <section className="metrics-grid" aria-label="任务关键指标">
          <Metric label="风险队列" value={`${state.summary.risk_count} 项`} detail={`${state.summary.high_risk_count} 项高风险`} tone="attention" />
          <Metric label="巡检覆盖" value={`${state.summary.coverage}%`} detail={`第 ${state.mission.cycle} 个控制周期`} />
          <Metric label="在线单元" value={`${state.summary.online_agents}/${state.agents.length}`} detail="空地节点实时协同" />
          <Metric label="链路健康度" value={`${state.mesh.health}%`} detail={state.mesh.fault ? '故障降级模式' : state.mesh.mode} tone={state.mesh.health < 70 ? 'attention' : ''} />
        </section>

        {activeTab === '态势总览' && <section className="work-grid">
          <div className="map-panel panel">
            <div className="panel-head"><div><p className="eyebrow">实时态势</p><h1>坝段数字孪生图</h1></div><span className="mono control-badge"><Crosshair aria-hidden="true" />坐标网格 18×10</span></div>
            <MapCanvas agents={state.agents} risks={state.risks} />
            <div className="control-strip"><span><Route aria-hidden="true" />全局规划：A*</span><span><Waves aria-hidden="true" />局部控制：{state.last_control.method}</span><span><Activity aria-hidden="true" />速度 {state.last_control.speed_mps} m/s</span><button type="button" className="text-button" disabled={isPending} onClick={() => runAction('/api/simulation/tick', '手动推进一个控制周期')}>推进一周期<ChevronRight aria-hidden="true" /></button></div>
          </div>
          <aside className="side-stack" aria-label="风险与单元状态">
            <section className="panel focus-risk">
              <div className="panel-head compact"><div><p className="eyebrow">优先处置</p><h2>{focusRisk?.id}</h2></div><span className={`severity ${focusRisk ? riskClass(focusRisk.severity) : ''}`}>{focusRisk?.severity}风险</span></div>
              {focusRisk && <><h3>{focusRisk.name}</h3><p className="muted">{focusRisk.kind} · 融合评分 {formatPercent(focusRisk.score)}</p><div className="evidence-row"><span>RGB 边缘能量<strong>{formatPercent(focusRisk.rgb)}</strong></span><span>温差<strong>{focusRisk.thermal_delta}°C</strong></span><span>频域异常<strong>{formatPercent(focusRisk.spectrum)}</strong></span></div><button type="button" className="button secondary wide" disabled={isPending} onClick={() => runAction(`/api/risks/${focusRisk.id}/review`, `${focusRisk.id} 已人工确认`)}><ClipboardCheck aria-hidden="true" />确认风险事件</button></>}
            </section>
            <section className="panel agent-panel"><div className="panel-head compact"><div><p className="eyebrow">执行单元</p><h2>空地编组</h2></div><Radio aria-hidden="true" /></div>{state.agents.map((agent) => <div className="agent-row" key={agent.id}><span className={`agent-icon ${agent.type.toLowerCase()}`}>{agent.type === 'UAV' ? <Plane aria-hidden="true" /> : <Bot aria-hidden="true" />}</span><div><strong>{agent.id}</strong><p>{agent.mode}</p></div><div className="agent-data"><span><Battery aria-hidden="true" />{agent.battery}%</span><span><Wifi aria-hidden="true" />{agent.link}%</span></div></div>)}</section>
          </aside>
        </section>}

        {activeTab === '风险复核' && <section className="detail-grid"><section className="panel risk-table-panel"><div className="panel-head"><div><p className="eyebrow">AI 证据融合</p><h1>风险复核队列</h1></div><span className="muted">评分由 RGB、热差与信号频域特征合成</span></div><div className="table-scroll"><table><thead><tr><th>事件</th><th>类型</th><th>融合评分</th><th>状态</th><th>操作</th></tr></thead><tbody>{state.risks.map((risk) => <tr key={risk.id}><td><strong>{risk.id}</strong><span>{risk.name}</span></td><td><span className={`severity ${riskClass(risk.severity)}`}>{risk.severity}风险</span><small>{risk.kind}</small></td><td className="mono">{formatPercent(risk.score)}</td><td>{risk.status}<small>{risk.assigned ?? '等待分派'}</small></td><td><button type="button" className="text-button" disabled={isPending} onClick={() => runAction(`/api/risks/${risk.id}/review`, `${risk.id} 已人工确认`)}>复核<ChevronRight aria-hidden="true" /></button></td></tr>)}</tbody></table></div></section><section className="panel evidence-panel"><p className="eyebrow">当前证据</p><h2>{focusRisk?.id} 频域时间序列</h2>{focusRisk && <SignalChart signal={focusRisk.evidence.signal} />}<dl><div><dt>边缘能量</dt><dd>{formatPercent(focusRisk?.evidence.edge_energy ?? 0)}</dd></div><div><dt>热成像温差</dt><dd>{focusRisk?.evidence.thermal_delta_c ?? 0}°C</dd></div><div><dt>融合阈值</dt><dd>65%</dd></div></dl><p className="muted">这是可解释的软件推演特征，不代表真实坝体诊断结论。</p></section></section>}

        {activeTab === '协同控制' && <section className="detail-grid"><section className="panel coordinator-panel"><div className="panel-head"><div><p className="eyebrow">空地协同控制</p><h1>分派与规划状态</h1></div><span className="control-badge mono">{state.last_control.method} 速度窗</span></div><div className="flow-list"><div><span>01</span><article><h2>空中扫描</h2><p>UAV 执行面状覆盖，提交表观与热异常候选。</p></article><strong>{state.agents[0].mode}</strong></div><div><span>02</span><article><h2>最小代价分派</h2><p>以任务距离与融合风险评分构建代价矩阵，完成匹配。</p></article><strong>{state.risks.filter((risk) => risk.status === '已分派').length} 已分派</strong></div><div><span>03</span><article><h2>地面复核</h2><p>A* 生成全局路径，DWA 根据障碍密度更新局部速度。</p></article><strong>{state.last_control.clearance_cells} 格净空</strong></div></div><div className="fault-actions"><p>故障推演</p>{faultOptions.map(([kind, label]) => <button key={kind} type="button" className="button secondary" disabled={isPending} onClick={() => runAction(`/api/fault?kind=${kind}`, `${label}已注入`)}><AlertTriangle aria-hidden="true" />{label}</button>)}</div></section><section className="panel mesh-panel"><p className="eyebrow">通信韧性</p><h2>{state.mesh.mode}</h2><div className="mesh-gauge"><strong>{state.mesh.health}%</strong><span>健康度</span></div><p className="muted">中继节点：{state.mesh.relay}</p><ul role="list"><li><CircleCheck aria-hidden="true" />自动发现邻居节点</li><li><CircleCheck aria-hidden="true" />链路衰减时启用缓存</li><li><CircleCheck aria-hidden="true" />风险事件保留确认轨迹</li></ul></section></section>}

        {activeTab === '任务记录' && <section className="detail-grid"><section className="panel timeline-panel"><div className="panel-head"><div><p className="eyebrow">任务回放</p><h1>控制事件记录</h1></div><button type="button" className="button secondary" disabled={isPending} onClick={() => runAction('/api/simulation/tick', '手动推进一个控制周期')}><Activity aria-hidden="true" />推进一周期</button></div><ol className="timeline" role="list">{state.timeline.map((item, index) => <li key={`${item.time}-${index}`} className={item.level}><time>{item.time}</time><span /><p>{item.text}</p></li>)}</ol></section><section className="panel report-panel"><p className="eyebrow">版本边界</p><h2>V1.0.0 软件能力</h2><ul role="list"><li><CircleCheck aria-hidden="true" />多源风险融合评分</li><li><CircleCheck aria-hidden="true" />A* 路径与 DWA 局部控制</li><li><CircleCheck aria-hidden="true" />任务分派与链路故障推演</li></ul><p className="muted">该版本用于数字孪生、算法联调和界面演示；不连接真实硬件，不替代工程检测与安全决策。</p></section></section>}
      </main>

      <footer><span>V1.0.0 · 软件仿真版</span><span role="status" aria-live="polite">{error || message}</span><span>演示数据仅用于算法与界面联调</span></footer>
    </div>
  )
}

export default App
