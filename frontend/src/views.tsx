import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Activity, AlertTriangle, Battery, Bot, Check, ChevronLeft, ChevronRight, CircleDot,
  Download, FileChartColumn, FileVideo, Gauge, MapPin, Pause, Plane, Play, Radio,
  Route, ShieldCheck, Signal, StepForward, Upload, Waves, X,
} from 'lucide-react'
import type { Analysis, EventRecord, Locale, MissionState, MissionSummary, Risk, Scenario } from './api'
import { artifactUrl } from './api'
import { t } from './i18n'

export type ViewProps = {
  locale: Locale
  state: MissionState
  analyses: Analysis[]
  events: EventRecord[]
  missions: MissionSummary[]
  scenarios: Scenario[]
  pending: boolean
  onCommand: (command: string, value?: number) => Promise<void>
  onReview: (riskId: string, decision: 'confirmed' | 'dismissed', note?: string) => Promise<void>
  onFault: (kind: string) => Promise<void>
  onUpload: (form: FormData) => Promise<void>
  onSample: (kind: 'multimodal' | 'video', bind: boolean, x: number, y: number) => Promise<void>
  onCreate: (body: { scenario_id: string; seed: number; parameters: { risk_count: number; obstacle_count: number; link_quality: number } }) => Promise<void>
  onSelectMission: (id: string) => Promise<void>
}

