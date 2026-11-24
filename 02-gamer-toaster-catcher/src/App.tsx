import { useEffect, useRef } from 'react'
import { SettingsPanel } from './components/SettingsPanel'
import { startGame } from './lib/Game'

function App() {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    return startGame(host)
  }, [])

  return (
    <div className="layout">
      <div ref={hostRef} className="frame" />
      <SettingsPanel />
    </div>
  )
}

export default App
