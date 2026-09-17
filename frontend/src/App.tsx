import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity, Clock3, FileSearch, Globe2, History, Map, Pause, Play, RadioTower,
  RotateCcw, Route, Settings2, ShieldAlert, StepForward,
} from 'lucide-react'
import { api, subscribeMission, type Analysis, type ConnectionState, type EventRecord, type Locale, type MissionState, type MissionSummary, type Scenario } from './api'
import { initialLocale, persistLocale, t } from './i18n'
import { AnalysisView, CoordinationView, OverviewView, PrintReport, ReplayView, ScenariosView, type ViewProps } from './views'

type View = 'overview' | 'analysis' | 'scenarios' | 'coordination' | 'replay'
const viewIds: View[] = ['overview', 'analysis', 'scenarios', 'coordination', 'replay']
const navIcons = { overview: Map, analysis: FileSearch, scenarios: Settings2, coordination: Route, replay: History }

function initialView(): View {
  const hash = window.location.hash.slice(1)
  return viewIds.includes(hash as View) ? hash as View : 'overview'
}

function App() {
  const [locale, setLocale] = useState<Locale>(initialLocale)
  const [view, setView] = useState<View>(initialView)
  const [state, setState] = useState<MissionState | null>(null)
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [missions, setMissions] = useState<MissionSummary[]>([])
  const [events, setEvents] = useState<EventRecord[]>([])
  const [analyses, setAnalyses] = useState<Analysis[]>([])
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const stateRef = useRef<MissionState | null>(null)
  const sequenceRef = useRef(0)
  stateRef.current = state

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const setCurrentState = useCallback((next: MissionState) => {
    sequenceRef.current = Math.max(sequenceRef.current, next.stream_sequence)
    setState(next)
  }, [])

  const refreshSideData = useCallback(async (missionId: string) => {
    const [nextMissions, nextEvents, nextAnalyses] = await Promise.all([api.missions(), api.events(missionId), api.analyses(missionId)])
    setMissions(nextMissions)
    setEvents(nextEvents)
    setAnalyses(nextAnalyses)
  }, [])

  const loadMission = useCallback(async (missionId: string) => {
    setPending(true)
    try {
      const [nextState, nextEvents, nextAnalyses] = await Promise.all([api.mission(missionId), api.events(missionId), api.analyses(missionId)])
      sequenceRef.current = nextState.stream_sequence
      setState(nextState)
      setEvents(nextEvents)
      setAnalyses(nextAnalyses)
      setError('')
      setMessage(t(locale, 'stateSynced'))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t(locale, 'requestFailed'))
    } finally {
      setPending(false)
    }
  }, [locale])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [availableScenarios, availableMissions] = await Promise.all([api.scenarios(), api.missions()])
        if (cancelled) return
        setScenarios(availableScenarios)
        setMissions(availableMissions)
        const reportMission = new URLSearchParams(window.location.search).get('mission')
        const missionId = reportMission ?? availableMissions[0]?.id
        if (missionId) await loadMission(missionId)
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : t(locale, 'requestFailed'))
      }
    }
    void load()
    return () => { cancelled = true }
  }, [loadMission, locale])

  useEffect(() => {
    if (!state?.mission.id) return
    const missionId = state.mission.id
    return subscribeMission(missionId, sequenceRef.current, {
      onState: next => {
        const previousSequence = sequenceRef.current
        setCurrentState(next)
        if (next.stream_sequence > previousSequence) {
          void api.events(missionId).then(setEvents)
          if (next.mission.cycle % 5 === 0 || next.mission.status !== stateRef.current?.mission.status) void api.missions().then(setMissions)
        }
      },
      onAnalysis: () => { void api.analyses(missionId).then(setAnalyses) },
      onConnection: setConnection,
      onError: setError,
    })
  }, [state?.mission.id, refreshSideData, setCurrentState])

  useEffect(() => {
    const onHash = () => setView(initialView())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const chooseView = (next: View) => {
    setView(next)
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${next}`)
    document.getElementById('primary-workspace')?.focus({ preventScroll: true })
  }

  const run = useCallback(async (task: () => Promise<void>, success: string) => {
    setPending(true)
    try {
      await task()
      setError('')
      setMessage(success)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t(locale, 'requestFailed'))
    } finally {
      setPending(false)
    }
  }, [locale])

  const command = async (name: string, value?: number) => {
    if (!stateRef.current) return
    await run(async () => {
      const next = await api.command(stateRef.current!.mission.id, name, value)
      setCurrentState(next)
      if (next.mission.id !== stateRef.current?.mission.id || name === 'reset') await refreshSideData(next.mission.id)
    }, t(locale, 'commandApplied'))
  }

  const review = async (riskId: string, decision: 'confirmed' | 'dismissed', note?: string) => {
    if (!stateRef.current) return
    await run(async () => setCurrentState(await api.review(stateRef.current!.mission.id, riskId, decision, note)), t(locale, 'reviewSaved'))
  }

  const fault = async (kind: string) => {
    if (!stateRef.current) return
    await run(async () => setCurrentState(await api.fault(stateRef.current!.mission.id, kind)), t(locale, 'faultInjected'))
  }

  const watchAnalysis = useCallback((analysisId: string, missionId?: string) => {
    let attempts = 0
    const poll = async () => {
      attempts += 1
      try {
        const item = await api.analysis(analysisId)
        setAnalyses(current => [item, ...current.filter(existing => existing.id !== item.id)])
        if (item.status === 'queued' || item.status === 'processing') window.setTimeout(() => void poll(), 700)
        else if (missionId) await refreshSideData(missionId)
      } catch {
        if (attempts < 30) window.setTimeout(() => void poll(), 1000)
      }
    }
    void poll()
  }, [refreshSideData])

  const upload = async (form: FormData) => {
    await run(async () => {
      const response = await api.upload(form)
      const missionId = typeof form.get('mission_id') === 'string' ? String(form.get('mission_id')) : undefined
      watchAnalysis(response.analysis_id, missionId)
    }, t(locale, 'analysisSubmitted'))
  }

  const sample = async (kind: 'multimodal' | 'video', bind: boolean, x: number, y: number) => {
    await run(async () => {
      const body: { mission_id?: string; kind: 'multimodal' | 'video'; x?: number; y?: number } = bind && stateRef.current ? { mission_id: stateRef.current.mission.id, kind, x, y } : { kind }
      const response = await api.sample(body)
      watchAnalysis(response.analysis_id, body.mission_id)
    }, t(locale, 'analysisSubmitted'))
  }

  const create = async (body: Parameters<typeof api.createMission>[0]) => {
    await run(async () => {
      const next = await api.createMission(body)
      sequenceRef.current = next.stream_sequence
      setState(next)
      await refreshSideData(next.mission.id)
      chooseView('overview')
    }, t(locale, 'missionCreated'))
  }

  const toggleLocale = () => {
    const next = locale === 'zh-CN' ? 'en-US' : 'zh-CN'
    persistLocale(next)
    document.documentElement.lang = next
    setLocale(next)
  }

  if (!state) {
    return <main className="loading-screen"><Activity aria-hidden="true" /><h1>{t(locale, 'product')}</h1><p role="status">{error || t(locale, 'loading')}</p><button type="button" onClick={() => window.location.reload()}>{t(locale, 'retry')}</button></main>
  }

  const params = new URLSearchParams(window.location.search)
  if (params.get('view') === 'report') return <PrintReport locale={locale} state={state} analyses={analyses} events={events} />

  const nav = viewIds.map(id => ({ id, label: t(locale, id), icon: navIcons[id] }))
  const isRunning = state.mission.status === 'running'
  const primaryInHeader = view === 'overview' || view === 'coordination' || view === 'replay'
  const viewProps: ViewProps = {
    locale, state, analyses, events, missions, scenarios, pending, onCommand: command, onReview: review,
    onFault: fault, onUpload: upload, onSample: sample, onCreate: create, onSelectMission: loadMission,
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#primary-workspace">{t(locale, 'skip')}</a>
      <header className="topbar">
        <a className="brand" href="#overview" aria-label={t(locale, 'product')} onClick={() => chooseView('overview')}><ShieldAlert aria-hidden="true" /><span><strong>{t(locale, 'product')}</strong><small>{t(locale, 'subtitle')}</small></span></a>
        <div className="mission-identity"><span className={`status-dot status-${state.mission.status}`} /><div><strong>{t(locale, state.mission.status)}</strong><small className="mono">{state.mission.id}</small></div></div>
        <dl className="top-metrics"><div><dt>{t(locale, 'cycle')}</dt><dd>{state.mission.cycle}</dd></div><div><dt>{t(locale, 'coverage')}</dt><dd>{state.summary.coverage}%</dd></div><div><dt>{t(locale, 'link')}</dt><dd>{Math.round(state.mesh.health)}%</dd></div></dl>
        <div className="task-controls">
          <label className="speed-control" htmlFor="speed-select"><span>{t(locale, 'speed')}</span><select id="speed-select" name="speed" value={state.mission.speed} disabled={pending} onChange={event => void command('set_speed', Number(event.target.value))}><option value="0.5">0.5×</option><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></label>
          <button type="button" className="icon-action" title={t(locale, 'step')} aria-label={t(locale, 'step')} disabled={pending || isRunning || state.mission.status === 'completed'} onClick={() => void command('step')}><StepForward aria-hidden="true" /></button>
          <button type="button" className="icon-action" title={t(locale, 'reset')} aria-label={t(locale, 'reset')} disabled={pending} onClick={() => void command('reset')}><RotateCcw aria-hidden="true" /></button>
          <button type="button" className={primaryInHeader ? 'primary-action' : 'secondary-action'} disabled={pending || state.mission.status === 'completed'} onClick={() => void command(isRunning ? 'pause' : 'start')}>{isRunning ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}{isRunning ? t(locale, 'pause') : t(locale, 'start')}</button>
          <button type="button" className="locale-action" onClick={toggleLocale}><Globe2 aria-hidden="true" />{t(locale, 'locale')}</button>
        </div>
      </header>
      <nav className="mobile-navigation" aria-label="Primary navigation">{nav.map(({ id, label, icon: Icon }) => <button type="button" key={id} aria-pressed={view === id} onClick={() => chooseView(id)}><Icon aria-hidden="true" /><span>{label}</span></button>)}</nav>
      <div className="workspace-shell">
        <nav className="side-navigation" aria-label="Primary navigation">{nav.map(({ id, label, icon: Icon }) => <button type="button" key={id} aria-current={view === id ? 'page' : undefined} onClick={() => chooseView(id)}><Icon aria-hidden="true" /><span>{label}</span></button>)}<div className={`connection-marker ${connection}`} title={t(locale, connection)}><RadioTower aria-hidden="true" /><span>{t(locale, connection)}</span></div></nav>
        <main id="primary-workspace" className={`primary-workspace view-${view}`} tabIndex={-1}>
          {view === 'overview' ? <OverviewView {...viewProps} /> : null}
          {view === 'analysis' ? <AnalysisView {...viewProps} /> : null}
          {view === 'scenarios' ? <ScenariosView {...viewProps} /> : null}
          {view === 'coordination' ? <CoordinationView {...viewProps} /> : null}
          {view === 'replay' ? <ReplayView {...viewProps} /> : null}
        </main>
      </div>
      <footer className="statusbar"><span><span className={`status-dot connection-${connection}`} />{t(locale, connection)}</span><span role="status" aria-live="polite" className={error ? 'error' : ''}>{error || message || t(locale, 'stateSynced')}</span><span><Clock3 aria-hidden="true" />{state.mission.updated_at.replace('T', ' ').slice(0, 19)}</span><span>{t(locale, 'version')}</span></footer>
    </div>
  )
}

export default App