const severityOrder = { high: 0, medium: 1, low: 2 }
const pct = (value: number) => `${Math.round(value * 100)}%`
const fixed = (value: number, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : '—'
const riskName = (risk: Risk, locale: Locale) => locale === 'zh-CN' ? risk.name_zh : risk.name_en
const eventText = (event: { text_zh?: string; text_en?: string; code?: string }, locale: Locale) => locale === 'zh-CN' ? event.text_zh ?? event.code : event.text_en ?? event.code

function pointToMap(state: MissionState, point: [number, number]) {
  return [60 + point[0] * (880 / (state.grid.width - 1)), 66 + point[1] * (452 / (state.grid.height - 1))]
}

export function DamMap({ state, locale, selectedRiskId, onSelectRisk, showControl = false, replay = false }: {
  state: MissionState
  locale: Locale
  selectedRiskId?: string
  onSelectRisk?: (id: string) => void
  showControl?: boolean
  replay?: boolean
}) {
  const gridRows = Array.from({ length: state.grid.height }, (_, index) => index)
  const gridColumns = Array.from({ length: state.grid.width }, (_, index) => index)
  return (
    <section className={`map-viewport ${state.mission.status === 'running' ? 'is-running' : ''} ${replay ? 'is-replay' : ''}`} aria-label={t(locale, 'mapTitle')}>
      <div className="map-heading"><span>{replay ? t(locale, 'replay') : t(locale, 'mapEyebrow')}</span><h1>{t(locale, 'mapTitle')}</h1></div>
      <div className="map-coordinate"><CircleDot aria-hidden="true" /><span>{state.grid.width} × {state.grid.height} {t(locale, 'grid')}</span></div>
      <svg className="dam-map" viewBox="0 0 1000 600" role="img" aria-label={`${t(locale, 'mapTitle')}; ${state.risks.length} ${t(locale, 'riskPoint')}`}>
        <rect width="1000" height="600" className="map-background" />
        <path d="M0 92C150 38 318 86 490 42C690-10 826 68 1000 18V0H0Z" className="terrain terrain-far" />
        <path d="M0 150C174 82 300 148 472 96C676 34 836 132 1000 62V0H0Z" className="terrain terrain-near" />
        {gridRows.map(row => <line key={`r-${row}`} x1="60" x2="940" y1={66 + row * (452 / (state.grid.height - 1))} y2={66 + row * (452 / (state.grid.height - 1))} className="map-grid" />)}
        {gridColumns.map(column => <line key={`c-${column}`} y1="66" y2="518" x1={60 + column * (880 / (state.grid.width - 1))} x2={60 + column * (880 / (state.grid.width - 1))} className="map-grid" />)}
        <path d="M0 398C174 328 312 448 490 374C684 294 822 416 1000 344V600H0Z" className="water" />
        <path d="M88 174H916L852 238H148Z" className="dam-crest" />
        <path d="M148 238H852L780 330H220Z" className="dam-face" />
        <path d="M220 330H780" className="dam-base" />
        <path d="M440 174L466 330M534 174L560 330" className="spillway" />
        {[...state.grid.obstacles, ...state.grid.dynamic_obstacles].map((point, index) => {
          const [x, y] = pointToMap(state, point)
          const dynamic = index >= state.grid.obstacles.length
          return <g key={`o-${index}`} className={dynamic ? 'dynamic-obstacle' : 'obstacle'} transform={`translate(${x} ${y})`}><rect x="-11" y="-11" width="22" height="22" rx="3" /><path d="M-7-7L7 7M7-7L-7 7" /></g>
        })}
        {showControl ? state.last_control.candidates.map((candidate, index) => {
          const points = candidate.trajectory.map(point => pointToMap(state, point).join(',')).join(' ')
          return <polyline key={`dwa-${index}`} points={points} className={`dwa-candidate ${candidate === state.last_control.chosen ? 'chosen' : ''} ${candidate.collision_free ? '' : 'blocked'}`} />
        }) : null}
        {state.agents.map(agent => {
          const route = agent.route.map(point => pointToMap(state, point).join(',')).join(' ')
          const trail = agent.trail.map(point => pointToMap(state, point).join(',')).join(' ')
          const [x, y] = pointToMap(state, agent.position)
          return (
            <g key={agent.id} className={`agent-layer ${agent.status}`}>
              {trail ? <polyline points={trail} className={`agent-trail ${agent.type.toLowerCase()}`} /> : null}
              {route ? <polyline points={route} className={`agent-route ${agent.type.toLowerCase()}`} /> : null}
              <g className={`agent-marker ${agent.type.toLowerCase()}`} transform={`translate(${x} ${y}) rotate(${agent.heading_deg})`}>
                {agent.type === 'UAV' ? <path d="M-11 0L0-10L11 0L0 10Z" /> : <rect x="-8" y="-7" width="16" height="14" rx="2" />}
                <circle r="17" className="agent-range" />
              </g>
              <g transform={`translate(${x + 15} ${y - 13})`} className="map-label"><path d="M0 7H20" /><text x="25" y="10">{agent.id}</text></g>
            </g>
          )
        })}
        {state.risks.map(risk => {
          const [x, y] = pointToMap(state, risk.position)
          const selected = risk.id === selectedRiskId
          return (
            <g key={risk.id} className={`risk-marker severity-${risk.severity} ${selected ? 'selected' : ''} status-${risk.status}`} transform={`translate(${x} ${y})`} role={onSelectRisk ? 'button' : undefined} tabIndex={onSelectRisk ? 0 : undefined} aria-label={`${risk.id}, ${riskName(risk, locale)}, ${t(locale, risk.severity)}`} onClick={() => onSelectRisk?.(risk.id)} onKeyDown={event => {
              if (onSelectRisk && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelectRisk(risk.id) }
            }}>
              <circle r="19" className="risk-halo" /><path d="M0-10L9 8H-9Z" className="risk-symbol" /><circle cy="3" r="2.2" className="risk-core" />
              <path d="M13 13H38" className="risk-leader" /><text x="43" y="17">{risk.id}</text>
            </g>
          )
        })}
        {state.mission.status === 'running' ? <rect x="60" y="66" width="880" height="2" className="scan-line" /> : null}
      </svg>
      <div className="map-legend" aria-label="Map legend"><span><i className="legend-uav" />{t(locale, 'uavTrack')}</span><span><i className="legend-ugv" />{t(locale, 'ugvRoute')}</span><span><i className="legend-risk" />{t(locale, 'riskPoint')}</span><span><i className="legend-obstacle" />{t(locale, 'obstacle')}</span></div>
    </section>
  )
}

function MetricStrip({ state, locale }: { state: MissionState; locale: Locale }) {
  const values = [
    [t(locale, 'riskQueue'), String(state.summary.risk_count), `${state.summary.high_risk_count} ${t(locale, 'highPriority')}`],
    [t(locale, 'onlineUnits'), `${state.summary.online_agents}/${state.agents.length}`, t(locale, 'communication')],
    [t(locale, 'localSpeed'), fixed(state.last_control.speed_mps), 'DWA · m/s'],
    [t(locale, 'safeClearance'), fixed(state.last_control.clearance_cells, 1), t(locale, 'grid')],
  ]
  return <div className="metric-strip">{values.map(([label, value, detail], index) => <div key={label} className={index === 0 && state.summary.high_risk_count ? 'attention' : ''}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>)}</div>
}

function AgentStrip({ state, locale }: { state: MissionState; locale: Locale }) {
  return <div className="agent-strip">{state.agents.map(agent => <article key={agent.id}><span className="agent-type">{agent.type === 'UAV' ? <Plane aria-hidden="true" /> : <Bot aria-hidden="true" />}</span><div className="agent-identity"><strong>{agent.id}</strong><span>{t(locale, agent.mode)}</span></div><dl><div><dt><Battery aria-hidden="true" />{t(locale, 'battery')}</dt><dd>{Math.round(agent.battery)}%</dd></div><div><dt><Signal aria-hidden="true" />{t(locale, 'link')}</dt><dd>{Math.round(agent.link)}%</dd></div></dl></article>)}</div>
}

function RiskInspector({ state, locale, risk, pending, onReview }: { state: MissionState; locale: Locale; risk?: Risk; pending: boolean; onReview: ViewProps['onReview'] }) {
  const [decision, setDecision] = useState<'confirmed' | 'dismissed'>('confirmed')
  const [note, setNote] = useState('')
  if (!risk) return <div className="empty-state"><ShieldCheck aria-hidden="true" /><p>{t(locale, 'noRisk')}</p></div>
  const evidence = Object.entries(risk.evidence).filter(([, value]) => typeof value === 'number') as [string, number][]
  return (
    <div className="risk-inspector">
      <header className="panel-heading"><div><span>{t(locale, 'currentRisk')}</span><h2>{risk.id}</h2></div><span className={`severity-label severity-${risk.severity}`}>{t(locale, risk.severity)}</span></header>
      <div className="risk-primary"><div><strong>{riskName(risk, locale)}</strong><span>{t(locale, risk.status)} · {risk.source === 'synthetic' ? t(locale, 'scenarios') : t(locale, 'analysis')}</span></div><output>{pct(risk.score)}<small>{t(locale, 'fusionScore')}</small></output></div>
      <dl className="fact-list"><div><dt>{t(locale, 'assigned')}</dt><dd>{risk.assigned ?? t(locale, 'unassigned')}</dd></div><div><dt>{t(locale, 'position')}</dt><dd className="mono">{risk.position.map(value => fixed(value, 1)).join(' / ')}</dd></div><div><dt>{t(locale, 'source')}</dt><dd className="mono">{risk.source}</dd></div></dl>
      {evidence.length ? <div className="evidence-list" aria-label={t(locale, 'evidence')}>{evidence.slice(0, 4).map(([name, value]) => <div key={name}><span>{name}</span><b>{pct(Number(value))}</b><i><em style={{ transform: `scaleX(${Number(value)})` }} /></i></div>)}</div> : null}
      <form className="review-form" onSubmit={event => { event.preventDefault(); void onReview(risk.id, decision, note) }}>
        <fieldset><legend>{t(locale, 'saveReview')}</legend><div className="segmented"><button type="button" aria-pressed={decision === 'confirmed'} onClick={() => setDecision('confirmed')}><Check aria-hidden="true" />{t(locale, 'confirm')}</button><button type="button" aria-pressed={decision === 'dismissed'} onClick={() => setDecision('dismissed')}><X aria-hidden="true" />{t(locale, 'dismiss')}</button></div></fieldset>
        <label htmlFor="review-note">{t(locale, 'note')}</label><textarea id="review-note" name="note" value={note} maxLength={500} onChange={event => setNote(event.target.value)} />
        <button type="submit" className="panel-action" disabled={pending}>{t(locale, 'saveReview')}</button>
      </form>
      <p className="boundary-note">{t(locale, 'technicalBoundary')}</p>
      <span className="sr-only">{state.mission.id}</span>
    </div>
  )
}

export function OverviewView(props: ViewProps) {
  const { state, locale } = props
  const sortedRisks = useMemo(() => [...state.risks].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || b.score - a.score), [state.risks])
  const [selectedId, setSelectedId] = useState(sortedRisks[0]?.id ?? '')
  const selected = state.risks.find(risk => risk.id === selectedId) ?? sortedRisks[0]
  return (
    <div className="operations-layout">
      <div className="operations-main"><DamMap state={state} locale={locale} selectedRiskId={selected?.id} onSelectRisk={setSelectedId} /><MetricStrip state={state} locale={locale} /><AgentStrip state={state} locale={locale} /></div>
      <aside className="context-pane"><section><RiskInspector state={state} locale={locale} risk={selected} pending={props.pending} onReview={props.onReview} /></section><section className="queue-panel"><header className="section-heading"><div><span>{t(locale, 'riskQueue')}</span><h2>{state.risks.length}</h2></div><small>{state.summary.high_risk_count} {t(locale, 'highPriority')}</small></header><div className="risk-list">{sortedRisks.map(risk => <button type="button" key={risk.id} aria-pressed={selected?.id === risk.id} onClick={() => setSelectedId(risk.id)}><i className={`severity-${risk.severity}`} /><span><strong>{risk.id} · {riskName(risk, locale)}</strong><small>{risk.assigned ?? t(locale, 'unassigned')} · {t(locale, risk.status)}</small></span><b>{pct(risk.score)}</b><ChevronRight aria-hidden="true" /></button>)}</div></section></aside>
    </div>
  )
}

