import { useState, useSyncExternalStore } from 'react'
import {
  applySettings,
  getSettings,
  resetSettings,
  sameSettings,
  subscribeSettings,
  type GameSettings,
} from '../lib/settings'

interface RangeFieldProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (value: number) => string
  onChange: (value: number) => void
}

function RangeField({ label, value, min, max, step, format, onChange }: RangeFieldProps) {
  return (
    <label className="settings-field">
      <span className="settings-label">{label}</span>
      <span className="settings-range">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <output>{format(value)}</output>
      </span>
    </label>
  )
}

interface ToggleFieldProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}

function ToggleField({ label, checked, onChange }: ToggleFieldProps) {
  return (
    <label className="settings-field settings-toggle">
      <span className="settings-label">{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  )
}

export function SettingsPanel() {
  const applied = useSyncExternalStore(subscribeSettings, getSettings)
  const [draft, setDraft] = useState<GameSettings>(getSettings)

  const update = <K extends keyof GameSettings>(key: K, value: GameSettings[K]) => {
    setDraft((previous) => ({ ...previous, [key]: value }))
  }

  const handleReset = () => {
    setDraft(resetSettings())
  }

  const handleApply = () => {
    applySettings(draft)
  }

  return (
    <aside className="settings">
      <h2 className="settings-title">Settings</h2>

      <div className="settings-fields">
        <RangeField
          label="CLASS_THRESHOLD"
          value={draft.classThreshold}
          min={0.1}
          max={0.95}
          step={0.05}
          format={(value) => value.toFixed(2)}
          onChange={(value) => update('classThreshold', value)}
        />
        <RangeField
          label="CAPTURE_INTERVAL"
          value={draft.captureInterval}
          min={50}
          max={1000}
          step={50}
          format={(value) => `${value}ms`}
          onChange={(value) => update('captureInterval', value)}
        />
        <ToggleField
          label="ENABLE_AI_SHOT"
          checked={draft.enableAiShot}
          onChange={(checked) => update('enableAiShot', checked)}
        />
        <ToggleField
          label="ENABLE_BOXES"
          checked={draft.enableBoxes}
          onChange={(checked) => update('enableBoxes', checked)}
        />
        <ToggleField
          label="ENABLE_DEBUG"
          checked={draft.enableDebug}
          onChange={(checked) => update('enableDebug', checked)}
        />
      </div>

      <div className="settings-actions">
        <button type="button" className="settings-button" onClick={handleReset}>
          Reset
        </button>
        <button
          type="button"
          className="settings-button settings-button-primary"
          onClick={handleApply}
          disabled={sameSettings(draft, applied)}
        >
          Apply configs
        </button>
      </div>
    </aside>
  )
}