function DataLineChart({ values, label, locale }: { values: { x: number; y: number; marker?: boolean }[]; label: string; locale: Locale }) {
  if (values.length < 2) return null
  const min = Math.min(...values.map(value => value.y))
  const max = Math.max(...values.map(value => value.y))
  const points = values.map((value, index) => `${index * (560 / Math.max(1, values.length - 1))},${128 - ((value.y - min) / Math.max(0.0001, max - min)) * 104}`).join(' ')
  return (
    <div className="data-chart"><svg viewBox="0 0 560 150" role="img" aria-label={label}><path d="M0 24H560M0 76H560M0 128H560" className="chart-grid" /><polyline points={points} className="chart-line" />{values.map((value, index) => value.marker ? <circle key={index} cx={index * (560 / Math.max(1, values.length - 1))} cy={128 - ((value.y - min) / Math.max(0.0001, max - min)) * 104} r="4" className="chart-marker" /> : null)}</svg><div><span>{fixed(min, 3)}</span><strong>{label}</strong><span>{fixed(max, 3)}</span></div><details><summary>{t(locale, 'resultEvidence')}</summary><table><thead><tr><th scope="col">#</th><th scope="col">X</th><th scope="col">Y</th></tr></thead><tbody>{values.slice(0, 20).map((value, index) => <tr key={index}><td>{index + 1}</td><td>{fixed(value.x, 3)}</td><td>{fixed(value.y, 4)}</td></tr>)}</tbody></table></details></div>
  )
}

function AnalysisDetail({ analysis, locale }: { analysis: Analysis; locale: Locale }) {
  if (analysis.status !== 'completed' || !analysis.result) return <div className={`analysis-state ${analysis.status}`}><Activity aria-hidden="true" /><div><strong>{t(locale, analysis.status === 'failed' ? 'analysisFailed' : analysis.status)}</strong><span>{analysis.error ? `${analysis.error.code}: ${analysis.error.message}` : `${analysis.progress}%`}</span></div><i><em style={{ transform: `scaleX(${analysis.progress / 100})` }} /></i></div>
  const { fusion, modalities } = analysis.result
  const chartModality = modalities.video ?? modalities.sensor
  const chartValues = chartModality?.curve?.map(point => ({ x: point.time_s, y: point.score, marker: point.score >= 0.7 })) ?? chartModality?.series?.map(point => ({ x: point.timestamp, y: point.value })) ?? []
  return (
    <div className="analysis-detail">
      <header className="analysis-result-head"><div><span>{analysis.id}</span><h2>{t(locale, 'analysisCompleted')}</h2></div><output className={`severity-${fusion.level}`}>{pct(fusion.score)}<small>{t(locale, 'fusionScore')}</small></output></header>
      <div className="modality-table" role="table" aria-label={t(locale, 'evidence')}><div role="row" className="modality-head"><span role="columnheader">{t(locale, 'analysis')}</span><span role="columnheader">{t(locale, 'quality')}</span><span role="columnheader">{t(locale, 'weight')}</span><span role="columnheader">{t(locale, 'score')}</span></div>{Object.entries(modalities).map(([name, value]) => <div role="row" key={name}><strong role="cell">{t(locale, name)}</strong><span role="cell">{pct(value.quality)}</span><span role="cell">{pct(fusion.effective_weights[name] ?? 0)}</span><b role="cell" className={`severity-text-${value.level}`}>{pct(value.score)}</b></div>)}</div>
      {chartValues.length ? <DataLineChart values={chartValues} label={chartModality?.curve ? t(locale, 'riskCurve') : t(locale, 'sensor')} locale={locale} /> : null}
      {Object.values(modalities).flatMap(value => value.keyframes ?? []).length ? <div className="keyframe-grid">{Object.values(modalities).flatMap(value => value.keyframes ?? []).map(frame => <figure key={frame.artifact}><img src={artifactUrl(frame.artifact)} width="480" height="270" loading="lazy" alt={`${t(locale, 'keyframes')} ${fixed(frame.time_s, 1)}s`} /><figcaption><span>{fixed(frame.time_s, 1)} s</span><strong>{pct(frame.score)}</strong></figcaption></figure>)}</div> : null}
      {Object.values(modalities).filter(value => value.artifact).map(value => <img key={value.artifact} className="annotated-image" src={artifactUrl(value.artifact!)} width="960" height="540" loading="lazy" alt={t(locale, 'candidateRegions')} />)}
      <div className="explanation-line">{fusion.explanation_codes.map(code => <code key={code}>{code}</code>)}</div>
      <p className="boundary-note">{t(locale, 'technicalBoundary')}</p>
    </div>
  )
}

export function AnalysisView(props: ViewProps) {
  const { locale, state, analyses, pending } = props
  const [selectedId, setSelectedId] = useState(analyses[0]?.id ?? '')
  const [bind, setBind] = useState(true)
  const [x, setX] = useState(12)
  const [y, setY] = useState(5)
  const [formError, setFormError] = useState('')
  useEffect(() => { if (analyses[0] && !analyses.some(item => item.id === selectedId)) setSelectedId(analyses[0].id) }, [analyses, selectedId])
  const selected = analyses.find(item => item.id === selectedId) ?? analyses[0]
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const image = data.get('rgb_image') as File
    const video = data.get('rgb_video') as File
    const thermal = data.get('thermal_csv') as File
    const sensor = data.get('sensor_csv') as File
    if (![image, video, thermal, sensor].some(file => file?.size)) { setFormError(t(locale, 'analysisIntro')); return }
    if (image?.size && video?.size) { setFormError(locale === 'zh-CN' ? 'RGB 图像与视频不能同时提交。' : 'RGB image and video cannot be submitted together.'); return }
    if (!image?.size) data.delete('rgb_image')
    if (!video?.size) data.delete('rgb_video')
    if (!thermal?.size) data.delete('thermal_csv')
    if (!sensor?.size) data.delete('sensor_csv')
    if (bind) { data.set('mission_id', state.mission.id); data.set('x', String(x)); data.set('y', String(y)) }
    setFormError('')
    try { await props.onUpload(data); form.reset() } catch (error) { setFormError(error instanceof Error ? error.message : t(locale, 'requestFailed')) }
  }
  return (
    <div className="analysis-layout">
      <aside className="input-pane"><header className="view-heading"><span>{t(locale, 'analysis')}</span><h1>{t(locale, 'analysisTitle')}</h1><p>{t(locale, 'analysisIntro')}</p></header><form className="upload-form" onSubmit={event => void submit(event)}>
        <div className="file-field"><label htmlFor="rgb-image"><Upload aria-hidden="true" /><span><strong>{t(locale, 'rgb')}</strong><small>JPG / PNG · 20 MB</small></span></label><input id="rgb-image" name="rgb_image" type="file" accept="image/jpeg,image/png" /></div>
        <div className="file-field"><label htmlFor="rgb-video"><FileVideo aria-hidden="true" /><span><strong>{t(locale, 'video')}</strong><small>MP4 · 100 MB / 60 s</small></span></label><input id="rgb-video" name="rgb_video" type="file" accept="video/mp4" /></div>
        <div className="file-field"><label htmlFor="thermal-csv"><Waves aria-hidden="true" /><span><strong>{t(locale, 'thermal')}</strong><small>CSV · 5 MB</small></span></label><input id="thermal-csv" name="thermal_csv" type="file" accept=".csv,text/csv" /></div>
        <div className="file-field"><label htmlFor="sensor-csv"><Activity aria-hidden="true" /><span><strong>{t(locale, 'sensor')}</strong><small>timestamp,value · 5 MB</small></span></label><input id="sensor-csv" name="sensor_csv" type="file" accept=".csv,text/csv" /></div>
        <label className="check-control" htmlFor="bind-location"><input id="bind-location" name="bind_location" type="checkbox" checked={bind} onChange={event => setBind(event.target.checked)} /><span><Check aria-hidden="true" /></span>{t(locale, 'bindLocation')}</label>
        {bind ? <div className="coordinate-fields"><label htmlFor="coordinate-x">{t(locale, 'xCoord')}<input id="coordinate-x" name="coordinate_x" type="number" min="0" max="19" step="0.1" value={x} onChange={event => setX(Number(event.target.value))} /></label><label htmlFor="coordinate-y">{t(locale, 'yCoord')}<input id="coordinate-y" name="coordinate_y" type="number" min="0" max="11" step="0.1" value={y} onChange={event => setY(Number(event.target.value))} /></label></div> : null}
        {formError ? <p className="form-error" role="alert">{formError}</p> : null}
        <button type="submit" className="primary-panel-action" disabled={pending}><Upload aria-hidden="true" />{t(locale, 'upload')}</button>
      </form><div className="sample-actions"><span>{t(locale, 'fileRules')}</span><button type="button" disabled={pending} onClick={() => void props.onSample('multimodal', bind, x, y)}>{t(locale, 'multimodalSample')}</button><button type="button" disabled={pending} onClick={() => void props.onSample('video', bind, x, y)}>{t(locale, 'videoSample')}</button></div><p className="privacy-line"><ShieldCheck aria-hidden="true" />{t(locale, 'deleteOriginals')}</p></aside>
      <main className="result-pane"><div className="analysis-list" aria-label={t(locale, 'analyses')}>{analyses.length ? analyses.map(item => <button type="button" key={item.id} aria-pressed={selected?.id === item.id} onClick={() => setSelectedId(item.id)}><i className={item.status} /><span><strong>{item.id}</strong><small>{Object.keys(item.modalities).map(name => t(locale, name)).join(' · ')}</small></span><b>{item.status === 'completed' && item.result ? pct(item.result.fusion.score) : `${item.progress}%`}</b></button>) : <div className="empty-state"><FileChartColumn aria-hidden="true" /><p>{t(locale, 'noAnalysis')}</p></div>}</div><section className="result-detail">{selected ? <AnalysisDetail analysis={selected} locale={locale} /> : <div className="empty-state"><FileChartColumn aria-hidden="true" /><p>{t(locale, 'noSelection')}</p></div>}</section></main>
    </div>
  )
}

export function ScenariosView(props: ViewProps) {
  const { locale, scenarios, pending } = props
  const [selectedId, setSelectedId] = useState(scenarios[0]?.id ?? '')
  const selected = scenarios.find(scenario => scenario.id === selectedId) ?? scenarios[0]
  const [seed, setSeed] = useState(20260915)
  const [parameters, setParameters] = useState(selected?.defaults ?? { risk_count: 4, obstacle_count: 6, link_quality: 94 })
  const choose = (scenario: Scenario) => { setSelectedId(scenario.id); setParameters(scenario.defaults) }
  return (
    <div className="scenario-layout"><main><header className="view-heading"><span>{t(locale, 'scenarios')}</span><h1>{t(locale, 'scenariosTitle')}</h1><p>{t(locale, 'scenariosIntro')}</p></header><div className="scenario-list" role="radiogroup" aria-label={t(locale, 'selectedScenario')}>{scenarios.map((scenario, index) => <button key={scenario.id} type="button" role="radio" aria-checked={scenario.id === selected?.id} onClick={() => choose(scenario)}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{locale === 'zh-CN' ? scenario.name_zh : scenario.name_en}</strong><p>{locale === 'zh-CN' ? scenario.description_zh : scenario.description_en}</p></div><i><Check aria-hidden="true" /></i></button>)}</div></main><aside className="parameter-pane"><header className="panel-heading"><div><span>{t(locale, 'selectedScenario')}</span><h2>{selected ? (locale === 'zh-CN' ? selected.name_zh : selected.name_en) : '—'}</h2></div><MapPin aria-hidden="true" /></header><form onSubmit={event => { event.preventDefault(); if (selected) void props.onCreate({ scenario_id: selected.id, seed, parameters }) }}>
      <label htmlFor="seed">{t(locale, 'seed')}<input id="seed" name="seed" type="number" value={seed} onChange={event => setSeed(Number(event.target.value))} /></label>
      <label htmlFor="risk-count"><span>{t(locale, 'riskCount')}<output>{parameters.risk_count}</output></span><input id="risk-count" name="risk_count" type="range" min="1" max="8" value={parameters.risk_count} onChange={event => setParameters(current => ({ ...current, risk_count: Number(event.target.value) }))} /></label>
      <label htmlFor="obstacle-count"><span>{t(locale, 'obstacleCount')}<output>{parameters.obstacle_count}</output></span><input id="obstacle-count" name="obstacle_count" type="range" min="0" max="20" value={parameters.obstacle_count} onChange={event => setParameters(current => ({ ...current, obstacle_count: Number(event.target.value) }))} /></label>
      <label htmlFor="link-quality"><span>{t(locale, 'initialLink')}<output>{parameters.link_quality}%</output></span><input id="link-quality" name="link_quality" type="range" min="40" max="100" value={parameters.link_quality} onChange={event => setParameters(current => ({ ...current, link_quality: Number(event.target.value) }))} /></label>
      <dl className="scenario-summary"><div><dt>{t(locale, 'seed')}</dt><dd>{seed}</dd></div><div><dt>{t(locale, 'riskCount')}</dt><dd>{parameters.risk_count}</dd></div><div><dt>{t(locale, 'obstacleCount')}</dt><dd>{parameters.obstacle_count}</dd></div><div><dt>{t(locale, 'initialLink')}</dt><dd>{parameters.link_quality}%</dd></div></dl>
      <button type="submit" className="primary-panel-action" disabled={pending || !selected}>{t(locale, 'createMission')}<ChevronRight aria-hidden="true" /></button>
    </form></aside></div>
  )
}

function ComparisonTable({ state, locale }: { state: MissionState; locale: Locale }) {
  const assignment = state.comparisons.assignment
  if (!assignment) return <div className="empty-state"><Route aria-hidden="true" /><p>{t(locale, 'noComparison')}</p></div>
  return <div className="comparison-table"><table><thead><tr><th>{t(locale, 'algorithm')}</th><th>{t(locale, 'totalCost')}</th><th>{t(locale, 'assigned')}</th><th>{t(locale, 'runtime')}</th></tr></thead><tbody><tr><th>{t(locale, 'hungarian')}</th><td>{fixed(assignment.hungarian.total_cost, 4)}</td><td>{assignment.hungarian.assigned}</td><td>{fixed(assignment.hungarian.runtime_ms, 4)} ms</td></tr><tr><th>{t(locale, 'greedy')}</th><td>{fixed(assignment.greedy.total_cost, 4)}</td><td>{assignment.greedy.assigned}</td><td>{fixed(assignment.greedy.runtime_ms, 4)} ms</td></tr></tbody></table><div className="matrix"><span>{t(locale, 'matrix')}</span>{assignment.matrix.map((row, rowIndex) => <div key={assignment.agents[rowIndex]}><strong>{assignment.agents[rowIndex]}</strong>{row.map((cost, column) => <i key={assignment.risks[column]} title={`${assignment.risks[column]}: ${cost}`}>{fixed(cost, 3)}</i>)}</div>)}</div></div>
}

export function CoordinationView(props: ViewProps) {
  const { state, locale, pending } = props
  const path = state.comparisons.paths.at(-1)
  const faultActions = [['mesh', 'meshFault'], ['obstacle', 'obstacleFault'], ['thermal', 'thermalFault'], ['gps', 'gpsFault']] as const
  return (
    <div className="coordination-layout"><main><DamMap state={state} locale={locale} showControl /><section className="coordination-band"><div><span>{t(locale, 'localControl')}</span><strong>{fixed(state.last_control.speed_mps)} m/s</strong><small>{fixed(state.last_control.heading_deg, 1)}° · {state.last_control.candidates.length} {t(locale, 'candidates')}</small></div><div><span>{t(locale, 'prediction')}</span><strong>{state.last_control.prediction_horizon_s ?? 2} s</strong><small>{fixed(state.last_control.clearance_cells, 2)} {t(locale, 'safeClearance')}</small></div><div><span>{t(locale, 'communication')}</span><strong>{state.mesh.mode === 'relay' ? t(locale, 'meshRelay') : t(locale, 'normal')}</strong><small>{t(locale, 'relay')}: {state.mesh.relay ?? '—'}</small></div></section></main><aside className="coordination-pane"><header className="view-heading"><span>{t(locale, 'coordination')}</span><h1>{t(locale, 'coordinationTitle')}</h1></header><section><h2>{t(locale, 'assignment')}</h2><ComparisonTable state={state} locale={locale} /></section><section><h2>{t(locale, 'pathPlanning')}</h2>{path ? <table className="path-table"><thead><tr><th>{t(locale, 'algorithm')}</th><th>{t(locale, 'routeLength')}</th><th>{t(locale, 'expanded')}</th><th>{t(locale, 'runtime')}</th></tr></thead><tbody><tr><th>A*</th><td>{path.a_star.length}</td><td>{path.a_star.expanded_nodes}</td><td>{fixed(path.a_star.runtime_ms, 3)} ms</td></tr><tr><th>Dijkstra</th><td>{path.dijkstra.length}</td><td>{path.dijkstra.expanded_nodes}</td><td>{fixed(path.dijkstra.runtime_ms, 3)} ms</td></tr></tbody></table> : <p className="compact-empty">{t(locale, 'noComparison')}</p>}</section><section><h2>{t(locale, 'faults')}</h2><div className="fault-actions">{faultActions.map(([kind, label]) => <button type="button" key={kind} disabled={pending} onClick={() => void props.onFault(kind)}><AlertTriangle aria-hidden="true" />{t(locale, label)}</button>)}</div></section></aside></div>
  )
}

export function ReplayView(props: ViewProps) {
  const { locale, state, events, missions, pending } = props
  const [filter, setFilter] = useState('all')
  const filtered = useMemo(() => filter === 'all' ? events : events.filter(event => event.type === filter), [events, filter])
  const [index, setIndex] = useState(Math.max(0, filtered.length - 1))
  const [playing, setPlaying] = useState(false)
  useEffect(() => { setIndex(Math.max(0, filtered.length - 1)); setPlaying(false) }, [state.mission.id, filter, filtered.length])
  useEffect(() => {
    if (!playing || filtered.length < 2) return
    const timer = window.setInterval(() => setIndex(current => current >= filtered.length - 1 ? 0 : current + 1), 1100)
    return () => window.clearInterval(timer)
  }, [playing, filtered.length])
  const selectedEvent = filtered[index]
  const replayState = selectedEvent?.snapshot ?? state
  const types = Array.from(new Set(events.map(event => event.type)))
  return (
    <div className="replay-layout"><aside className="history-pane"><header className="view-heading"><span>{t(locale, 'replay')}</span><h1>{t(locale, 'missionHistory')}</h1></header><div className="mission-list">{missions.map(mission => <button type="button" key={mission.id} aria-pressed={mission.id === state.mission.id} disabled={pending} onClick={() => void props.onSelectMission(mission.id)}><span><strong>{t(locale, mission.scenario_id)}</strong><small className="mono">{mission.id}</small></span><b>{t(locale, mission.status)}</b><small>{mission.coverage}% · {mission.cycle} {t(locale, 'cycle')}</small></button>)}</div><div className="export-panel"><span>{t(locale, 'export')}</span><a href={`/api/v2/missions/${state.mission.id}/export.json`}><Download aria-hidden="true" />{t(locale, 'exportJson')}</a><a href={`/api/v2/missions/${state.mission.id}/export.csv?dataset=risks`}><Download aria-hidden="true" />{t(locale, 'exportRisks')}</a><a href={`/api/v2/missions/${state.mission.id}/export.csv?dataset=events`}><Download aria-hidden="true" />{t(locale, 'exportEvents')}</a><a href={`/api/v2/missions/${state.mission.id}/export.csv?dataset=comparisons`}><Download aria-hidden="true" />{t(locale, 'exportComparisons')}</a><a href={`/?view=report&mission=${state.mission.id}`} target="_blank" rel="noreferrer"><FileChartColumn aria-hidden="true" />{t(locale, 'print')}</a></div></aside><main className="replay-main"><DamMap state={replayState} locale={locale} replay /><div className="replay-controls"><button type="button" aria-label={t(locale, 'previous')} disabled={!filtered.length} onClick={() => setIndex(current => Math.max(0, current - 1))}><ChevronLeft aria-hidden="true" /></button><button type="button" aria-label={playing ? t(locale, 'pauseReplay') : t(locale, 'playReplay')} disabled={filtered.length < 2} onClick={() => setPlaying(current => !current)}>{playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</button><input type="range" aria-label={t(locale, 'eventTimeline')} min="0" max={Math.max(0, filtered.length - 1)} value={Math.min(index, Math.max(0, filtered.length - 1))} onChange={event => setIndex(Number(event.target.value))} /><output>{filtered.length ? `${Math.min(index + 1, filtered.length)} / ${filtered.length}` : '0 / 0'}</output><button type="button" aria-label={t(locale, 'next')} disabled={!filtered.length} onClick={() => setIndex(current => Math.min(filtered.length - 1, current + 1))}><ChevronRight aria-hidden="true" /></button></div></main><aside className="event-pane"><label htmlFor="event-filter">{t(locale, 'eventFilter')}<select id="event-filter" name="event_filter" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">{t(locale, 'allEvents')}</option>{types.map(type => <option key={type} value={type}>{type}</option>)}</select></label><ol className="event-list">{filtered.length ? [...filtered].reverse().map((event, reversedIndex) => { const realIndex = filtered.length - 1 - reversedIndex; return <li key={event.sequence}><button type="button" aria-pressed={realIndex === index} onClick={() => setIndex(realIndex)}><time>{event.timestamp.replace('T', ' ').slice(0, 19)}</time><span className={event.level} /><div><strong>{event.data.code}</strong><p>{eventText(event.data, locale)}</p></div><b>{event.sequence}</b></button></li> }) : <li className="compact-empty">{t(locale, 'noEvents')}</li>}</ol></aside></div>
  )
}

export function PrintReport({ locale, state, analyses, events }: { locale: Locale; state: MissionState; analyses: Analysis[]; events: EventRecord[] }) {
  return <main className="print-report"><header><div><span>{t(locale, 'university')}</span><h1>{t(locale, 'reportTitle')}</h1><p>{state.mission.id} · {t(locale, state.mission.scenario_id)}</p></div><button type="button" onClick={() => window.print()}>{t(locale, 'print')}</button></header><section><h2>{t(locale, 'summary')}</h2><dl><div><dt>{t(locale, 'status')}</dt><dd>{t(locale, state.mission.status)}</dd></div><div><dt>{t(locale, 'coverage')}</dt><dd>{state.summary.coverage}%</dd></div><div><dt>{t(locale, 'riskQueue')}</dt><dd>{state.summary.risk_count}</dd></div><div><dt>{t(locale, 'cycle')}</dt><dd>{state.mission.cycle}</dd></div><div><dt>{t(locale, 'created')}</dt><dd>{state.mission.created_at}</dd></div><div><dt>{t(locale, 'seed')}</dt><dd>{state.mission.seed}</dd></div></dl></section><section><h2>{t(locale, 'riskQueue')}</h2><table><thead><tr><th>ID</th><th>{t(locale, 'currentRisk')}</th><th>{t(locale, 'score')}</th><th>{t(locale, 'status')}</th><th>{t(locale, 'assigned')}</th></tr></thead><tbody>{state.risks.map(risk => <tr key={risk.id}><td>{risk.id}</td><td>{riskName(risk, locale)}</td><td>{pct(risk.score)}</td><td>{t(locale, risk.status)}</td><td>{risk.assigned ?? '—'}</td></tr>)}</tbody></table></section><section><h2>{t(locale, 'analyses')}</h2><table><thead><tr><th>ID</th><th>{t(locale, 'status')}</th><th>{t(locale, 'score')}</th><th>{t(locale, 'created')}</th></tr></thead><tbody>{analyses.map(item => <tr key={item.id}><td>{item.id}</td><td>{item.status}</td><td>{item.result ? pct(item.result.fusion.score) : '—'}</td><td>{item.created_at}</td></tr>)}</tbody></table></section><section><h2>{t(locale, 'eventTimeline')}</h2><ol>{events.map(event => <li key={event.sequence}><time>{event.timestamp}</time><strong>{event.data.code}</strong><span>{eventText(event.data, locale)}</span></li>)}</ol></section><footer><p>{t(locale, 'reportBoundary')}</p><span>{t(locale, 'version')}</span></footer></main>
}
